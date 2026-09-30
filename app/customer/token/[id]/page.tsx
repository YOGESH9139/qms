import { PagePlaceholder } from "@/components/page-placeholder";

export default function TokenTrackerPage({ params }: { params: { id: string } }) {
  return (
    <PagePlaceholder
      title="Token tracker"
      subtitle={`Token ${params.id}`}
      buildStep="Build step 4"
      items={[
        "Big token code, status pill, position in line, ETA range (~10–15 min), live updates",
        "Checklist, “I'm running late (10 min)”, Cancel",
        "Full-screen “Go to Counter N” when called",
        "Feedback (stars + comment) after completion",
      ]}
    />
  );
}
