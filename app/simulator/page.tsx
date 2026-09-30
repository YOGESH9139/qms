import { PagePlaceholder } from "@/components/page-placeholder";

export default function SimulatorPage() {
  return (
    <PagePlaceholder
      title="Live simulator"
      subtitle="Fast-forward a branch day"
      buildStep="Build step 6"
      items={[
        "Clock: pause, 1×, 10×, 30×, 60× (simulated day starts 10:00)",
        "Walk-ins from today's forecast; bot staff; hand any counter to a human",
        "Scenarios: salary-day rush, unplanned break, counter outage, senior group, reset day",
        "Before vs after: FIFO single queue vs BranchFlow routing + accepted recommendations",
      ]}
    />
  );
}
