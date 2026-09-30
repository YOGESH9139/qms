import { fromIst } from "@/lib/clock";
import { issue, smsIssued } from "@/lib/server/actions";
import { body, handle } from "@/lib/server/api";
import { Workspace } from "@/lib/server/workspace";
import type { AiSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Book a smart appointment: the customer gets a fixed 30-min window at booking time. */
export async function POST(req: Request) {
  return handle(async () => {
    const a = await body<{ branchId: string; serviceId: string; date: string; startMin: number; name?: string; mobile?: string; aiSummary?: AiSummary }>(req);
    const ws = await Workspace.load(a.branchId);
    const t = issue(ws, {
      branchId: a.branchId,
      serviceId: a.serviceId,
      source: "APP_APPOINTMENT",
      name: a.name,
      mobile: a.mobile,
      aiSummary: a.aiSummary,
      appointmentStart: fromIst(a.date, a.startMin).toISOString(),
      appointmentEnd: fromIst(a.date, a.startMin + 30).toISOString(),
    });
    smsIssued(ws, t);
    await ws.flush({ etas: false });
    const { mobile_hash: _h, ...safe } = t as typeof t & { mobile_hash?: string };
    return { token: safe };
  });
}
