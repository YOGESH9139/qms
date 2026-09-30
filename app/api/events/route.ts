import { body, handle } from "@/lib/server/api";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Product analytics events, e.g. digital_deflection clicks on "Do it online". */
export async function POST(req: Request) {
  return handle(async () => {
    const e = await body<{ type: string; branch_id?: string; service_id?: string; token_id?: string; meta?: unknown }>(req);
    const { error } = await getSupabaseAdmin().from("app_events").insert({
      type: e.type,
      branch_id: e.branch_id ?? null,
      service_id: e.service_id ?? null,
      token_id: e.token_id ?? null,
      meta: e.meta ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}
