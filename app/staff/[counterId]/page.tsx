import { notFound } from "next/navigation";

import { COUNTERS } from "@/lib/data/branches";

import { StaffConsole } from "./console";

export default function StaffConsolePage({ params }: { params: { counterId: string } }) {
  const counter = COUNTERS.find((c) => c.id === params.counterId);
  if (!counter) notFound();
  return <StaffConsole counterId={counter.id} branchId={counter.branch_id} />;
}
