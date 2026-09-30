"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { effectiveNow, type SimState } from "@/lib/clock";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Alert, Counter, Recommendation, Staff, Token } from "@/lib/types";

export async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/**
 * Subscribe to Supabase Realtime changes on some tables and call `onChange` (debounced).
 * Also polls every `pollMs` as a safety net, so screens stay live even if Realtime is blocked.
 */
export function useRealtime(tables: string[], onChange: () => void, filter?: string, pollMs = 4000) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(",") + (filter ?? "");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        cb.current();
      }, 250);
    };
    const sb = getSupabaseBrowser();
    const channel = sb?.channel(`bf-${key}-${Math.random().toString(36).slice(2)}`);
    if (sb && channel) {
      for (const table of tables) {
        channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter && table !== "sim_state" && table !== "sms_outbox" ? { filter } : {}) }, fire);
      }
      channel.subscribe();
    }
    const poll = setInterval(() => cb.current(), pollMs);
    return () => {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      if (sb && channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pollMs]);
}

export interface BranchState {
  now: string;
  sim: SimState;
  tokens: Token[];
  counters: Counter[];
  staff: Omit<Staff, "pin">[];
  avgHandle: Record<string, number>;
  waitByCategory: Record<string, number>;
  alerts: Alert[];
  recommendations: Recommendation[];
  settings: { redirect_to: string | null; redirect_message: string | null } | null;
}

export function useBranchState(branchId: string, pollMs = 4000) {
  const [data, setData] = useState<BranchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setData(await api<BranchState>(`/api/state/${branchId}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
    }
  }, [branchId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime(["tokens", "counters", "alerts", "recommendations", "sim_state", "branch_settings"], refresh, `branch_id=eq.${branchId}`, pollMs);
  return { data, error, refresh, loading: !data && !error };
}

/** Ticking sim clock derived from sim_state (updates every second, fast-forwards with the simulator). */
export function useSimNow(sim: SimState | null | undefined): Date {
  const [now, setNow] = useState(() => effectiveNow(sim ?? null));
  useEffect(() => {
    setNow(effectiveNow(sim ?? null));
    const t = setInterval(() => setNow(effectiveNow(sim ?? null)), 1000);
    return () => clearInterval(t);
  }, [sim]);
  return now;
}

export function minutesSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / 60000);
}
