import path from "node:path";
import type { LlmProviderMode } from "@/lib/types";

const providerMode =
  process.env.LLM_PROVIDER_MODE === "openai" ? "openai" : "codex";

export const appConfig = {
  providerMode: providerMode as LlmProviderMode,
  models: {
    openaiModel: process.env.OPENAI_MODEL || "gpt-5.4",
    lowCostModel: process.env.LOW_COST_MODEL || "gpt-5.4-mini",
    premiumModel:
      process.env.PREMIUM_MODEL || process.env.OPENAI_MODEL || "gpt-5.4",
    lowCostFallbackModel:
      process.env.LOW_COST_FALLBACK_MODEL || "gpt-5.4-mini",
    premiumFallbackModel:
      process.env.PREMIUM_FALLBACK_MODEL || "gpt-5.4-mini",
  },
};

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
