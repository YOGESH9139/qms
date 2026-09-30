import "server-only";

// Live simulator (CLAUDE.md section 11): sim clock, walk-ins from today's forecast, bot staff & customers,
// scenarios and reset. Each tick processes the sim minutes elapsed since the last tick.

import { effectiveNow, fromIst, istDayStart, istParts, type Scenario, type SimState } from "@/lib/clock";
import { BRANCHES, COUNTERS, STAFF, getBranch } from "@/lib/data/branches";
import { SERVICES, SERVICE_BY_ID } from "@/lib/data/catalog";
import { PRIORITY_MIX, PROFILES, serviceWeights } from "@/lib/data/profiles";
import { isWorkingDay, nextWorkingDay, toMinutes } from "@/lib/engine/calendar";
import { callNext, complete, skip, startServing, transfer, releaseParked, minutesBetween, checkIn } from "@/lib/engine/queue";
import { TRANSFERS } from "@/lib/engine/replay";
import { chance, createRng, lognormalMean, pick, poisson, randInt, weightedPick, type Rng } from "@/lib/random";
import { makeComment, sentimentFor } from "@/lib/sim/feedback-templates";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { CATEGORIES, type Counter, type PriorityFlag, type Token, type TokenOutcome, type TokenSource } from "@/lib/types";

import { currentToken, issue, smsIssued } from "./actions";
import { engineTick, forecastFor } from "./intel";
import { getSim, Workspace } from "./workspace";

const FIRST = ["Aarav", "Diya", "Kabir", "Ishita", "Rohan", "Ananya", "Vihaan", "Meera", "Arjun", "Saanvi", "Ramesh", "Lakshmi", "Imran", "Fatima", "John", "Priya", "Suresh", "Kavya", "Manoj", "Geeta"];
const LAST = ["Sharma", "Rao", "Iyer", "Khan", "Patel", "Reddy", "Nair", "Gowda", "Das", "Singh", "Menon", "Joshi"];
export const DEMO_MOBILE = "9876543210";

const remindersSent = new Set<string>();
const breaksTaken = new Set<string>();
let lastEngineAt = 0;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function tokenRng(t: Token, salt: string): Rng {
  return createRng(hashSeed(t.id + salt));
}

function randomMobile(rng: Rng): string {
  return `9${randInt(rng, 100000000, 999999999)}`;
}

function randomName(rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

async function saveSim(patch: Partial<SimState>) {
  await getSupabaseAdmin().from("sim_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
}

// ---------------------------------------------------------------- controls

export async function setSpeed(speed: number) {
  const sim = await getSim();
  const now = effectiveNow(sim).toISOString();
  await saveSim({ sim_now: now, speed, running: speed > 0 });
}

export async function setScenario(patch: Scenario) {
  const sim = await getSim();
  await getSupabaseAdmin().from("sim_state").update({ scenario: { ...(sim.scenario ?? {}), ...patch } }).eq("id", 1);
}

// ---------------------------------------------------------------- tick

export async function simTick(): Promise<Record<string, unknown>> {
  const sim = await getSim();
  const branchId = sim.branch_id ?? "BR01";
  const now = effectiveNow(sim);
  if (!sim.running) {
    return { running: false, now: now.toISOString() };
  }
  const last = sim.last_tick ? new Date(sim.last_tick) : new Date(now.getTime() - 60000);
  const from = new Date(Math.max(last.getTime(), now.getTime() - 15 * 60000));
  const steps = Math.floor((now.getTime() - from.getTime()) / 60000);
  if (steps < 1) return { running: true, now: now.toISOString(), steps: 0 };

  const ws = await Workspace.load(branchId, { now: from });
  const date = istParts(now).date;
  const cells = await forecastFor(ws.db, branchId, date, false);
  const { data: roster } = await ws.db.from("rosters").select("staff_id, breaks").eq("branch_id", branchId).eq("date", date);
  const scenario: Scenario = { ...(sim.scenario ?? {}) };
  const feedback: Record<string, unknown>[] = [];
  const b = getBranch(branchId)!;
  const closeMin = toMinutes(b.close_time);
  const rng = createRng(hashSeed(`${from.toISOString()}:${branchId}`));
  let arrivals = 0;

  for (let i = 1; i <= steps; i++) {
    ws.now = new Date(from.getTime() + i * 60000);
    const { minutes, hour } = istParts(ws.now);

    // walk-ins from today's forecast (× surge while a scenario is active)
    const surge = scenario.surge && new Date(scenario.surge.until) > ws.now ? scenario.surge.factor : 1;
    if (minutes < closeMin) {
      for (const cat of CATEGORIES) {
        const lam = ((cells.find((c) => c.hour === hour && c.category === cat)?.expected ?? 0) / 60) * surge;
        for (let k = poisson(rng, lam); k > 0; k--) {
          walkIn(ws, rng, weightedPick(rng, serviceWeights(PROFILES[branchId], cat)));
          arrivals++;
        }
      }
    }

    // booked customers arrive and check in (8% never come)
    for (const t of ws.tokens.filter((x) => x.status === "BOOKED" && x.appointment_start)) {
      const r = tokenRng(t, "arrive");
      if (r() < 0.08) continue;
      const arriveAt = new Date(t.appointment_start!).getTime() + (r() < 0.1 ? r() * 25 : -r() * 15) * 60000;
      if (ws.now.getTime() >= arriveAt) {
        const res = ws.apply(checkIn(t, ws.ctx));
        ws.sms(res.token, `Checked in: token ${res.token.code}. Watch the screen for your counter.`);
      }
      // reminders 60 and 15 min before
      for (const before of [60, 15]) {
        const key = `${t.id}:${before}`;
        const due = new Date(t.appointment_start!).getTime() - before * 60000;
        if (!remindersSent.has(key) && ws.now.getTime() >= due && ws.now.getTime() < due + 10 * 60000) {
          remindersSent.add(key);
          const expected = new Date(Math.max(new Date(t.appointment_start!).getTime(), ws.now.getTime() + (before - 5) * 60000));
          ws.sms(t, before === 60
            ? `Reminder: your ${SERVICE_BY_ID[t.service_id].name} appointment (${t.code}) is in 1 hour. Expected call time ~${String(istParts(expected).hour).padStart(2, "0")}:${String(Math.floor(istParts(expected).minutes % 60)).padStart(2, "0")}.`
            : `Your appointment ${t.code} is in 15 min and the branch is running on time. Check in at the kiosk with your mobile.`);
        }
      }
    }

    for (const r of releaseParked(ws.tokens, ws.ctx)) ws.apply(r);

    // scenario: outage ends
    if (scenario.outage && new Date(scenario.outage.until) <= ws.now) {
      const c = ws.counter(scenario.outage.counter_id);
      ws.putCounter({ ...c, status: "AVAILABLE", status_since: ws.now.toISOString() }, "ONLINE", "System restored");
      delete scenario.outage;
    }

    // bot staff
    for (const c of ws.counters) {
      if ((c as Counter & { human_control?: boolean }).human_control || !c.staff_id) continue;
      botStep(ws, c, rng, roster ?? [], scenario, feedback);
    }
  }

  ws.now = now;
  await ws.flush();
  if (feedback.length) await ws.db.from("feedback").insert(feedback);
  await ws.db.from("sim_state").update({ last_tick: now.toISOString(), scenario }).eq("id", 1);

  let engine = null;
  if (Date.now() - lastEngineAt > 2500) {
    lastEngineAt = Date.now();
    engine = await engineTick(ws);
    await ws.flush({ etas: false });
  }
  return { running: true, now: now.toISOString(), steps, arrivals, engine };
}

function walkIn(ws: Workspace, rng: Rng, serviceId: string, opts: { priority?: PriorityFlag; source?: TokenSource } = {}) {
  const profile = PROFILES[ws.branchId];
  const source: TokenSource = opts.source ?? (chance(rng, profile.greeterShare) ? "GREETER" : chance(rng, 0.25) ? "APP_WALKIN" : "KIOSK");
  const priority: PriorityFlag = opts.priority ?? (chance(rng, profile.priorityRate) ? weightedPick(rng, PRIORITY_MIX) : "NONE");
  const withMobile = chance(rng, 0.6);
  const t = issue(ws, {
    branchId: ws.branchId,
    serviceId,
    source,
    priority,
    name: chance(rng, 0.7) ? randomName(rng) : null,
    mobile: withMobile ? randomMobile(rng) : null,
    aiSummary: source === "APP_WALKIN" ? { summary: `${SERVICE_BY_ID[serviceId].name} (from app intake)`, confidence: 0.9 } : null,
  });
  if (withMobile) smsIssued(ws, t);
  return t;
}

function botStep(ws: Workspace, c: Counter, rng: Rng, roster: { staff_id: string; breaks: { start: string; minutes: number; actual_minutes?: number }[] }[], scenario: Scenario, feedback: Record<string, unknown>[]) {
  const now = ws.now;
  const iso = now.toISOString();
  if (c.status === "OFFLINE") return;

  if (c.status === "ON_BREAK") {
    const end = scenario.unplanned_break?.counter_id === c.id ? scenario.unplanned_break.actual_end : c.break_expected_end;
    if (!end || new Date(end) <= now) {
      ws.putCounter({ ...c, status: "AVAILABLE", status_since: iso, break_expected_end: null, break_reason: null }, "BREAK_END");
      if (scenario.unplanned_break?.counter_id === c.id) delete scenario.unplanned_break;
    }
    return;
  }

  const cur = currentToken(ws, c);
  if (!cur) {
    // planned lunch/short breaks from the roster
    const r = roster.find((x) => x.staff_id === c.staff_id);
    const { date, minutes } = istParts(now);
    for (const br of r?.breaks ?? []) {
      const key = `${c.id}:${date}:${br.start}`;
      if (!breaksTaken.has(key) && minutes >= toMinutes(br.start) && minutes < toMinutes(br.start) + 60) {
        breaksTaken.add(key);
        ws.putCounter({ ...c, status: "ON_BREAK", status_since: iso, break_reason: br.minutes >= 30 ? "lunch" : "short", break_expected_end: new Date(now.getTime() + br.minutes * 60000).toISOString() }, "BREAK_START", br.minutes >= 30 ? "lunch" : "short");
        return;
      }
    }
    const res = ws.apply(callNext(ws.tokens, c, ws.skillsOf(c), ws.ctx));
    if (res) ws.sms(res.token, `Token ${res.token.code}, please go to Counter ${c.number} now.`);
    return;
  }

  if (cur.status === "CALLED") {
    if (minutesBetween(cur.called_at!, now) < 1) return;
    const r = tokenRng(cur, `show${cur.skip_count}`);
    if (r() < 0.03) ws.apply(skip(cur, c, ws.tokens, ws.ctx));
    else ws.apply(startServing(cur, c, ws.ctx));
    return;
  }

  // SERVING: finish after a lognormal handle time (deterministic per token)
  const avg = (ws.ctx.avgHandle?.[cur.service_id] ?? SERVICE_BY_ID[cur.service_id].avg_handle_min) * PROFILES[ws.branchId].handleSpeed;
  const handle = Math.max(1, lognormalMean(tokenRng(cur, "handle"), avg, 0.35));
  if (minutesBetween(cur.serving_started_at!, now) < handle) return;
  const r = tokenRng(cur, "done");
  if (!cur.returning_boost) {
    for (const [target, p] of TRANSFERS[cur.service_id] ?? []) {
      if (r() < p * 1.5) {
        ws.apply(transfer(cur, c, target, "Customer actually needs " + SERVICE_BY_ID[target].name, ws.ctx));
        return;
      }
    }
  }
  const outcome = weightedPick<TokenOutcome>(r, { RESOLVED: 0.86, PARTIALLY_RESOLVED: 0.09, NEEDS_FOLLOW_UP: 0.05 });
  const svc = SERVICE_BY_ID[cur.service_id];
  const done = ws.apply(complete(cur, c, outcome, svc.digital_level === "FULL" && r() < 0.4, ws.ctx));
  if (done.token.mobile_masked) ws.sms(done.token, `Thank you for visiting Sample Demo Bank. Rate your visit: /customer/token/${done.token.id}`);
  if (r() < 0.3) {
    const wait = minutesBetween(cur.original_arrival_at, new Date(cur.called_at!));
    const rating = Math.min(5, Math.max(1, Math.round(4.7 - 1.1 * Math.max(0, wait / svc.target_wait_min - 0.8) + (r() - 0.5))));
    const { comment, topics } = makeComment(r, rating, { waitMin: wait, targetWaitMin: svc.target_wait_min, transferred: false, partial: outcome !== "RESOLVED", serviceName: svc.name });
    feedback.push({ token_id: cur.id, branch_id: ws.branchId, rating, comment, sentiment: sentimentFor(rating), topics, at: iso });
  }
}

// ---------------------------------------------------------------- scenarios

export async function runScenario(name: "salary_rush" | "unplanned_break" | "outage" | "senior_group") {
  const sim = await getSim();
  const branchId = sim.branch_id ?? "BR01";
  const ws = await Workspace.load(branchId);
  const now = ws.now;
  const rng = createRng(hashSeed(`${name}:${now.toISOString()}`));
  const scenario: Scenario = { ...(sim.scenario ?? {}) };
  let message = "";

  if (name === "salary_rush") {
    scenario.surge = { until: new Date(now.getTime() + 90 * 60000).toISOString(), factor: 2.2 };
    for (let i = 0; i < 12; i++) walkIn(ws, rng, weightedPick(rng, serviceWeights(PROFILES[branchId], i % 3 === 2 ? "STANDARD" : "QUICK")));
    message = "Salary-day rush: 12 customers just walked in and arrivals run at 2.2× for the next 90 min.";
  } else if (name === "unplanned_break") {
    const c = ws.counters.find((x) => x.status === "AVAILABLE" && x.staff_id && ws.skillsOf(x).includes("STANDARD")) ?? ws.counters.find((x) => x.status === "AVAILABLE" && x.staff_id);
    if (!c) throw new Error("No available counter to send on break");
    ws.putCounter({ ...c, status: "ON_BREAK", status_since: now.toISOString(), break_reason: "unplanned", break_expected_end: new Date(now.getTime() + 15 * 60000).toISOString() }, "BREAK_START", "unplanned");
    scenario.unplanned_break = { counter_id: c.id, actual_end: new Date(now.getTime() + 45 * 60000).toISOString() };
    message = `${ws.staff.find((s) => s.id === c.staff_id)?.name} (Counter ${c.number}) left for a "15 min" break that will actually last 45 min.`;
  } else if (name === "outage") {
    const c = ws.counters.find((x) => x.status === "SERVING") ?? ws.counters.find((x) => x.status === "AVAILABLE");
    if (!c) throw new Error("No online counter");
    const cur = currentToken(ws, c);
    if (cur) ws.apply(transfer(cur, c, cur.service_id, "Counter system outage — back in the queue with priority", ws.ctx));
    ws.putCounter({ ...ws.counter(c.id), status: "OFFLINE", status_since: now.toISOString() }, "OUTAGE", "Counter system outage");
    scenario.outage = { counter_id: c.id, until: new Date(now.getTime() + 30 * 60000).toISOString() };
    message = `Counter ${c.number} system is down for 30 min${cur ? `; ${cur.code} moved back to the queue with priority` : ""}.`;
  } else if (name === "senior_group") {
    const services = ["life_certificate", "passbook_update", "fd_open_close", "life_certificate", "nominee_update", "life_certificate", "cash_withdrawal", "kyc_update"];
    for (const s of services) walkIn(ws, rng, s, { priority: "SENIOR", source: "GREETER" });
    message = "A group of 8 senior citizens arrived (greeter-assisted, mostly pension work).";
  }
  await ws.flush();
  await ws.db.from("sim_state").update({ scenario }).eq("id", 1);
  lastEngineAt = 0;
  return { message };
}

// ---------------------------------------------------------------- reset

export async function resetDay(branchId: string) {
  const db = getSupabaseAdmin();
  remindersSent.clear();
  breaksTaken.clear();
  let date = istParts(new Date()).date;
  if (!isWorkingDay(date)) date = nextWorkingDay(date);
  const simNow = fromIst(date, toMinutes(getBranch(branchId)!.open_time));

  const del = (t: string) => db.from(t).delete().not("id", "is", null);
  await Promise.all([del("sms_outbox"), del("app_events"), del("counter_events"), del("alerts"), del("recommendations")]);
  await db.from("feedback").delete().is("visit_id", null);
  await del("tokens");
  await db.from("branch_settings").update({ redirect_to: null, redirect_message: null });
  // undo staff lending
  await Promise.all(STAFF.map((s) => db.from("staff").update({ branch_id: s.branch_id }).eq("id", s.id).neq("branch_id", s.branch_id)));

  const { data: roster } = await db.from("rosters").select("staff_id, absent").eq("date", date);
  const absent = new Set((roster ?? []).filter((r) => r.absent).map((r) => r.staff_id));
  await Promise.all(
    COUNTERS.map((c) => {
      const s = STAFF.find((x) => x.id === c.staff_id);
      const officer = s && s.skills.length === 4;
      const online = c.branch_id === branchId && s && !absent.has(s.id) && !officer;
      return db
        .from("counters")
        .update({
          staff_id: c.staff_id, mode_skill: c.mode_skill, status: online ? "AVAILABLE" : "OFFLINE",
          status_since: simNow.toISOString(), break_expected_end: null, break_reason: null, human_control: false,
        })
        .eq("id", c.id);
    })
  );

  // today's app appointments (first one uses the demo mobile so kiosk check-in can be shown)
  await db.from("sim_state").upsert({
    id: 1, sim_now: simNow.toISOString(), speed: 0, running: false, updated_at: new Date().toISOString(),
    branch_id: branchId, last_tick: simNow.toISOString(), scenario: {},
  });
  const ws = await Workspace.load(branchId, { now: new Date(simNow.getTime() - 24 * 3600_000) });
  ws.now = new Date(simNow.getTime() - 12 * 3600_000); // booked "yesterday evening"
  const rng = createRng(hashSeed(date + branchId));
  const b = getBranch(branchId)!;
  let first = true;
  for (let m = toMinutes(b.open_time) + 30; m + 30 <= toMinutes(b.close_time); m += 30) {
    const n = randInt(rng, 0, 2);
    for (let k = 0; k < n; k++) {
      const svc = weightedPick(rng, Object.fromEntries(SERVICES.filter((s) => s.category !== "QUICK").map((s) => [s.id, s.category === "COMPLEX" ? 2 : 1])));
      const t = issue(ws, {
        branchId, serviceId: svc, source: "APP_APPOINTMENT", name: first ? "Demo Customer" : randomName(rng),
        mobile: first ? DEMO_MOBILE : randomMobile(rng),
        aiSummary: { summary: `${SERVICE_BY_ID[svc].name} — booked via app`, confidence: 0.9 },
        appointmentStart: fromIst(date, m).toISOString(), appointmentEnd: fromIst(date, m + 30).toISOString(),
      });
      first = false;
      ws.putToken({ ...t, created_at: ws.now.toISOString() });
    }
  }
  await ws.flush({ etas: false });
  return { date, simNow: simNow.toISOString(), branchId, dayStart: istDayStart(simNow).toISOString(), branches: BRANCHES.length };
}
