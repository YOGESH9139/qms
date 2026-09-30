import { notFound } from "next/navigation";

import { getBranch } from "@/lib/data/branches";

import { Board } from "./board";

export default function DisplayPage({ params }: { params: { branchId: string } }) {
  const branch = getBranch(params.branchId);
  if (!branch) notFound();
  return <Board branch={branch} />;
}
