function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type ParsedRemoteProviderRef =
  | {
      kind: "together";
      raw: string;
    }
  | {
      kind: "runpod";
      raw: string;
      endpointId: string;
    }
  | {
      kind: "unknown";
      raw: string;
    };

export function buildRunpodRemoteProvider(endpointId: string) {
  const trimmed = trimToNull(endpointId);
  if (!trimmed) {
    throw new Error("Runpod endpointId is required.");
  }
  return `runpod:${trimmed}`;
}

export function parseRemoteProviderRef(rawValue: string | null | undefined): ParsedRemoteProviderRef | null {
  const raw = trimToNull(rawValue);
  if (!raw) {
    return null;
  }
  if (raw === "together") {
    return {
      kind: "together",
      raw,
    };
  }
  if (raw.startsWith("runpod:")) {
    const endpointId = trimToNull(raw.slice("runpod:".length));
    if (endpointId) {
      return {
        kind: "runpod",
        raw,
        endpointId,
      };
    }
  }
  return {
    kind: "unknown",
    raw,
  };
}

export function isTogetherRemoteProvider(rawValue: string | null | undefined) {
  return parseRemoteProviderRef(rawValue)?.kind === "together";
}

export function isRunpodRemoteProvider(rawValue: string | null | undefined) {
  return parseRemoteProviderRef(rawValue)?.kind === "runpod";
}
