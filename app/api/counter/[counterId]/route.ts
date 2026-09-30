import { COUNTERS } from "@/lib/data/branches";
import { counterAction, type CounterAction } from "@/lib/server/actions";
import { body, handle } from "@/lib/server/api";
import { Workspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { counterId: string } }) {
  return handle(async () => {
    const branchId = COUNTERS.find((c) => c.id === params.counterId)?.branch_id ?? params.counterId.split("-")[0];
    const ws = await Workspace.load(branchId);
    const result = await counterAction(ws, params.counterId, await body<CounterAction>(req));
    await ws.flush();
    return result;
  });
}
