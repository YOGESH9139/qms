import { notFound } from "next/navigation";

import { PagePlaceholder } from "@/components/page-placeholder";
import { getBranch } from "@/lib/data/branches";

export default function KioskPage({ params }: { params: { branchId: string } }) {
  const branch = getBranch(params.branchId);
  if (!branch) notFound();
  return (
    <PagePlaceholder
      title="Kiosk / greeter"
      subtitle={branch.name}
      buildStep="Build step 3"
      items={[
        "Big service tiles grouped by category, English / Hindi toggle",
        "Optional mobile number, priority checkbox (senior / differently abled / pregnant)",
        "Token screen with code, ETA, “SMS sent”, printable slip",
        "Greeter mode for staff-assisted walk-ins; nobody is turned away",
      ]}
    />
  );
}
