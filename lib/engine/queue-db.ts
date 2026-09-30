import "server-only";

// Thin persistence layer for the pure queue engine: load branch state -> run a pure action -> save -> recompute ETAs.

import type { SupabaseClient } from "@supabase/supabase-js";

import { SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Counter, Skill, Token } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { learnHandleAvg, projectEtas, type ActionResult, type HandleSample, type QueueContext } from "./queue";

export interface BranchQueue {
  ctx: QueueContext;
  tokens: Token[]; // today's tokens (all statuses — codes need them)
  counters: Counter[];
  staffSkills: Record<string, Skill[]>;
}

const LIVE: Token["status"][] = ["BOOKED", "WAITING", "CALLED", "SERVING", "PARKED"];

function startOfDayIst(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return `${ist}T00:00:00+05:30`;
}

export async function loadLearnedAvg(db: SupabaseClient, branchId: string): Promise<Record<string, number>> {
  const [hist, today] = await Promise.all([
    db
      .from("visit_history")
      .select("service_id:final_service_id, handle_min, completed_at")
      .eq("branch_id", branchId)
      .eq("status", "COMPLETED")
      .eq("transfer_count", 0)
      .order("completed_at", { ascending: false })
      .limit(3000),
    db
      .from("tokens")
      .select("service_id, serving_started_at, completed_at")
      .eq("branch_id", branchId)
      .eq("status", "COMPLETED")
      .not("serving_started_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(500),
  ]);
  const samples: HandleSample[] = [
    ...((hist.data ?? []) as HandleSample[]).map((s) => ({ ...s, handle_min: Number(s.handle_min) })),
    ...(today.data ?? []).map((t) => ({
      service_id: t.service_id as string,
      completed_at: t.completed_at as string,
      handle_min: (new Date(t.completed_at).getTime() - new Date(t.serving_started_at).getTime()) / 60000,
    })),
  ];
  return learnHandleAvg(samples, SERVICE_BY_ID);
}

export async function loadBranchQueue(branchId: string, now: Date, db = getSupabaseAdmin()): Promise<BranchQueue> {
  const [tokens, counters, staff, avgHandle] = await Promise.all([
    db.from("tokens").select("*").eq("branch_id", branchId).or(`created_at.gte.${startOfDayIst(now)},status.in.(${LIVE.join(",")})`),
    db.from("counters").select("*").eq("branch_id", branchId).order("number"),
    db.from("staff").select("id, skills").eq("branch_id", branchId),
    loadLearnedAvg(db, branchId),
  ]);
  const err = tokens.error ?? counters.error ?? staff.error;
  if (err) throw new Error(err.message);
  return {
    ctx: { now, services: SERVICE_BY_ID, avgHandle },
    tokens: tokens.data as Token[],
    counters: counters.data as Counter[],
    staffSkills: Object.fromEntries((staff.data ?? []).map((s) => [s.id, s.skills as Skill[]])),
  };
}

export async function saveResult(result: ActionResult, db = getSupabaseAdmin()): Promise<void> {
  const tokens = [result.token, ...(result.created ?? [])];
  const { error: tErr } = await db.from("tokens").upsert(tokens);
  if (tErr) throw new Error(tErr.message);
  if (result.counter) {
    const { id, ...rest } = result.counter;
    const { error } = await db.from("counters").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
  }
  if (result.events.length) {
    const { error } = await db.from("token_events").insert(result.events);
    if (error) throw new Error(error.message);
  }
}

/** Recompute eta_minutes + position for every live token of the branch (call after each event). */
export async function recomputeEtas(q: BranchQueue, db = getSupabaseAdmin()): Promise<void> {
  const etas = projectEtas(q.tokens, q.counters, q.staffSkills, q.ctx);
  const changed = q.tokens
    .filter((t) => etas.has(t.id))
    .map((t) => ({ ...t, ...etas.get(t.id)! }))
    .filter((t) => {
      const old = q.tokens.find((o) => o.id === t.id)!;
      return old.eta_minutes !== t.eta_minutes || old.position !== t.position;
    });
  if (changed.length) {
    const { error } = await db.from("tokens").upsert(changed);
    if (error) throw new Error(error.message);
  }
}

/**
 * Load -> run pure action -> save -> recompute ETAs. The action gets fresh state and returns an ActionResult
 * (or null for "nothing to do", e.g. Call next with an empty queue).
 */
export async function runQueueAction<R extends ActionResult | null>(
  branchId: string,
  action: (q: BranchQueue) => R,
  now = new Date()
): Promise<R> {
  const db = getSupabaseAdmin();
  const q = await loadBranchQueue(branchId, now, db);
  const result = action(q);
  if (result) {
    await saveResult(result, db);
    const merge = [result.token, ...(result.created ?? [])];
    q.tokens = [...q.tokens.filter((t) => !merge.some((m) => m.id === t.id)), ...merge];
    if (result.counter) q.counters = q.counters.map((c) => (c.id === result.counter!.id ? result.counter! : c));
  }
  await recomputeEtas(q, db);
  return result;
}
