import path from "node:path";
import type { LlmProviderMode } from "@/lib/types";

const providerMode =
  process.env.LLM_PROVIDER_MODE === "openai" ? "openai" : "codex";
const localReplyAdapterMode =
  process.env.LOCAL_REPLY_ADAPTER_MODE === "off"
    ? "off"
    : process.env.LOCAL_REPLY_ADAPTER_MODE === "on"
      ? "on"
      : "off";

export const appConfig = {
  providerMode: providerMode as LlmProviderMode,
  localReplyAdapterMode: localReplyAdapterMode as "off" | "on" | "auto",
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
  localReply: {
    mlxModel:
      process.env.LOCAL_REPLY_MLX_MODEL ||
      "mlx-community/Qwen2.5-7B-Instruct-4bit",
    maxTokens: Number(process.env.LOCAL_REPLY_MAX_TOKENS || "160"),
  },
};

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
