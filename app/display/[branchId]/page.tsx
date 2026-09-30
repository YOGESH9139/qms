import { notFound } from "next/navigation";

import { PagePlaceholder } from "@/components/page-placeholder";
import { getBranch } from "@/lib/data/branches";

export default function DisplayPage({ params }: { params: { branchId: string } }) {
  const branch = getBranch(params.branchId);
  if (!branch) notFound();
  return (
    <PagePlaceholder
      title="Display board"
      subtitle={branch.name}
      buildStep="Build step 3"
      items={[
        "Now serving: token → counter, newest highlighted, chime announced twice",
        "Next up: next 6 tokens (no counter shown)",
        "Estimated wait per category",
        "Rotating digital-deflection tip strip",
      ]}
    />
  );
}
