import { handle } from "@/lib/server/api";
import { networkStatus, storeLending } from "@/lib/server/intel";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const net = await networkStatus();
    const lending = await storeLending(net.lending);
    return { branches: net.branches, lending, now: net.now };
  });
}
