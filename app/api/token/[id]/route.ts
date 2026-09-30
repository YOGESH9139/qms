import { customerCancel, customerLate } from "@/lib/server/actions";
import { body, handle } from "@/lib/server/api";
import { tagFeedback } from "@/lib/server/intake";
import { Workspace } from "@/lib/server/workspace";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Token } from "@/lib/types";

export const dynamic = "force-dynamic";

async function branchOf(id: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().from("tokens").select("branch_id").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Token not found");
  return data.branch_id;
}

/** Token tracker data: token (with fresh ETA), counter number, whether feedback was given. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const ws = await Workspace.load(await branchOf(params.id));
    ws.recomputeEtas();
    const t = ws.token(params.id) as Token & { mobile_hash?: string };
    const { mobile_hash: _h, ...token } = t;
    const counter = t.counter_id ? ws.counters.find((c) => c.id === t.counter_id) : null;
    const [{ count }, { data: events }] = await Promise.all([
      ws.db.from("feedback").select("id", { count: "exact", head: true }).eq("token_id", t.id),
      ws.db.from("token_events").select("type, note, at, meta, counter_id").eq("token_id", t.id).order("at"),
    ]);
    const ahead = ws.tokens.filter((x) => x.status === "WAITING" && x.position != null && t.position != null && x.position < t.position).length;
    return { token, counterNumber: counter?.number ?? null, feedbackGiven: (count ?? 0) > 0, ahead, now: ws.now.toISOString(), sim: ws.sim, events: events ?? [] };
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const a = await body<{ action: "late" | "cancel" | "feedback"; minutes?: number; rating?: number; comment?: string }>(req);
    const ws = await Workspace.load(await branchOf(params.id));
    if (a.action === "late") customerLate(ws, params.id, a.minutes ?? 10);
    else if (a.action === "cancel") customerCancel(ws, params.id);
    else if (a.action === "feedback") {
      const rating = Math.min(5, Math.max(1, Math.round(a.rating ?? 0)));
      const comment = a.comment?.trim() || null;
      const tags = await tagFeedback(rating, comment);
      const { error } = await ws.db.from("feedback").insert({
        token_id: params.id, branch_id: ws.branchId, rating, comment, sentiment: tags.sentiment, topics: tags.topics,
        at: ws.now.toISOString(),
      });
      if (error) throw new Error(error.message);
      return { ok: true, ...tags };
    }
    await ws.flush();
    return { ok: true };
  });
}
