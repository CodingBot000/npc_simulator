import fs from "node:fs";
import path from "node:path";
import type { LlmProviderMode } from "@/lib/types";

const providerMode =
  process.env.LLM_PROVIDER_MODE === "openai"
    ? "openai"
    : process.env.LLM_PROVIDER_MODE === "deterministic"
      ? "deterministic"
      : "codex";
const localReplyAdapterMode =
  process.env.LOCAL_REPLY_ADAPTER_MODE === "off"
    ? "off"
    : process.env.LOCAL_REPLY_ADAPTER_MODE === "on"
      ? "on"
      : process.env.LOCAL_REPLY_ADAPTER_MODE === "auto"
        ? "auto"
        : "off";

export const appConfig = {
  providerMode: providerMode as LlmProviderMode,
  localReplyAdapterMode: localReplyAdapterMode as "off" | "on" | "auto",
  models: {
    interactionModel:
      process.env.INTERACTION_MODEL ||
      process.env.PREMIUM_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4.1-nano",
    interactionFallbackModel:
      process.env.INTERACTION_FALLBACK_MODEL ||
      process.env.PREMIUM_FALLBACK_MODEL ||
      process.env.LOW_COST_FALLBACK_MODEL ||
      "gpt-4.1-mini",
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

function detectProjectRoot() {
  const explicitRoot = process.env.NPC_SIMULATOR_ROOT;

  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const cwd = process.cwd();
  const candidates = [cwd, path.dirname(cwd)];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "data")) &&
      fs.existsSync(path.join(candidate, "docs"))
    ) {
      return candidate;
    }
  }

  return cwd;
}

export const PROJECT_ROOT = detectProjectRoot();
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
