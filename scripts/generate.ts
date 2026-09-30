/**
 * Synthetic data generator (CLAUDE.md section 10).
 *
 *   npm run db:generate                 -> CSVs only, into /data
 *   npm run db:seed                     -> CSVs + truncate & seed the database (DATABASE_URL)
 *
 * Flags: --no-db  --days 90  --end YYYY-MM-DD (last history day, default = yesterday IST)
 *        --future 7 (roster days from today)  --seed 42
 *
 * Everything is deterministic for a given --seed and --end. All people are synthetic; mobiles are never stored.
 */
import path from "node:path";

import { BRANCHES, COUNTERS, STAFF } from "@/lib/data/branches";
import { SERVICES, SERVICE_BY_ID } from "@/lib/data/catalog";
import { HOLIDAYS } from "@/lib/data/holidays";
import {
  APPOINTMENT_SHARE,
  PRIORITY_MIX,
  PROFILES,
  WALKIN_SOURCES,
  serviceWeights,
  type BranchProfile,
} from "@/lib/data/profiles";
import {
  addDays,
  combinedFactor,
  dayFactors,
  dayOfWeek,
  fromMinutes,
  isSalaryDay,
  isWorkingDay,
  istIso,
  toMinutes,
} from "@/lib/engine/calendar";
import { chance, createRng, lognormalMean, normal, poisson, randInt, weightedPick, type Rng } from "@/lib/random";
import { CATEGORIES, type Branch, type PriorityFlag, type Staff, type TokenSource } from "@/lib/types";

import { writeCsv } from "./lib/csv";
import { bulkInsert, connect } from "./lib/db";
import { loadEnv, requireEnv } from "./lib/env";
import { makeComment, sentimentFor } from "@/lib/sim/feedback-templates";
import { replayDay, type CounterStaff, type VisitResult } from "@/lib/engine/replay";
import { makeArrivals, makeRoster, type RosterRow } from "@/lib/engine/synth";

// ---------------------------------------------------------------- args

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

const SEED = Number(arg("seed", "42"));
const DAYS = Number(arg("days", "90"));
const TODAY = arg("end") ? addDays(arg("end")!, 1) : todayIst();
const END = addDays(TODAY, -1);
const START = addDays(END, -(DAYS - 1));
const FUTURE = Number(arg("future", "7"));
const WITH_DB = !process.argv.includes("--no-db");
const DATA_DIR = path.resolve(__dirname, "..", "data");

// ---------------------------------------------------------------- main

interface VisitRow extends VisitResult {
  id: number;
  branchId: string;
  date: string;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function main() {
  console.log(`BranchFlow synthetic data — seed ${SEED}, history ${START} → ${END} (${DAYS} days), today ${TODAY}`);
  const rng = createRng(SEED);

  // Personal speed per staff member (feeds the "staff handle-time comparison" insight).
  const staffSpeed = new Map(STAFF.map((s) => [s.id, 0.85 + rng() * 0.35]));

  const rosters: RosterRow[] = [];
  const visits: VisitRow[] = [];
  let visitId = 0;

  for (const b of BRANCHES) {
    const profile = PROFILES[b.id];
    const branchStaff = STAFF.filter((s) => s.branch_id === b.id);
    const counterOf = new Map(COUNTERS.filter((c) => c.staff_id).map((c) => [c.staff_id!, c.number]));

    for (let date = START; date <= addDays(TODAY, FUTURE - 1); date = addDays(date, 1)) {
      if (!isWorkingDay(date)) continue;
      const dayRosters = branchStaff.map((s) => makeRoster(rng, s, b, date));
      rosters.push(...dayRosters);
      if (date > END) continue; // today + future: rosters only (the live simulator plays today)

      const present: CounterStaff[] = dayRosters
        .map((r) => ({ r, s: branchStaff.find((x) => x.id === r.staff_id)! }))
        .filter(({ r, s }) => !r.absent && s.role === "STAFF")
        .map(({ r, s }) => ({
          staffId: s.id,
          counterNumber: counterOf.get(s.id)!,
          skills: s.skills,
          modeSkill: s.primary_skill,
          speed: staffSpeed.get(s.id)!,
          startMin: toMinutes(b.open_time) + (chance(rng, 0.1) ? randInt(rng, 5, 15) : 0),
          breaks: r.breaks.map((br) => ({ startMin: toMinutes(br.start), minutes: br.actual_minutes })),
        }));

      const arrivals = makeArrivals(rng, b, profile, date);
      const results = replayDay(rng, arrivals, present, toMinutes(b.close_time), profile.handleSpeed);
      for (const r of results) visits.push({ ...r, id: ++visitId, branchId: b.id, date });
    }
  }
  visits.sort((a, b) => (a.date === b.date ? a.arrivalMin - b.arrivalMin : a.date < b.date ? -1 : 1));
  visits.forEach((v, i) => (v.id = i + 1));

  // ---------------------------------------------------------------- feedback (~30% of completed visits)
  const feedback: unknown[][] = [];
  for (const v of visits) {
    if (v.status !== "COMPLETED" || !chance(rng, 0.3)) continue;
    const svc = SERVICE_BY_ID[v.serviceId];
    const wait = v.waitMin ?? 0;
    const ratio = wait / svc.target_wait_min;
    const raw =
      4.7 -
      1.1 * Math.max(0, ratio - 0.8) -
      (v.transferCount ? 0.7 : 0) -
      (v.outcome === "PARTIALLY_RESOLVED" ? 0.6 : v.outcome === "NEEDS_FOLLOW_UP" ? 1.0 : 0) +
      normal(rng) * 0.6;
    const rating = Math.min(5, Math.max(1, Math.round(raw)));
    const { comment, topics } = makeComment(rng, rating, {
      waitMin: wait,
      targetWaitMin: svc.target_wait_min,
      transferred: v.transferCount > 0,
      partial: v.outcome !== "RESOLVED",
      serviceName: svc.name,
    });
    const at = istIso(v.date, (v.completedMin ?? v.arrivalMin) + 5 + rng() * 120);
    feedback.push([v.id, v.branchId, rating, comment, sentimentFor(rating), topics, at]);
  }

  // ---------------------------------------------------------------- rows
  const branchRows = BRANCHES.map((b) => [b.id, b.name, b.area_type, b.address, b.lat, b.lng, b.open_time, b.close_time]);
  const serviceRows = SERVICES.map((s) => [
    s.id, s.name, s.name_hi, s.category, s.skill, s.avg_handle_min, s.target_wait_min, s.digital_possible,
    s.digital_level, s.digital_minutes, s.digital_channel, s.digital_link, JSON.stringify(s.digital_steps),
    JSON.stringify(s.documents), s.keywords, s.icon, s.sort_order,
  ]);
  const staffRows = STAFF.map((s) => [s.id, s.branch_id, s.name, s.pin, s.role, s.skills, s.primary_skill]);
  const counterRows = COUNTERS.map((c) => [c.id, c.branch_id, c.number, c.staff_id, "OFFLINE", c.mode_skill]);
  const holidayRows = HOLIDAYS.map((h) => [h.date, h.name]);
  const rosterRows = rosters.map((r) => [
    r.branch_id, r.staff_id, r.date, r.shift_start, r.shift_end, r.absent, JSON.stringify(r.breaks),
  ]);
  const visitRows = visits.map((v) => {
    const svc = SERVICE_BY_ID[v.serviceId];
    const t = (m: number | null) => (m == null ? null : istIso(v.date, m));
    const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
    return [
      v.id, v.branchId, v.date, dayOfWeek(v.date), Math.floor(v.arrivalMin / 60), t(v.arrivalMin), v.serviceId,
      v.finalServiceId, v.category, v.skill, v.source, v.priority, t(v.appointmentStartMin), t(v.calledMin),
      t(v.servingStartMin), t(v.completedMin), r2(v.waitMin), r2(v.handleMin), v.status, v.outcome, v.transferCount,
      v.couldBeDigital, v.counterNumber, v.staffId,
      v.status === "COMPLETED" ? (v.firstLegWaitMin ?? 0) <= svc.target_wait_min : null,
    ];
  });

  const COLS = {
    branches: ["id", "name", "area_type", "address", "lat", "lng", "open_time", "close_time"],
    services: [
      "id", "name", "name_hi", "category", "skill", "avg_handle_min", "target_wait_min", "digital_possible",
      "digital_level", "digital_minutes", "digital_channel", "digital_link", "digital_steps", "documents", "keywords",
      "icon", "sort_order",
    ],
    staff: ["id", "branch_id", "name", "pin", "role", "skills", "primary_skill"],
    counters: ["id", "branch_id", "number", "staff_id", "status", "mode_skill"],
    holidays: ["date", "name"],
    rosters: ["branch_id", "staff_id", "date", "shift_start", "shift_end", "absent", "breaks"],
    visit_history: [
      "id", "branch_id", "date", "day_of_week", "hour", "arrival_at", "service_id", "final_service_id", "category",
      "skill", "source", "priority_flag", "appointment_start", "called_at", "serving_started_at", "completed_at",
      "wait_min", "handle_min", "status", "outcome", "transfer_count", "could_be_digital", "counter_number", "staff_id",
      "sla_met",
    ],
    feedback: ["visit_id", "branch_id", "rating", "comment", "sentiment", "topics", "at"],
  };
  const TABLE_ROWS: Record<keyof typeof COLS, unknown[][]> = {
    branches: branchRows,
    services: serviceRows,
    staff: staffRows,
    counters: counterRows,
    holidays: holidayRows,
    rosters: rosterRows,
    visit_history: visitRows,
    feedback,
  };

  // ---------------------------------------------------------------- CSV
  for (const [name, cols] of Object.entries(COLS)) {
    // CSVs parse JSON columns back to objects so they're readable
    const rows = TABLE_ROWS[name as keyof typeof COLS].map((r) =>
      r.map((v) => (typeof v === "string" && (v.startsWith("[") || v.startsWith("{")) ? JSON.parse(v) : v))
    );
    writeCsv(DATA_DIR, name, cols, rows);
  }
  console.log(`\n✔ CSVs written to ${DATA_DIR}`);

  printSummary(visits, feedback.length);

  // ---------------------------------------------------------------- DB
  if (!WITH_DB) {
    console.log("\n(--no-db) Skipping database seed.");
    return;
  }
  loadEnv();
  const client = await connect(requireEnv("DATABASE_URL"));
  try {
    console.log("\nSeeding database…");
    await client.query("begin");
    await client.query(`
      truncate table sms_outbox, app_events, token_events, counter_events, feedback, alerts, recommendations,
        forecasts, tokens, visit_history, rosters, counters, staff, services, holidays, branch_settings, sim_state,
        branches restart identity cascade`);
    for (const name of Object.keys(COLS) as (keyof typeof COLS)[]) {
      process.stdout.write(`  ${name.padEnd(14)} `);
      await bulkInsert(client, name, COLS[name], TABLE_ROWS[name], (done, total) => {
        process.stdout.write(`\r  ${name.padEnd(14)} ${done}/${total}`);
      });
      process.stdout.write(`\r  ${name.padEnd(14)} ${TABLE_ROWS[name].length} rows\n`);
    }
    await client.query(`select setval(pg_get_serial_sequence('visit_history','id'), (select coalesce(max(id),1) from visit_history))`);
    await bulkInsert(client, "branch_settings", ["branch_id"], BRANCHES.map((b) => [b.id]));
    await client.query(`insert into sim_state (id, sim_now, speed, running) values (1, $1, 0, false)`, [
      istIso(TODAY, 600),
    ]);
    await client.query("commit");
    console.log("✔ Database seeded.");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}

function printSummary(visits: VisitRow[], feedbackCount: number) {
  const days = new Set(visits.map((v) => v.date)).size;
  console.log(`\n${visits.length} visits over ${days} working days, ${feedbackCount} feedback rows\n`);
  console.log("Branch  visits/day  avgWait  P90Wait  SLA%   noShow%  left%  transfer%");
  for (const b of BRANCHES) {
    const vs = visits.filter((v) => v.branchId === b.id);
    const done = vs.filter((v) => v.status === "COMPLETED");
    const waits = done.map((v) => v.firstLegWaitMin ?? 0);
    const sla = done.filter((v) => (v.firstLegWaitMin ?? 0) <= SERVICE_BY_ID[v.serviceId].target_wait_min).length;
    const pct = (n: number, d: number) => ((100 * n) / Math.max(1, d)).toFixed(1).padStart(5);
    console.log(
      `${b.id}    ${(vs.length / Math.max(1, new Set(vs.map((v) => v.date)).size)).toFixed(0).padStart(6)}  ` +
        `${(waits.reduce((s, x) => s + x, 0) / Math.max(1, waits.length)).toFixed(1).padStart(7)}  ` +
        `${percentile(waits, 0.9).toFixed(1).padStart(7)}  ${pct(sla, done.length)}  ` +
        `${pct(vs.filter((v) => v.status === "NO_SHOW").length, vs.length)}  ` +
        `${pct(vs.filter((v) => v.status === "CANCELLED").length, vs.length)}  ` +
        `${pct(done.filter((v) => v.transferCount > 0).length, done.length)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
