import { istParts } from "@/lib/clock";
import { compareDay } from "@/lib/engine/compare";
import { handle } from "@/lib/server/api";
import { getSim } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const sim = await getSim();
    const branchId = url.searchParams.get("branch") ?? sim.branch_id ?? "BR01";
    const date = istParts(new Date(sim.sim_now)).date;
    return compareDay(branchId, date, url.searchParams.get("salary") === "1");
  });
}
