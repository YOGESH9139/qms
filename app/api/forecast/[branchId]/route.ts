import { handle } from "@/lib/server/api";
import { forecastReport } from "@/lib/server/intel";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { branchId: string } }) {
  return handle(() => forecastReport(params.branchId));
}
