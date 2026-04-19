import {
  normalizeWorldInstanceId,
  WORLD_INSTANCE_HEADER,
} from "@server/store/instance-context";

export type HeaderBag =
  | Headers
  | Record<string, string | null | undefined>
  | null
  | undefined;

function getHeaderValue(headers: HeaderBag, name: string) {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  const lookup = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lookup) {
      return value ?? null;
    }
  }

  return null;
}

export function getWorldInstanceIdFromHeaders(headers?: HeaderBag) {
  return normalizeWorldInstanceId(getHeaderValue(headers, WORLD_INSTANCE_HEADER));
}
