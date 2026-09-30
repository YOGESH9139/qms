import { istParts } from "@/lib/clock";
import { STAFF } from "@/lib/data/branches";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { addDays } from "@/lib/engine/calendar";
import { handle } from "@/lib/server/api";
import { getSim } from "@/lib/server/workspace";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { branchId: string } }) {
  return handle(async () => {
    const db = getSupabaseAdmin();
    const b = params.branchId;
    const sim = await getSim(db);
    const today = istParts(new Date(sim.sim_now)).date;
    const since = addDays(today, -45);
    const [csat, daily, topics, services, transfers, staff, comments, deflections] = await Promise.all([
      db.from("feedback_daily").select("date, csat, n").eq("branch_id", b).gte("date", since).order("date"),
      db.from("visit_daily").select("date, visits, avg_wait, sla_pct").eq("branch_id", b).gte("date", since).order("date"),
      db.from("feedback_topics").select("topic, sentiment, n").eq("branch_id", b),
      db.from("service_stats").select("service_id, visits, could_be_digital, avg_handle").eq("branch_id", b),
      db.from("visit_history").select("service_id, final_service_id").eq("branch_id", b).gt("transfer_count", 0).limit(5000),
      db.from("staff_stats").select("staff_id, served, avg_handle").eq("branch_id", b),
      db.from("feedback").select("rating, comment, sentiment, topics, at").eq("branch_id", b).not("comment", "is", null).order("at", { ascending: false }).limit(12),
      db.from("app_events").select("id", { count: "exact", head: true }).eq("type", "digital_deflection"),
    ]);

    const topicAgg = new Map<string, { topic: string; pos: number; neu: number; neg: number }>();
    for (const t of topics.data ?? []) {
      const row = topicAgg.get(t.topic) ?? { topic: t.topic, pos: 0, neu: 0, neg: 0 };
      row[t.sentiment as "pos" | "neu" | "neg"] += t.n;
      topicAgg.set(t.topic, row);
    }

    const transferCount = new Map<string, { from: string; to: Record<string, number>; n: number }>();
    for (const t of transfers.data ?? []) {
      const row = transferCount.get(t.service_id) ?? { from: t.service_id as string, to: {} as Record<string, number>, n: 0 };
      row.n++;
      row.to[t.final_service_id as string] = (row.to[t.final_service_id as string] ?? 0) + 1;
      transferCount.set(t.service_id, row);
    }

    const svc = services.data ?? [];
    const totalServed = svc.reduce((s, r) => s + r.visits, 0);
    const branchAvg = svc.reduce((s, r) => s + Number(r.avg_handle) * r.visits, 0) / Math.max(1, totalServed);

    return {
      csatTrend: (csat.data ?? []).map((r) => ({ date: r.date, csat: Number(r.csat), n: r.n })),
      waitTrend: (daily.data ?? []).map((r) => ({ date: r.date, avgWait: Number(r.avg_wait), sla: Number(r.sla_pct), visits: r.visits })),
      topics: [...topicAgg.values()].sort((a, b2) => b2.pos + b2.neu + b2.neg - (a.pos + a.neu + a.neg)),
      deflection: svc
        .filter((r) => r.could_be_digital > 0)
        .map((r) => ({ service_id: r.service_id, name: SERVICE_BY_ID[r.service_id].name, visits: r.visits, couldBeDigital: r.could_be_digital, pct: Math.round((100 * r.could_be_digital) / r.visits) }))
        .sort((a, b2) => b2.couldBeDigital - a.couldBeDigital)
        .slice(0, 8),
      misrouting: [...transferCount.values()]
        .sort((a, b2) => b2.n - a.n)
        .slice(0, 6)
        .map((r) => ({
          from: SERVICE_BY_ID[r.from].name,
          n: r.n,
          mostlyTo: SERVICE_BY_ID[Object.entries(r.to).sort((a, b2) => b2[1] - a[1])[0][0]].name,
        })),
      staff: (staff.data ?? [])
        .map((r) => ({ name: STAFF.find((s) => s.id === r.staff_id)?.name ?? r.staff_id, served: r.served, avgHandle: Number(r.avg_handle) }))
        .sort((a, b2) => a.avgHandle - b2.avgHandle),
      branchAvgHandle: Math.round(branchAvg * 10) / 10,
      comments: comments.data ?? [],
      digitalDeflectionsTracked: deflections.count ?? 0,
    };
  });
}
