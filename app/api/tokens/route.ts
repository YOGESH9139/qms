import { issue, smsIssued, type IssueArgs } from "@/lib/server/actions";
import { body, handle } from "@/lib/server/api";
import { Workspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Issue a token: kiosk / greeter walk-ins, app walk-ins, app appointments (BOOKED). */
export async function POST(req: Request) {
  return handle(async () => {
    const a = await body<IssueArgs>(req);
    const ws = await Workspace.load(a.branchId);
    const token = issue(ws, a);
    ws.recomputeEtas();
    const fresh = ws.token(token.id);
    smsIssued(ws, fresh);
    await ws.flush();
    const { mobile_hash: _h, ...safe } = fresh as typeof fresh & { mobile_hash?: string };
    return { token: safe, smsSent: Boolean(fresh.mobile_masked) };
  });
}
