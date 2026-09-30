import { notFound } from "next/navigation";

import { PagePlaceholder } from "@/components/page-placeholder";
import { COUNTERS, STAFF } from "@/lib/data/branches";

export default function StaffConsolePage({ params }: { params: { counterId: string } }) {
  const counter = COUNTERS.find((c) => c.id === params.counterId);
  if (!counter) notFound();
  const staff = STAFF.find((s) => s.id === counter.staff_id);
  return (
    <PagePlaceholder
      title={`Counter ${counter.number}`}
      subtitle={staff ? `${staff.name} · ${staff.skills.join(", ")}` : "Unassigned counter"}
      buildStep="Build step 3"
      items={[
        "Status: online / offline / break / change focus",
        "Call next with “Why this customer”, recall, start, skip, complete with outcome",
        "Transfer, park, add another service, book follow-up, escalate",
        "Customer panel with AI summary and live handle timer; my queue side panel",
      ]}
    />
  );
}
