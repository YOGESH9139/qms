import { PagePlaceholder } from "@/components/page-placeholder";

export default function NetworkPage() {
  return (
    <PagePlaceholder
      title="Network view"
      subtitle="All branches"
      buildStep="Build step 7"
      items={[
        "Table + map: current wait, forecast peak, staff gap, CSAT per branch",
        "Redirect customers to nearby low-wait branches",
        "Staff lending between branches",
      ]}
    />
  );
}
