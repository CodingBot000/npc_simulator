import { getServerEnv } from "@server/config";

const DEFAULT_BASETEN_API_BASE_URL = "https://api.baseten.co";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export const basetenServiceConfig = {
  apiKey: trimToNull(getServerEnv("BASETEN_API_KEY")),
  apiBaseUrl:
    trimToNull(getServerEnv("BASETEN_API_BASE_URL")) ??
    DEFAULT_BASETEN_API_BASE_URL,
  modelId:
    trimToNull(getServerEnv("FINAL_REPLY_BASETEN_MODEL_ID")) ??
    trimToNull(getServerEnv("BASETEN_MODEL_ID")),
  modelUrl:
    trimToNull(getServerEnv("FINAL_REPLY_BASETEN_MODEL_URL")) ??
    trimToNull(getServerEnv("BASETEN_MODEL_URL")),
  hfSecretName:
    trimToNull(getServerEnv("BASETEN_HF_SECRET_NAME")) ?? "hf_access_token",
} as const;
