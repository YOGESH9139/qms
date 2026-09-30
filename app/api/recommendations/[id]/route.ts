import { body, handle } from "@/lib/server/api";
import { decideRecommendation } from "@/lib/server/intel";

export const dynamic = "force-dynamic";

/** Accept = execute the action. Dismiss = close it. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { decision } = await body<{ decision: "ACCEPT" | "DISMISS" }>(req);
    return decideRecommendation(params.id, decision === "DISMISS" ? "DISMISS" : "ACCEPT");
  });
}
