import { HubClient } from "@/components/hub/hub-client";
import { getWorldSnapshot } from "@/server/engine/world-state";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialWorld = await getWorldSnapshot();

  return <HubClient initialWorld={initialWorld} />;
}
