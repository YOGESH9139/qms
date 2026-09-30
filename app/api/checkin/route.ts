import { checkInBooking } from "@/lib/server/actions";
import { body, handle } from "@/lib/server/api";
import { Workspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const { branchId, mobile, code } = await body<{ branchId: string; mobile?: string; code?: string }>(req);
    const ws = await Workspace.load(branchId);
    const t = checkInBooking(ws, { mobile, code });
    ws.recomputeEtas();
    const fresh = ws.token(t.id);
    ws.sms(fresh, `Checked in: token ${fresh.code}. ${fresh.appointment_start ? "Your appointment is honoured" : "Converted to walk-in (arrived late)"}. Watch the screen for your counter.`);
    await ws.flush();
    const { mobile_hash: _h, ...safe } = fresh as typeof fresh & { mobile_hash?: string };
    return { token: safe };
  });
}
