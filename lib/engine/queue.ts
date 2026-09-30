// Queue engine (CLAUDE.md section 7). Pure functions over plain objects — no DB, no clock.
// Every action returns the updated token/counter plus token_events drafts; lib/engine/queue-db.ts persists them.

import type { Counter, Service, Skill, Token, TokenEvent, TokenOutcome, TokenStatus } from "@/lib/types";
import { APPOINTMENT_EARLY_MIN, scoreToken } from "./scoring";

// ---------------------------------------------------------------- constants

export const LATE_GRACE_MIN = 15; // late > 15 min after window end -> walk-in
export const LATE_KEEP_BOOST_MIN = 5; // "keeps a small boost": counted as arrived 5 min earlier
export const SKIP_BACK_PLACES = 3;
export const MAX_RECALLS = 1;
export const PARK_MIN = 10;
export const PARK_MAX = 30;
export const LEARN_WINDOW = 30; // rolling mean of last 30 handle times

const FINAL: TokenStatus[] = ["COMPLETED", "TRANSFERRED", "NO_SHOW", "CANCELLED"];

const ALLOWED: Record<TokenStatus, TokenStatus[]> = {
  BOOKED: ["WAITING", "CANCELLED"],
  WAITING: ["CALLED", "CANCELLED"],
  CALLED: ["SERVING", "WAITING", "NO_SHOW", "PARKED", "CANCELLED"],
  SERVING: ["COMPLETED", "WAITING", "PARKED", "CANCELLED"],
  PARKED: ["WAITING", "CANCELLED"],
  COMPLETED: [],
  TRANSFERRED: [],
  NO_SHOW: [],
  CANCELLED: [],
};

// ---------------------------------------------------------------- types

export type EventDraft = Omit<TokenEvent, "id"> & { meta?: Record<string, unknown> | null };

export interface QueueContext {
  now: Date;
  services: Record<string, Service>;
  /** Learned per-branch handle times (see learnHandleAvg). Falls back to catalog avg_handle_min. */
  avgHandle?: Record<string, number>;
}

export interface ActionResult {
  token: Token;
  counter?: Counter;
  events: EventDraft[];
  /** Tokens created by the action (add-service). */
  created?: Token[];
}

export class QueueError extends Error {}

// ---------------------------------------------------------------- helpers

const iso = (d: Date) => d.toISOString();
const ms = (s: string) => new Date(s).getTime();
export const minutesBetween = (from: string | Date, to: Date) =>
  (to.getTime() - (typeof from === "string" ? ms(from) : from.getTime())) / 60000;

export function avgHandleFor(ctx: QueueContext, serviceId: string): number {
  return ctx.avgHandle?.[serviceId] ?? svc(ctx, serviceId).avg_handle_min;
}

function svc(ctx: QueueContext, id: string): Service {
  const s = ctx.services[id];
  if (!s) throw new QueueError(`Unknown service ${id}`);
  return s;
}

function event(
  token: Token,
  type: string,
  from: TokenStatus | null,
  to: TokenStatus | null,
  ctx: QueueContext,
  counter?: Counter | null,
  note?: string | null,
  meta?: Record<string, unknown>
): EventDraft {
  return {
    token_id: token.id,
    type,
    from_status: from,
    to_status: to,
    counter_id: counter?.id ?? token.counter_id ?? null,
    staff_id: counter?.staff_id ?? null,
    note: note ?? null,
    meta: meta ?? null,
    at: iso(ctx.now),
  };
}

/** Guarded status change + audit event. Every transition goes through here. */
function move(
  token: Token,
  to: TokenStatus,
  type: string,
  ctx: QueueContext,
  patch: Partial<Token> = {},
  counter?: Counter | null,
  note?: string | null,
  meta?: Record<string, unknown>
): { token: Token; ev: EventDraft } {
  if (!ALLOWED[token.status].includes(to)) {
    throw new QueueError(`Cannot ${type} a ${token.status} token (${token.code})`);
  }
  const next = { ...token, ...patch, status: to };
  return { token: next, ev: event(token, type, token.status, to, ctx, counter, note, meta) };
}

function freeCounter(counter: Counter | undefined, ctx: QueueContext): Counter | undefined {
  return counter && { ...counter, status: "AVAILABLE", status_since: iso(ctx.now) };
}

const clearCall = { counter_id: null, called_at: null, serving_started_at: null } satisfies Partial<Token>;

// ---------------------------------------------------------------- codes + issue

export function tokenPrefix(service: Service, appointment: boolean): "Q" | "S" | "C" | "A" {
  if (appointment) return "A";
  return service.category === "QUICK" ? "Q" : service.category === "STANDARD" ? "S" : "C";
}

/** Next code for a prefix given today's codes at the branch: Q001, Q002, ... */
export function nextTokenCode(prefix: string, existingCodes: string[]): string {
  const max = existingCodes
    .filter((c) => c.startsWith(prefix))
    .reduce((m, c) => Math.max(m, Number(c.slice(1)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export type IssueInput = Pick<Token, "branch_id" | "service_id" | "source"> &
  Partial<Pick<Token, "customer_name" | "mobile_masked" | "priority_flag" | "ai_summary" | "appointment_start" | "appointment_end">>;

/** Walk-ins start WAITING; app appointments start BOOKED until check-in. */
export function issueToken(input: IssueInput, existingCodes: string[], ctx: QueueContext, id = crypto.randomUUID()): ActionResult {
  const appointment = input.source === "APP_APPOINTMENT";
  const code = nextTokenCode(tokenPrefix(svc(ctx, input.service_id), appointment), existingCodes);
  const now = iso(ctx.now);
  const token: Token = {
    id,
    branch_id: input.branch_id,
    code,
    service_id: input.service_id,
    customer_name: input.customer_name ?? null,
    mobile_masked: input.mobile_masked ?? null,
    source: input.source,
    priority_flag: input.priority_flag ?? "NONE",
    status: appointment ? "BOOKED" : "WAITING",
    created_at: now,
    appointment_start: input.appointment_start ?? null,
    appointment_end: input.appointment_end ?? null,
    checked_in_at: appointment ? null : now,
    called_at: null,
    serving_started_at: null,
    completed_at: null,
    counter_id: null,
    recall_count: 0,
    skip_count: 0,
    parked_until: null,
    original_arrival_at: appointment ? (input.appointment_start ?? now) : now,
    returning_boost: false,
    parent_token_id: null,
    ai_summary: input.ai_summary ?? null,
    outcome: null,
    could_be_digital: null,
    eta_minutes: null,
    position: null,
  };
  return { token, events: [event(token, "CREATED", null, token.status, ctx)] };
}

// ---------------------------------------------------------------- appointments

/** Kiosk check-in by mobile/QR. Late > 15 min after the window -> normal walk-in with a small boost. */
export function checkIn(token: Token, ctx: QueueContext): ActionResult {
  const late = token.appointment_end != null && minutesBetween(token.appointment_end, ctx.now) > LATE_GRACE_MIN;
  if (late) {
    const { token: t, ev } = move(token, "WAITING", "LATE_CONVERTED", ctx, {
      checked_in_at: iso(ctx.now),
      appointment_start: null,
      appointment_end: null,
      original_arrival_at: iso(new Date(ctx.now.getTime() - LATE_KEEP_BOOST_MIN * 60000)),
    }, null, "Arrived after appointment window; converted to walk-in", {
      appointment_start: token.appointment_start,
      appointment_end: token.appointment_end,
    });
    return { token: t, events: [ev] };
  }
  // On time or early: waiting time counts from the later of arrival and window start.
  const arrival = token.appointment_start && ms(token.appointment_start) > ctx.now.getTime() ? token.appointment_start : iso(ctx.now);
  const { token: t, ev } = move(token, "WAITING", "CHECK_IN", ctx, { checked_in_at: iso(ctx.now), original_arrival_at: arrival });
  return { token: t, events: [ev] };
}

export function inAppointmentWindow(token: Token, at: Date): boolean {
  if (!token.appointment_start || !token.appointment_end) return false;
  const t = at.getTime();
  return t >= ms(token.appointment_start) && t <= ms(token.appointment_end);
}

// ---------------------------------------------------------------- eligibility + scoring (7.1)

export function isEligible(token: Token, staffSkills: readonly Skill[], ctx: QueueContext, at: Date = ctx.now): boolean {
  if (token.status !== "WAITING") return false;
  if (token.parked_until && ms(token.parked_until) > at.getTime()) return false;
  if (!staffSkills.includes(svc(ctx, token.service_id).skill)) return false;
  if (token.appointment_start && at.getTime() < ms(token.appointment_start) - APPOINTMENT_EARLY_MIN * 60000) return false;
  return true;
}

export function scoreFor(token: Token, counter: Pick<Counter, "mode_skill">, ctx: QueueContext, at: Date = ctx.now) {
  const s = svc(ctx, token.service_id);
  return scoreToken({
    minutesWaited: minutesBetween(token.original_arrival_at, at),
    priorityFlag: token.priority_flag,
    appointmentInWindow: inAppointmentWindow(token, at),
    returning: token.returning_boost,
    serviceSkill: s.skill,
    counterModeSkill: counter.mode_skill,
    targetWaitMin: s.target_wait_min,
  });
}

export interface PickResult {
  token: Token;
  score: number;
  reasons: string[];
}

/** Best eligible token for a counter, or null. Ties go to the earliest original arrival. */
export function pickNext(
  tokens: Token[],
  counter: Pick<Counter, "mode_skill">,
  staffSkills: readonly Skill[],
  ctx: QueueContext,
  at: Date = ctx.now
): PickResult | null {
  let best: PickResult | null = null;
  for (const t of tokens) {
    if (!isEligible(t, staffSkills, ctx, at)) continue;
    const { score, reasons } = scoreFor(t, counter, ctx, at);
    if (
      !best ||
      score > best.score ||
      (score === best.score && ms(t.original_arrival_at) < ms(best.token.original_arrival_at))
    ) {
      best = { token: t, score, reasons };
    }
  }
  return best;
}

// ---------------------------------------------------------------- counter actions on tokens

/** Pull-based "Call next". Returns null when nothing is eligible. */
export function callNext(
  tokens: Token[],
  counter: Counter,
  staffSkills: readonly Skill[],
  ctx: QueueContext
): (ActionResult & { counter: Counter; reasons: string[]; score: number }) | null {
  if (counter.status === "OFFLINE" || counter.status === "ON_BREAK") {
    throw new QueueError(`Counter ${counter.number} is ${counter.status}`);
  }
  const best = pickNext(tokens, counter, staffSkills, ctx);
  if (!best) return null;
  const { token, ev } = move(best.token, "CALLED", "CALL", ctx, { called_at: iso(ctx.now), counter_id: counter.id }, counter, null, {
    reasons: best.reasons,
    score: best.score,
  });
  return {
    token,
    counter: { ...counter, status: "SERVING", status_since: iso(ctx.now) },
    events: [ev],
    reasons: best.reasons,
    score: best.score,
  };
}

export function recall(token: Token, ctx: QueueContext): ActionResult {
  if (token.status !== "CALLED") throw new QueueError(`Cannot recall a ${token.status} token`);
  if (token.recall_count >= MAX_RECALLS) throw new QueueError("Already recalled once");
  const t = { ...token, recall_count: token.recall_count + 1 };
  return { token: t, events: [event(token, "RECALL", "CALLED", "CALLED", ctx)] };
}

export function startServing(token: Token, counter: Counter, ctx: QueueContext): ActionResult {
  const { token: t, ev } = move(token, "SERVING", "START", ctx, { serving_started_at: iso(ctx.now) }, counter);
  return { token: t, counter, events: [ev] };
}

/**
 * "Not here". 1st miss: back to WAITING, moved back 3 places in its skill queue.
 * 2nd miss: NO_SHOW. The counter is freed either way.
 */
export function skip(token: Token, counter: Counter, allTokens: Token[], ctx: QueueContext): ActionResult {
  if (token.status !== "CALLED") throw new QueueError(`Cannot skip a ${token.status} token`);
  const counterOut = freeCounter(counter, ctx);
  if (token.skip_count >= 1) {
    const { token: t, ev } = move(token, "NO_SHOW", "NO_SHOW", ctx, { skip_count: token.skip_count + 1, counter_id: null }, counter, "Not present after 2 calls");
    return { token: t, counter: counterOut, events: [ev] };
  }
  const skill = svc(ctx, token.service_id).skill;
  const line = allTokens
    .filter((o) => o.id !== token.id && o.status === "WAITING" && svc(ctx, o.service_id).skill === skill)
    .sort((a, b) => ms(a.original_arrival_at) - ms(b.original_arrival_at));
  const anchor = line[Math.min(SKIP_BACK_PLACES, line.length) - 1];
  const newArrival = anchor
    ? iso(new Date(Math.max(ms(token.original_arrival_at), ms(anchor.original_arrival_at) + 1000)))
    : token.original_arrival_at;
  const { token: t, ev } = move(
    token,
    "WAITING",
    "SKIP",
    ctx,
    { ...clearCall, skip_count: 1, original_arrival_at: newArrival },
    counter,
    `Not here; moved back ${Math.min(SKIP_BACK_PLACES, line.length)} places`,
    { previous_arrival_at: token.original_arrival_at }
  );
  return { token: t, counter: counterOut, events: [ev] };
}

export function complete(
  token: Token,
  counter: Counter,
  outcome: TokenOutcome,
  couldBeDigital: boolean,
  ctx: QueueContext
): ActionResult {
  const { token: t, ev } = move(token, "COMPLETED", "COMPLETE", ctx, {
    completed_at: iso(ctx.now),
    outcome,
    could_be_digital: couldBeDigital,
    eta_minutes: null,
    position: null,
  }, counter, null, { handle_min: token.serving_started_at ? minutesBetween(token.serving_started_at, ctx.now) : null });
  return { token: t, counter: freeCounter(counter, ctx), events: [ev] };
}

/** Transfer to another service/skill. Keeps original_arrival_at, adds the +20 returning boost. */
export function transfer(token: Token, counter: Counter, targetServiceId: string, note: string | null, ctx: QueueContext): ActionResult {
  svc(ctx, targetServiceId);
  const { token: t, ev } = move(token, "WAITING", "TRANSFER", ctx, {
    ...clearCall,
    service_id: targetServiceId,
    returning_boost: true,
    recall_count: 0,
    skip_count: 0,
  }, counter, note, { from_service_id: token.service_id, to_service_id: targetServiceId });
  return { token: t, counter: freeCounter(counter, ctx), events: [ev] };
}

/** Customer steps away (missing document / photocopy) for 10–30 min. */
export function park(token: Token, counter: Counter, minutes: number, note: string | null, ctx: QueueContext): ActionResult {
  const m = Math.min(PARK_MAX, Math.max(PARK_MIN, minutes));
  const { token: t, ev } = move(token, "PARKED", "PARK", ctx, {
    ...clearCall,
    parked_until: iso(new Date(ctx.now.getTime() + m * 60000)),
  }, counter, note, { minutes: m });
  return { token: t, counter: freeCounter(counter, ctx), events: [ev] };
}

export function returnFromPark(token: Token, ctx: QueueContext): ActionResult {
  const { token: t, ev } = move(token, "WAITING", "RETURN", ctx, { parked_until: null, returning_boost: true });
  return { token: t, events: [ev] };
}

/** Engine tick: parked tokens whose time is up go back to WAITING. */
export function releaseParked(tokens: Token[], ctx: QueueContext): ActionResult[] {
  return tokens
    .filter((t) => t.status === "PARKED" && t.parked_until && ms(t.parked_until) <= ctx.now.getTime())
    .map((t) => returnFromPark(t, ctx));
}

/** Same customer needs a 2nd thing: linked WAITING token at the right skill, with returning boost. */
export function addService(
  token: Token,
  serviceId: string,
  existingCodes: string[],
  ctx: QueueContext,
  id = crypto.randomUUID()
): ActionResult {
  const issued = issueToken(
    {
      branch_id: token.branch_id,
      service_id: serviceId,
      source: "STAFF",
      customer_name: token.customer_name,
      mobile_masked: token.mobile_masked,
      priority_flag: token.priority_flag,
      ai_summary: token.ai_summary,
    },
    existingCodes,
    ctx,
    id
  );
  const created = { ...issued.token, parent_token_id: token.id, returning_boost: true };
  return {
    token,
    created: [created],
    events: [
      event(token, "ADD_SERVICE", token.status, token.status, ctx, null, null, { new_token_id: created.id, service_id: serviceId }),
      { ...issued.events[0], note: `Linked to ${token.code}` },
    ],
  };
}

export function cancel(token: Token, ctx: QueueContext, note: string | null = null): ActionResult {
  if (FINAL.includes(token.status)) throw new QueueError(`Token ${token.code} is already ${token.status}`);
  const { token: t, ev } = move(token, "CANCELLED", "CANCEL", ctx, { eta_minutes: null, position: null }, null, note);
  return { token: t, events: [ev] };
}

// ---------------------------------------------------------------- ETA projection (7.2)

export interface Eta {
  eta_minutes: number | null;
  position: number | null;
}

/**
 * Discrete projection: repeatedly take the counter that frees up first, give it the best eligible token
 * (same scoring, at projected time), advance its free_at by the service's avg handle time.
 * Tokens nobody present can serve get { eta: null, position: null }.
 */
export function projectEtas(
  tokens: Token[],
  counters: Counter[],
  staffSkills: Record<string, readonly Skill[]>,
  ctx: QueueContext
): Map<string, Eta> {
  const now = ctx.now.getTime();
  const queue = tokens.filter((t) => t.status === "WAITING" || t.status === "PARKED");
  const result = new Map<string, Eta>(queue.map((t) => [t.id, { eta_minutes: null, position: null }]));

  const active = counters
    .filter((c) => c.status !== "OFFLINE" && c.staff_id && staffSkills[c.staff_id])
    .map((c) => {
      let freeAt = now;
      if (c.status === "ON_BREAK") {
        freeAt = Math.max(now, c.break_expected_end ? ms(c.break_expected_end) : now);
      } else if (c.status === "SERVING") {
        const cur = tokens.find((t) => t.counter_id === c.id && (t.status === "SERVING" || t.status === "CALLED"));
        if (cur) {
          const elapsed = minutesBetween(cur.serving_started_at ?? cur.called_at ?? iso(ctx.now), ctx.now);
          freeAt = now + Math.max(1, avgHandleFor(ctx, cur.service_id) - elapsed) * 60000;
        }
      }
      return { counter: c, skills: staffSkills[c.staff_id!], freeAt };
    });

  // Projected copies: PARKED tokens become WAITING from parked_until.
  let remaining = queue.map((t) => (t.status === "PARKED" ? { ...t, status: "WAITING" as const, returning_boost: true } : t));
  let position = 0;

  while (remaining.length && active.length) {
    active.sort((a, b) => a.freeAt - b.freeAt);
    const slot = active[0];
    const at = new Date(slot.freeAt);
    const best = pickNext(remaining, slot.counter, slot.skills, ctx, at);
    if (best) {
      result.set(best.token.id, {
        eta_minutes: Math.max(0, Math.round((slot.freeAt - now) / 60000)),
        position: ++position,
      });
      remaining = remaining.filter((t) => t.id !== best.token.id);
      slot.freeAt += avgHandleFor(ctx, best.token.service_id) * 60000;
      continue;
    }
    // Nothing eligible yet: jump to the next time something this counter can serve becomes eligible.
    const later = remaining
      .filter((t) => slot.skills.includes(svc(ctx, t.service_id).skill))
      .map((t) =>
        Math.max(
          t.parked_until ? ms(t.parked_until) : 0,
          t.appointment_start ? ms(t.appointment_start) - APPOINTMENT_EARLY_MIN * 60000 : 0
        )
      )
      .filter((x) => x > slot.freeAt);
    if (later.length) slot.freeAt = Math.min(...later);
    else active.shift(); // this counter can't serve anything left
  }
  return result;
}

/** 5-minute display range: 12 -> "10–15". */
export function etaRange(eta: number | null): { low: number; high: number } | null {
  if (eta == null) return null;
  const low = Math.floor(eta / 5) * 5;
  return { low, high: low + 5 };
}

// ---------------------------------------------------------------- learned handle time (7.2)

export interface HandleSample {
  service_id: string;
  handle_min: number;
  completed_at: string;
}

/** Rolling mean of the last 30 actual handle times per service; catalog value when no samples. */
export function learnHandleAvg(samples: HandleSample[], services: Record<string, Service>): Record<string, number> {
  const byService = new Map<string, HandleSample[]>();
  for (const s of samples) {
    if (!(s.handle_min > 0)) continue;
    const list = byService.get(s.service_id) ?? [];
    list.push(s);
    byService.set(s.service_id, list);
  }
  const out: Record<string, number> = {};
  for (const id of Object.keys(services)) {
    const recent = (byService.get(id) ?? [])
      .sort((a, b) => ms(b.completed_at) - ms(a.completed_at))
      .slice(0, LEARN_WINDOW);
    out[id] = recent.length
      ? Math.round((recent.reduce((acc, s) => acc + s.handle_min, 0) / recent.length) * 100) / 100
      : services[id].avg_handle_min;
  }
  return out;
}
