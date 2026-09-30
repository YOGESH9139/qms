import { PagePlaceholder } from "@/components/page-placeholder";

export default function CustomerPage() {
  return (
    <PagePlaceholder
      title="Customer app"
      subtitle="Conversational AI intake → your plan → book"
      buildStep="Build step 4"
      items={[
        "Name, mobile (mock OTP 1234), language (English / Hindi)",
        "“What do you need help with today?” with 6 chips + free text; AI classification with rule fallback",
        "Your plan: summary, do-it-online card, document checklist, best time to visit",
        "Smart appointment booking with GREEN / AMBER / RED slot grid, or a walk-in token",
      ]}
    />
  );
}
