import { notFound } from "next/navigation";

import { PagePlaceholder } from "@/components/page-placeholder";
import { getBranch } from "@/lib/data/branches";

export default function ManagerPage({ params }: { params: { branchId: string } }) {
  const branch = getBranch(params.branchId);
  if (!branch) notFound();
  return (
    <PagePlaceholder
      title="Manager command center"
      subtitle={branch.name}
      buildStep="Build step 5"
      items={[
        "Live: counter grid, queue vs target per category, KPI strip, open alerts",
        "Forecast: hourly expected vs actual, Erlang C counters needed vs rostered, Explain popovers, MAPE",
        "Recommendations with predicted impact and Accept / Dismiss (Accept executes)",
        "Insights: CSAT trend, feedback topics, deflection opportunities, misrouting, handle times",
      ]}
    />
  );
}
