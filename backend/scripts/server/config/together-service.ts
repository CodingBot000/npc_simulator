import { getServerEnv } from "@server/config";

const DEFAULT_TOGETHER_API_BASE_URL = "https://api.together.xyz/v1";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export const togetherServiceConfig = {
  apiKey: trimToNull(getServerEnv("TOGETHER_API_KEY")),
  apiBaseUrl:
    trimToNull(getServerEnv("TOGETHER_API_BASE_URL")) ??
    DEFAULT_TOGETHER_API_BASE_URL,
} as const;
