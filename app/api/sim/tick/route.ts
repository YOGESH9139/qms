import { handle } from "@/lib/server/api";
import { simTick } from "@/lib/server/sim";

export const dynamic = "force-dynamic";

let busy = false;

/** Advance the simulation to the current sim time. Called ~1×/s by the simulator page. */
export async function POST() {
  return handle(async () => {
    if (busy) return { skipped: true };
    busy = true;
    try {
      return await simTick();
    } finally {
      busy = false;
    }
  });
}
