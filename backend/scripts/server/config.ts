import path from "node:path";
import type {
  LlmProviderMode,
  RuntimeArtifactKind,
} from "@backend-contracts/api";
import {
  DATA_DIR,
  PROJECT_ROOT,
  serverRuntimeContext,
} from "@server/config/runtime-context";
import {
  getServerEnv,
  getProcessEnv,
  hasServerEnv,
} from "@server/config/env-loader";

export const DEFAULT_LOCAL_CANONICAL_TRAINING_BASE_MODEL =
  "unsloth/Meta-Llama-3.1-8B-Instruct";
export const DEFAULT_LOCAL_REPLY_MLX_MODEL =
  "mlx-community/Llama-3.1-8B-Instruct-4bit";
export const DEFAULT_REMOTE_TRAINING_BASE_MODEL =
  "meta-llama/Meta-Llama-3.1-8B-Instruct-Reference";
export const DEFAULT_SHADOW_COMPARE_LABEL = "Local Llama Shadow";

type LocalReplyAdapterMode = "off" | "on" | "auto";
type LocalReplyModelFamily = "llama" | "qwen";
type LocalReplyPromptFormat =
  | "raw_json"
  | "situation_card"
  | "direct_scene"
  | "scene_state_min";

export const DEFAULT_LOCAL_REPLY_LLAMA_RUNTIME_PATH = path.join(
  PROJECT_ROOT,
  "outputs",
  "training",
  "manual_llama31_local_check_20260421_025259",
  "runtime",
);

function parseBooleanEnv(key: string, defaultValue: boolean) {
  const rawValue = getServerEnv(key);
  if (!rawValue) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  return defaultValue;
}

export {
  DATA_DIR,
  PROJECT_ROOT,
  getProcessEnv,
  getServerEnv,
  hasServerEnv,
  serverRuntimeContext,
};

function resolveProjectPath(rawPath: string | null | undefined) {
  const trimmed =
    typeof rawPath === "string" && rawPath.trim().length > 0
      ? rawPath.trim()
      : null;
  if (!trimmed) {
    return null;
  }
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.join(PROJECT_ROOT, trimmed);
}

function parseLocalReplyAdapterMode(): LocalReplyAdapterMode {
  const rawValue = getServerEnv("LOCAL_REPLY_ADAPTER_MODE");
  if (rawValue === "on" || rawValue === "auto" || rawValue === "off") {
    return rawValue;
  }
  return "off";
}

function parseLocalReplyModelFamily(): LocalReplyModelFamily {
  return getServerEnv("LOCAL_REPLY_MODEL_FAMILY") === "qwen"
    ? "qwen"
    : "llama";
}

function parseLocalReplyPromptFormat(
  key: string,
  defaultValue: LocalReplyPromptFormat,
): LocalReplyPromptFormat {
  const rawValue = getServerEnv(key);
  if (
    rawValue === "raw_json" ||
    rawValue === "situation_card" ||
    rawValue === "direct_scene" ||
    rawValue === "scene_state_min"
  ) {
    return rawValue;
  }
  return defaultValue;
}

function parseRuntimeArtifactKind(
  key: string,
  defaultValue: RuntimeArtifactKind,
): RuntimeArtifactKind {
  const rawValue = getServerEnv(key);
  if (
    rawValue === "mlx_adapter" ||
    rawValue === "mlx_fused_model" ||
    rawValue === "legacy_mlx_adapter"
  ) {
    return rawValue;
  }
  return defaultValue;
}

function parseProviderMode(): LlmProviderMode {
  const rawValue = getServerEnv("LLM_PROVIDER_MODE");
  if (rawValue === "openai" || rawValue === "deterministic") {
    return rawValue;
  }
  return "codex";
}

const providerMode = parseProviderMode();
const localReplyAdapterMode = parseLocalReplyAdapterMode();
const localReplyModelFamily = parseLocalReplyModelFamily();
const localReplyUsePromoted = parseBooleanEnv(
  "LOCAL_REPLY_USE_PROMOTED",
  localReplyModelFamily === "qwen",
);

export const appConfig = {
  runtime: serverRuntimeContext,
  providerMode,
  localReplyAdapterMode,
  models: {
    interactionModel:
      getServerEnv("INTERACTION_MODEL") ||
      getServerEnv("PREMIUM_MODEL") ||
      getServerEnv("OPENAI_MODEL") ||
      "gpt-4.1-nano",
    interactionFallbackModel:
      getServerEnv("INTERACTION_FALLBACK_MODEL") ||
      getServerEnv("PREMIUM_FALLBACK_MODEL") ||
      getServerEnv("LOW_COST_FALLBACK_MODEL") ||
      "gpt-4.1-mini",
    openaiModel: getServerEnv("OPENAI_MODEL") || "gpt-5.4",
    lowCostModel: getServerEnv("LOW_COST_MODEL") || "gpt-5.4-mini",
    premiumModel:
      getServerEnv("PREMIUM_MODEL") || getServerEnv("OPENAI_MODEL") || "gpt-5.4",
    lowCostFallbackModel:
      getServerEnv("LOW_COST_FALLBACK_MODEL") || "gpt-5.4-mini",
    premiumFallbackModel:
      getServerEnv("PREMIUM_FALLBACK_MODEL") || "gpt-5.4-mini",
  },
  localReply: {
    family: localReplyModelFamily,
    usePromoted: localReplyUsePromoted,
    mlxModel: getServerEnv("LOCAL_REPLY_MLX_MODEL") || DEFAULT_LOCAL_REPLY_MLX_MODEL,
    maxTokens: Number(getServerEnv("LOCAL_REPLY_MAX_TOKENS") || "160"),
    llamaRuntimePath:
      resolveProjectPath(getServerEnv("LOCAL_REPLY_LLAMA_RUNTIME_PATH")) ||
      DEFAULT_LOCAL_REPLY_LLAMA_RUNTIME_PATH,
    llamaPromptFormat: parseLocalReplyPromptFormat(
      "LOCAL_REPLY_LLAMA_PROMPT_FORMAT",
      "scene_state_min",
    ),
  },
  shadowCompare: {
    enabled: parseBooleanEnv("SHADOW_COMPARE_ENABLED", false),
    label: getServerEnv("SHADOW_COMPARE_LABEL") || DEFAULT_SHADOW_COMPARE_LABEL,
    artifactPath:
      resolveProjectPath(getServerEnv("SHADOW_COMPARE_RUNTIME_ARTIFACT_PATH")) ||
      DEFAULT_LOCAL_REPLY_LLAMA_RUNTIME_PATH,
    artifactKind: parseRuntimeArtifactKind(
      "SHADOW_COMPARE_RUNTIME_ARTIFACT_KIND",
      "mlx_fused_model",
    ),
    mlxModel: getServerEnv("SHADOW_COMPARE_MLX_MODEL") || DEFAULT_LOCAL_REPLY_MLX_MODEL,
    maxTokens: Number(getServerEnv("SHADOW_COMPARE_MAX_TOKENS") || "360"),
  },
  npcAutonomy: {
    debugSeed: getServerEnv("NPC_AUTONOMY_DEBUG_SEED"),
  },
};
