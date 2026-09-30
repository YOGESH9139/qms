"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("YOUR-PROJECT") && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Browser client (anon key) — used for reads and Realtime subscriptions. Null if env is missing. */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return browserClient;
}
