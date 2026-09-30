import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseUrl } from "./url";

/**
 * Server client (service role) — only for route handlers / server components.
 * All writes (queue actions, engine ticks, accepted recommendations) go through here.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    // Next 14 caches server-side fetch GETs by default; queue state must always be live.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
