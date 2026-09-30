import { notFound } from "next/navigation";

import { getBranch } from "@/lib/data/branches";

import { CommandCenter } from "./command-center";

export default function ManagerPage({ params }: { params: { branchId: string } }) {
  const branch = getBranch(params.branchId);
  if (!branch) notFound();
  return <CommandCenter branch={branch} />;
}
