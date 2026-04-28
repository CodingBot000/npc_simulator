import { getServerEnv } from "@server/config";

const apiKey = getServerEnv("OPENAI_API_KEY");

export const openAiConfig = {
  apiKey,
  configured: apiKey !== null,
} as const;
