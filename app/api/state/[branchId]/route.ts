import { handle } from "@/lib/server/api";
import { Workspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Everything a live screen needs for one branch: tokens (today + live), counters, staff, waits, alerts, recs, sim. */
export async function GET(_req: Request, { params }: { params: { branchId: string } }) {
  return handle(async () => {
    const ws = await Workspace.load(params.branchId);
    ws.recomputeEtas(); // in-memory only; keeps ETAs fresh between events
    const [alerts, recs, settings] = await Promise.all([
      ws.db.from("alerts").select("*").eq("branch_id", params.branchId).eq("status", "OPEN").order("at", { ascending: false }).limit(20),
      ws.db.from("recommendations").select("*").eq("branch_id", params.branchId).order("at", { ascending: false }).limit(30),
      ws.db.from("branch_settings").select("*").eq("branch_id", params.branchId).maybeSingle(),
    ]);
    return {
      now: ws.now.toISOString(),
      sim: ws.sim,
      tokens: ws.tokens.map(({ mobile_hash: _h, ...t }) => t),
      counters: ws.counters,
      staff: ws.staff.map(({ pin: _pin, ...s }) => s),
      avgHandle: ws.ctx.avgHandle,
      waitByCategory: ws.waitByCategory(),
      alerts: alerts.data ?? [],
      recommendations: recs.data ?? [],
      settings: settings.data ?? null,
    };
  });
}
