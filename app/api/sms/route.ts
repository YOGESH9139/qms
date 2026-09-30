import { handle } from "@/lib/server/api";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Mock SMS outbox for the on-screen phone. Filter by token or masked mobile; otherwise latest across the demo. */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    let q = getSupabaseAdmin().from("sms_outbox").select("*").order("id", { ascending: false }).limit(30);
    const token = url.searchParams.get("token");
    const mobile = url.searchParams.get("mobile");
    if (token) q = q.eq("token_id", token);
    else if (mobile) q = q.eq("mobile_masked", mobile);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { messages: data };
  });
}
