// Replays one branch-day through the pull-based queue logic (CLAUDE.md 7.1) at 1-minute resolution,
// so the waits in visit_history are consistent with how the live engine routes tokens.

import type { Category, PriorityFlag, Skill, TokenOutcome, TokenSource } from "@/lib/types";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { appointmentEligible, canServe, scoreToken } from "@/lib/engine/scoring";
import { chance, lognormalMean, weightedPick, type Rng } from "@/lib/random";

export interface Arrival {
  serviceId: string;
  arrivalMin: number; // minutes since midnight (local)
  source: TokenSource;
  priority: PriorityFlag;
  appointmentStartMin: number | null;
  /** Appointment booked but customer never came. */
  bookedNoShow: boolean;
  /** Took a token but not present when called. */
  walkinNoShow: boolean;
  patienceMin: number;
}

export interface CounterStaff {
  staffId: string;
  counterNumber: number;
  skills: Skill[];
  modeSkill: Skill;
  speed: number; // personal handle-time multiplier
  startMin: number;
  /** Stops taking new customers from this minute (e.g. officer only helps during the peak). */
  endMin?: number;
  breaks: { startMin: number; minutes: number }[];
}

export interface VisitResult {
  serviceId: string;
  finalServiceId: string;
  category: Category;
  skill: Skill;
  source: TokenSource;
  priority: PriorityFlag;
  arrivalMin: number;
  appointmentStartMin: number | null;
  calledMin: number | null;
  servingStartMin: number | null;
  completedMin: number | null;
  waitMin: number | null;
  firstLegWaitMin: number | null;
  handleMin: number | null;
  status: "COMPLETED" | "NO_SHOW" | "CANCELLED";
  outcome: TokenOutcome | null;
  transferCount: number;
  couldBeDigital: boolean;
  counterNumber: number | null;
  staffId: string | null;
}

// Misrouting ground truth: service -> [target, probability]. Feeds the "most-transferred services" insight.
export const TRANSFERS: Record<string, [string, number][]> = {
  loan_enquiry: [["loan_application", 0.1]],
  complaint_dispute: [
    ["debit_card", 0.06],
    ["kyc_update", 0.04],
  ],
  kyc_update: [["address_mobile_update", 0.08]],
  passbook_update: [["kyc_update", 0.05]],
  debit_card: [["complaint_dispute", 0.04]],
  cash_deposit: [["fd_open_close", 0.02]],
};

interface Live {
  a: Arrival;
  serviceId: string;
  enqueuedMin: number;
  returning: boolean;
  transfers: number;
  waitAccum: number;
  handleAccum: number;
  firstCalled: number | null;
  firstStart: number | null;
  firstLegWait: number | null;
}

interface CounterState {
  cs: CounterStaff;
  freeAt: number;
  current: { t: Live; startMin: number; handle: number; calledMin: number; legWait: number } | null;
  breaks: { startMin: number; minutes: number; taken: boolean }[];
}

const APPT_WINDOW = 30;
const WALK_TO_COUNTER_MIN = 1;
const NO_SHOW_RECALL_MIN = 2;
const MAX_OVERTIME_MIN = 240;

export function replayDay(
  rng: Rng,
  arrivals: Arrival[],
  staff: CounterStaff[],
  closeMin: number,
  branchSpeed: number,
  mode: "BRANCHFLOW" | "FIFO" = "BRANCHFLOW"
): VisitResult[] {
  const results: VisitResult[] = [];
  const pending = arrivals.filter((a) => !a.bookedNoShow).sort((x, y) => x.arrivalMin - y.arrivalMin);

  for (const a of arrivals.filter((x) => x.bookedNoShow)) {
    results.push(emptyResult(a, "NO_SHOW", a.appointmentStartMin ?? a.arrivalMin));
  }

  const counters: CounterState[] = staff.map((cs) => ({
    cs,
    freeAt: cs.startMin,
    current: null,
    breaks: cs.breaks.map((b) => ({ ...b, taken: false })),
  }));

  const waiting: Live[] = [];
  let next = 0;
  const start = Math.min(...pending.map((p) => p.arrivalMin), ...staff.map((s) => s.startMin));

  const finish = (c: CounterState) => {
    const cur = c.current!;
    c.current = null;
    const t = cur.t;
    const doneAt = cur.startMin + cur.handle;
    t.waitAccum += cur.legWait;
    t.handleAccum += cur.handle;
    if (t.firstCalled == null) {
      t.firstCalled = cur.calledMin;
      t.firstStart = cur.startMin;
      t.firstLegWait = cur.legWait;
    }
    const target = t.transfers === 0 ? transferTarget(rng, t.serviceId) : null;
    if (target) {
      t.transfers++;
      t.serviceId = target;
      t.returning = true;
      t.enqueuedMin = doneAt;
      waiting.push(t);
      return;
    }
    const svc = SERVICE_BY_ID[t.a.serviceId];
    results.push({
      ...baseResult(t.a),
      finalServiceId: t.serviceId,
      calledMin: t.firstCalled,
      servingStartMin: t.firstStart,
      completedMin: doneAt,
      waitMin: t.waitAccum,
      firstLegWaitMin: t.firstLegWait,
      handleMin: t.handleAccum,
      status: "COMPLETED",
      outcome: drawOutcome(rng, svc.category, t.transfers > 0),
      transferCount: t.transfers,
      couldBeDigital:
        svc.digital_level === "FULL" ? chance(rng, 0.45) : svc.digital_level === "PARTIAL" ? chance(rng, 0.2) : false,
      counterNumber: c.cs.counterNumber,
      staffId: c.cs.staffId,
    });
  };

  for (let now = start; now <= closeMin + MAX_OVERTIME_MIN; now++) {
    while (next < pending.length && pending[next].arrivalMin <= now) {
      const a = pending[next++];
      waiting.push({
        a,
        serviceId: a.serviceId,
        enqueuedMin: a.arrivalMin,
        returning: false,
        transfers: 0,
        waitAccum: 0,
        handleAccum: 0,
        firstCalled: null,
        firstStart: null,
        firstLegWait: null,
      });
    }

    // Reneging: customers who give up and leave (never those already served once).
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i];
      if (!w.returning && now - w.a.arrivalMin > w.a.patienceMin) {
        waiting.splice(i, 1);
        results.push({ ...emptyResult(w.a, "CANCELLED", w.a.arrivalMin), waitMin: now - w.a.arrivalMin });
      }
    }

    // Counters pull the best eligible token, in random order each minute.
    const order = [...counters].sort(() => rng() - 0.5);
    for (const c of order) {
      if (c.freeAt > now) continue;
      if (c.current) finish(c);
      if (c.cs.endMin != null && now >= c.cs.endMin) continue;

      const brk = c.breaks.find((b) => !b.taken && b.startMin <= now);
      if (brk) {
        brk.taken = true;
        c.freeAt = now + brk.minutes;
        continue;
      }

      let best: { idx: number; score: number } | null = null;
      for (let i = 0; i < waiting.length; i++) {
        const w = waiting[i];
        const svc = SERVICE_BY_ID[w.serviceId];
        if (w.enqueuedMin > now) continue;
        if (!canServe(c.cs.skills, svc.skill)) continue;
        if (!appointmentEligible(now, w.a.appointmentStartMin)) continue;
        const appt = w.a.appointmentStartMin;
        // FIFO baseline: single queue, oldest ticket first (no priority, appointment, focus or SLA logic)
        const { score } = mode === "FIFO" ? { score: now - w.a.arrivalMin } : scoreToken({
          minutesWaited: now - w.a.arrivalMin,
          priorityFlag: w.a.priority,
          appointmentInWindow: appt != null && now >= appt && now <= appt + APPT_WINDOW,
          returning: w.returning,
          serviceSkill: svc.skill,
          counterModeSkill: c.cs.modeSkill,
          targetWaitMin: svc.target_wait_min,
        });
        if (!best || score > best.score) best = { idx: i, score };
      }
      if (!best) continue;

      const [t] = waiting.splice(best.idx, 1);
      if (t.a.walkinNoShow && !t.returning) {
        c.freeAt = now + NO_SHOW_RECALL_MIN;
        results.push({ ...emptyResult(t.a, "NO_SHOW", t.a.arrivalMin), calledMin: now, waitMin: now - t.a.arrivalMin });
        continue;
      }
      const svc = SERVICE_BY_ID[t.serviceId];
      const handle = Math.max(1, lognormalMean(rng, svc.avg_handle_min * branchSpeed * c.cs.speed, 0.4));
      const waitFrom = Math.max(t.enqueuedMin, t.a.appointmentStartMin ?? -Infinity);
      const startMin = now + WALK_TO_COUNTER_MIN * (0.5 + rng());
      c.current = { t, startMin, handle, calledMin: now, legWait: Math.max(0, now - waitFrom) };
      c.freeAt = startMin + handle;
    }

    const busy = counters.some((c) => c.current || c.freeAt > now);
    if (now >= closeMin && next >= pending.length && waiting.length === 0 && !busy) break;
    // After close, stop if nobody present can serve what is left.
    if (now >= closeMin && next >= pending.length && !busy) {
      const servable = waiting.some((w) => counters.some((c) => canServe(c.cs.skills, SERVICE_BY_ID[w.serviceId].skill)));
      if (!servable) break;
    }
  }

  for (const c of counters) if (c.current) finish(c);
  for (const w of waiting) {
    results.push({ ...emptyResult(w.a, "CANCELLED", w.a.arrivalMin), waitMin: closeMin - w.a.arrivalMin });
  }
  return results;
}

function transferTarget(rng: Rng, serviceId: string): string | null {
  for (const [target, p] of TRANSFERS[serviceId] ?? []) {
    if (chance(rng, p)) return target;
  }
  return null;
}

function drawOutcome(rng: Rng, category: Category, transferred: boolean): TokenOutcome {
  const w =
    category === "COMPLEX" || transferred
      ? { RESOLVED: 0.75, PARTIALLY_RESOLVED: 0.15, NEEDS_FOLLOW_UP: 0.1 }
      : { RESOLVED: 0.88, PARTIALLY_RESOLVED: 0.08, NEEDS_FOLLOW_UP: 0.04 };
  return weightedPick<TokenOutcome>(rng, w);
}

function baseResult(a: Arrival) {
  const svc = SERVICE_BY_ID[a.serviceId];
  return {
    serviceId: a.serviceId,
    category: svc.category,
    skill: svc.skill,
    source: a.source,
    priority: a.priority,
    arrivalMin: a.arrivalMin,
    appointmentStartMin: a.appointmentStartMin,
  };
}

function emptyResult(a: Arrival, status: VisitResult["status"], arrivalMin: number): VisitResult {
  return {
    ...baseResult(a),
    arrivalMin,
    finalServiceId: a.serviceId,
    calledMin: null,
    servingStartMin: null,
    completedMin: null,
    waitMin: null,
    firstLegWaitMin: null,
    handleMin: null,
    status,
    outcome: null,
    transferCount: 0,
    couldBeDigital: false,
    counterNumber: null,
    staffId: null,
  };
}
