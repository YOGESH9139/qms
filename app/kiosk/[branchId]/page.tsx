import { notFound } from "next/navigation";

import { getBranch } from "@/lib/data/branches";

import { Kiosk } from "./kiosk";

export default function KioskPage({ params, searchParams }: { params: { branchId: string }; searchParams: { mode?: string } }) {
  const branch = getBranch(params.branchId);
  if (!branch) notFound();
  return <Kiosk branch={branch} greeter={searchParams.mode === "greeter"} />;
}
