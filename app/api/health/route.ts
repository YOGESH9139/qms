import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/health — confirms the app can reach Supabase and the seed ran. */
export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const [branches, services, visits] = await Promise.all([
      db.from("branches").select("id", { count: "exact", head: true }),
      db.from("services").select("id", { count: "exact", head: true }),
      db.from("visit_history").select("id", { count: "exact", head: true }),
    ]);
    const error = branches.error ?? services.error ?? visits.error;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      counts: { branches: branches.count, services: services.count, visit_history: visits.count },
      llm: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
