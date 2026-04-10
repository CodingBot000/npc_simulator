"use client";

import { useSyncExternalStore } from "react";
import { HubRuntime } from "@/components/hub/hub-runtime";

const emptySubscribe = () => () => {};

export function HubRoute() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  if (!mounted) {
    return null;
  }

  return <HubRuntime />;
}
