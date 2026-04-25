import { getServerEnv } from "@server/config";

const DEFAULT_RUNPOD_REST_API_BASE_URL = "https://rest.runpod.io/v1";
const DEFAULT_RUNPOD_SERVERLESS_API_BASE_URL = "https://api.runpod.ai/v2";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export const runpodServiceConfig = {
  apiKey: trimToNull(getServerEnv("RUNPOD_API_KEY")),
  restApiBaseUrl:
    trimToNull(getServerEnv("RUNPOD_REST_API_BASE_URL")) ??
    DEFAULT_RUNPOD_REST_API_BASE_URL,
  serverlessApiBaseUrl:
    trimToNull(getServerEnv("RUNPOD_SERVERLESS_API_BASE_URL")) ??
    DEFAULT_RUNPOD_SERVERLESS_API_BASE_URL,
} as const;
