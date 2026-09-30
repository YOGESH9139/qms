// Before vs after (CLAUDE.md section 12): replay the SAME synthetic day twice with identical arrivals and staff.
//  (a) Before: FIFO single queue, no recommendations (the all-skills officer stays in the back office).
//  (b) BranchFlow: section 7.1 routing + accepted recommendations — open the officer's counter around the forecast
//      peak, and a digital nudge that moves 25% of app-doable Quick walk-ins online.

import { BRANCHES, COUNTERS, STAFF } from "@/lib/data/branches";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { PROFILES } from "@/lib/data/profiles";
import { createRng } from "@/lib/random";

import { toMinutes } from "./calendar";
import { replayDay, type Arrival, type CounterStaff, type VisitResult } from "./replay";
import { makeArrivals, makeRoster } from "./synth";

export interface RunKpis {
  label: string;
  arrivals: number;
  served: number;
  avgWait: number;
  p90Wait: number;
  slaPct: number;
  leftPct: number;
  deflected: number;
  byHour: { hour: number; avgWait: number }[];
}

export interface Comparison {
  date: string;
  branchId: string;
  salaryDay: boolean;
  before: RunKpis;
  after: RunKpis;
  assumptions: string[];
}

function kpis(label: string, results: VisitResult[], arrivals: number, deflected: number): RunKpis {
  const done = results.filter((r) => r.status === "COMPLETED");
  const waits = done.map((r) => r.firstLegWaitMin ?? 0).sort((a, b) => a - b);
  const sla = done.filter((r) => (r.firstLegWaitMin ?? 0) <= SERVICE_BY_ID[r.serviceId].target_wait_min).length;
  const hours = new Map<number, number[]>();
  for (const r of done) {
    const h = Math.floor(r.arrivalMin / 60);
    if (!hours.has(h)) hours.set(h, []);
    hours.get(h)!.push(r.firstLegWaitMin ?? 0);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    label,
    arrivals,
    served: done.length,
    avgWait: Math.round(avg(waits) * 10) / 10,
    p90Wait: Math.round((waits[Math.min(waits.length - 1, Math.floor(waits.length * 0.9))] ?? 0) * 10) / 10,
    slaPct: Math.round((1000 * sla) / Math.max(1, done.length)) / 10,
    leftPct: Math.round((1000 * results.filter((r) => r.status === "CANCELLED").length) / Math.max(1, arrivals)) / 10,
    deflected,
    byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, xs]) => ({ hour, avgWait: Math.round(avg(xs) * 10) / 10 })),
  };
}

export function compareDay(branchId: string, date: string, salaryDay = false, seed = 7): Comparison {
  const b = BRANCHES.find((x) => x.id === branchId)!;
  const base = PROFILES[branchId];
  const profile = salaryDay ? { ...base, dailyVolume: base.dailyVolume * 1.4 } : base;
  const rng = createRng(seed);
  const arrivals = makeArrivals(rng, b, profile, date);
  const staff = STAFF.filter((s) => s.branch_id === branchId && s.role === "STAFF");
  const officer = staff.find((s) => s.skills.length === 4);
  const open = toMinutes(b.open_time);
  const peakIdx = profile.hourCurve.indexOf(Math.max(...profile.hourCurve));
  const peakStart = open + Math.max(0, peakIdx - 1) * 60;

  const present = staff
    .map((s) => ({ s, r: makeRoster(rng, s, b, date) }))
    .filter(({ r }) => !r.absent)
    .map(({ s, r }, i): CounterStaff => ({
      staffId: s.id,
      counterNumber: COUNTERS.find((c) => c.staff_id === s.id)?.number ?? i + 1,
      skills: s.skills,
      modeSkill: s.primary_skill,
      speed: 1,
      startMin: open,
      breaks: r.breaks.map((br) => ({ startMin: toMinutes(br.start), minutes: br.actual_minutes })),
    }));

  const beforeStaff = present.filter((c) => c.staffId !== officer?.id);
  const afterStaff = present.map((c) =>
    c.staffId === officer?.id ? { ...c, startMin: peakStart, endMin: peakStart + 180, breaks: [] } : c
  );

  // Digital nudge: every 4th app-doable Quick walk-in goes online instead (deterministic).
  let k = 0;
  const deflectedIds = new Set<number>();
  arrivals.forEach((a: Arrival, i) => {
    const s = SERVICE_BY_ID[a.serviceId];
    if (s.category === "QUICK" && s.digital_level === "FULL" && a.source !== "APP_APPOINTMENT" && k++ % 4 === 0) deflectedIds.add(i);
  });
  const afterArrivals = arrivals.filter((_, i) => !deflectedIds.has(i));

  const close = toMinutes(b.close_time);
  const before = replayDay(createRng(seed + 1), arrivals, beforeStaff, close, profile.handleSpeed, "FIFO");
  const after = replayDay(createRng(seed + 1), afterArrivals, afterStaff, close, profile.handleSpeed, "BRANCHFLOW");

  return {
    date,
    branchId,
    salaryDay,
    before: kpis("Before (FIFO, no recommendations)", before, arrivals.length, 0),
    after: kpis("With BranchFlow", after, arrivals.length, deflectedIds.size),
    assumptions: [
      `Same ${arrivals.length} arrivals and the same rostered staff in both runs (seed ${seed}).`,
      "Before: one FIFO line (oldest ticket first), no priority, appointment or SLA rules; the all-skills officer stays in the back office.",
      `After: BranchFlow scoring + accepted "Open counter" for ${officer?.name ?? "the officer"} ${Math.floor(peakStart / 60)}:00–${Math.floor(peakStart / 60) + 3}:00 (forecast peak) + digital nudge (25% of app-doable Quick walk-ins finish online).`,
    ],
  };
}
