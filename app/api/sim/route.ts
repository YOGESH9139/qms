import { body, handle } from "@/lib/server/api";
import { resetDay, runScenario, setSpeed } from "@/lib/server/sim";
import { getSim } from "@/lib/server/workspace";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ({ sim: await getSim() }));
}

type SimAction =
  | { action: "speed"; speed: number }
  | { action: "branch"; branchId: string }
  | { action: "reset"; branchId: string }
  | { action: "scenario"; name: "salary_rush" | "unplanned_break" | "outage" | "senior_group" }
  | { action: "human"; counterId: string; on: boolean };

export async function POST(req: Request) {
  return handle(async () => {
    const a = await body<SimAction>(req);
    const db = getSupabaseAdmin();
    switch (a.action) {
      case "speed":
        await setSpeed(a.speed);
        return { ok: true };
      case "branch":
        return resetDay(a.branchId);
      case "reset":
        return resetDay(a.branchId);
      case "scenario":
        return runScenario(a.name);
      case "human":
        await db.from("counters").update({ human_control: a.on }).eq("id", a.counterId);
        return { ok: true };
    }
  });
}
