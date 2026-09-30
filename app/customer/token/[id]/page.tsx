import { Tracker } from "./tracker";

export default function TokenTrackerPage({ params }: { params: { id: string } }) {
  return <Tracker id={params.id} />;
}
