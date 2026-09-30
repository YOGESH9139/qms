import "server-only";

// Load a branch's live state once, apply any number of pure engine results in memory, recompute ETAs, flush in one go.
// Used by every API action and by the simulator tick.

import type { SupabaseClient } from "@supabase/supabase-js";

import { effectiveNow, istDayStart, type SimState } from "@/lib/clock";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import {
  etaRange,
  learnHandleAvg,
  projectEtas,
  type ActionResult,
  type EventDraft,
  type HandleSample,
  type QueueContext,
} from "@/lib/engine/queue";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Counter, Skill, Staff, Token } from "@/lib/types";

const LIVE = ["BOOKED", "WAITING", "CALLED", "SERVING", "PARKED"];
const avgCache = new Map<string, { at: number; avg: Record<string, number> }>();

export async function getSim(db: SupabaseClient = getSupabaseAdmin()): Promise<SimState> {
  const { data } = await db.from("sim_state").select("*").eq("id", 1).maybeSingle();
  if (data) return data as SimState;
  const now = new Date().toISOString();
  return { sim_now: now, speed: 1, running: true, updated_at: now };
}

export async function learnedAvg(db: SupabaseClient, branchId: string): Promise<Record<string, number>> {
  const hit = avgCache.get(branchId);
  if (hit && Date.now() - hit.at < 60_000) return hit.avg;
  const [hist, today] = await Promise.all([
    db
      .from("visit_history")
      .select("service_id:final_service_id, handle_min, completed_at")
      .eq("branch_id", branchId)
      .eq("status", "COMPLETED")
      .eq("transfer_count", 0)
      .order("completed_at", { ascending: false })
      .limit(1500),
    db
      .from("tokens")
      .select("service_id, serving_started_at, completed_at")
      .eq("branch_id", branchId)
      .eq("status", "COMPLETED")
      .not("serving_started_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(300),
  ]);
  const samples: HandleSample[] = [
    ...(today.data ?? []).map((t) => ({
      service_id: t.service_id as string,
      completed_at: t.completed_at as string,
      handle_min: (new Date(t.completed_at).getTime() - new Date(t.serving_started_at).getTime()) / 60000,
    })),
    ...((hist.data ?? []) as HandleSample[]).map((s) => ({ ...s, handle_min: Number(s.handle_min) })),
  ];
  const avg = learnHandleAvg(samples, SERVICE_BY_ID);
  avgCache.set(branchId, { at: Date.now(), avg });
  return avg;
}

export interface SmsDraft {
  mobile_masked: string;
  token_id: string | null;
  body: string;
  at: string;
}

export class Workspace {
  tokens: Token[] = [];
  counters: Counter[] = [];
  staff: Staff[] = [];
  staffSkills: Record<string, Skill[]> = {};
  events: EventDraft[] = [];
  counterEvents: Record<string, unknown>[] = [];
  smsOut: SmsDraft[] = [];
  private dirtyTokens = new Set<string>();
  private dirtyCounters = new Set<string>();
  private original = new Map<string, string>();

  constructor(
    public db: SupabaseClient,
    public branchId: string,
    public sim: SimState,
    public ctx: QueueContext
  ) {}

  static async load(branchId: string, opts: { db?: SupabaseClient; now?: Date } = {}): Promise<Workspace> {
    const db = opts.db ?? getSupabaseAdmin();
    const sim = await getSim(db);
    const now = opts.now ?? effectiveNow(sim);
    const dayStart = istDayStart(now).toISOString();
    const [tokens, counters, staff, avg] = await Promise.all([
      db.from("tokens").select("*").eq("branch_id", branchId).or(`created_at.gte.${dayStart},status.in.(${LIVE.join(",")})`),
      db.from("counters").select("*").eq("branch_id", branchId).order("number"),
      db.from("staff").select("*").eq("branch_id", branchId),
      learnedAvg(db, branchId),
    ]);
    const err = tokens.error ?? counters.error ?? staff.error;
    if (err) throw new Error(err.message);
    const ws = new Workspace(db, branchId, sim, { now, services: SERVICE_BY_ID, avgHandle: avg });
    ws.tokens = tokens.data as Token[];
    ws.counters = counters.data as Counter[];
    ws.staff = staff.data as Staff[];
    ws.staffSkills = Object.fromEntries(ws.staff.map((s) => [s.id, s.skills]));
    for (const t of ws.tokens) ws.original.set(t.id, JSON.stringify(t));
    return ws;
  }

  get now(): Date {
    return this.ctx.now;
  }

  set now(d: Date) {
    this.ctx.now = d;
  }

  /** Codes in use (today's + live tokens incl. bookings) so new codes never collide. */
  todayCodes(): string[] {
    return this.tokens.map((t) => t.code);
  }

  token(id: string): Token {
    const t = this.tokens.find((x) => x.id === id);
    if (!t) throw new Error("Token not found");
    return t;
  }

  counter(id: string): Counter {
    const c = this.counters.find((x) => x.id === id);
    if (!c) throw new Error("Counter not found");
    return c;
  }

  skillsOf(counter: Counter): Skill[] {
    return counter.staff_id ? (this.staffSkills[counter.staff_id] ?? []) : [];
  }

  putToken(t: Token) {
    const i = this.tokens.findIndex((x) => x.id === t.id);
    if (i >= 0) this.tokens[i] = t;
    else this.tokens.push(t);
    this.dirtyTokens.add(t.id);
  }

  putCounter(c: Counter, type?: string, reason?: string | null, meta?: Record<string, unknown>) {
    const i = this.counters.findIndex((x) => x.id === c.id);
    if (i >= 0) this.counters[i] = c;
    this.dirtyCounters.add(c.id);
    if (type) {
      this.counterEvents.push({ counter_id: c.id, staff_id: c.staff_id, type, reason: reason ?? null, meta: meta ?? null, at: this.now.toISOString() });
    }
  }

  apply<R extends ActionResult | null>(r: R): R {
    if (!r) return r;
    this.putToken(r.token);
    for (const t of r.created ?? []) this.putToken(t);
    if (r.counter) this.putCounter(r.counter);
    this.events.push(...r.events);
    return r;
  }

  sms(token: Pick<Token, "id" | "mobile_masked"> | null, body: string, mobile?: string | null) {
    const to = mobile ?? token?.mobile_masked;
    if (!to) return;
    this.smsOut.push({ mobile_masked: to, token_id: token?.id ?? null, body, at: this.now.toISOString() });
  }

  note(tokenId: string | null, type: string, note: string | null, meta?: Record<string, unknown>) {
    if (!tokenId) return;
    this.events.push({
      token_id: tokenId, type, from_status: null, to_status: null, counter_id: null, staff_id: null, note, meta: meta ?? null,
      at: this.now.toISOString(),
    });
  }

  recomputeEtas() {
    const etas = projectEtas(this.tokens, this.counters, this.staffSkills, this.ctx);
    for (const t of this.tokens) {
      const e = etas.get(t.id);
      const next = e ?? (["WAITING", "PARKED"].includes(t.status) ? { eta_minutes: null, position: null } : null);
      if (!next) continue;
      if (t.eta_minutes !== next.eta_minutes || t.position !== next.position) {
        this.putToken({ ...t, ...next });
      }
    }
  }

  /** Projected wait (minutes) for a new arrival per category = latest ETA among waiting tokens of that category. */
  waitByCategory(): Record<string, number> {
    const out: Record<string, number> = { QUICK: 0, STANDARD: 0, COMPLEX: 0 };
    for (const t of this.tokens) {
      if (t.status !== "WAITING" || t.eta_minutes == null) continue;
      const cat = SERVICE_BY_ID[t.service_id].category;
      out[cat] = Math.max(out[cat], t.eta_minutes);
    }
    return out;
  }

  async flush(opts: { etas?: boolean } = {}) {
    if (opts.etas !== false) this.recomputeEtas();
    const db = this.db;
    const tokens = this.tokens.filter((t) => this.dirtyTokens.has(t.id) && this.original.get(t.id) !== JSON.stringify(t));
    const counters = this.counters.filter((c) => this.dirtyCounters.has(c.id));
    const ops: PromiseLike<{ error: { message: string } | null }>[] = [];
    if (tokens.length) ops.push(db.from("tokens").upsert(tokens.map((t) => ({ language: "en", mobile_hash: null, ...t }))));
    for (const c of counters) {
      const { id, ...rest } = c;
      ops.push(db.from("counters").update(rest).eq("id", id));
    }
    const results = await Promise.all(ops);
    const err = results.find((r) => r.error)?.error;
    if (err) throw new Error(err.message);
    // events after tokens exist (FK)
    const after: PromiseLike<{ error: { message: string } | null }>[] = [];
    if (this.events.length) after.push(db.from("token_events").insert(this.events.map((e) => ({ ...e, branch_id: this.branchId }))));
    if (this.counterEvents.length) after.push(db.from("counter_events").insert(this.counterEvents));
    if (this.smsOut.length) after.push(db.from("sms_outbox").insert(this.smsOut));
    const r2 = await Promise.all(after);
    const err2 = r2.find((r) => r.error)?.error;
    if (err2) throw new Error(err2.message);
    for (const t of tokens) this.original.set(t.id, JSON.stringify(t));
    this.dirtyTokens.clear();
    this.dirtyCounters.clear();
    this.events = [];
    this.counterEvents = [];
    this.smsOut = [];
  }
}

export function etaText(eta: number | null): string {
  const r = etaRange(eta);
  if (!r) return "soon";
  return r.low === 0 ? "under 5 min" : `~${r.low}–${r.high} min`;
}
