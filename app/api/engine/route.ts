import { body, handle } from "@/lib/server/api";
import { engineTick } from "@/lib/server/intel";
import { Workspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const last = new Map<string, number>();

/** Engine tick for one branch: persist fresh ETAs, run alert rules, refresh recommendations. */
export async function POST(req: Request) {
  return handle(async () => {
    const { branchId } = await body<{ branchId: string }>(req);
    if (Date.now() - (last.get(branchId) ?? 0) < 4000) return { skipped: true };
    last.set(branchId, Date.now());
    const ws = await Workspace.load(branchId);
    const r = await engineTick(ws);
    await ws.flush({ etas: false });
    return r;
  });
}
