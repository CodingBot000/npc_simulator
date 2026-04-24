import fs from "node:fs";
import path from "node:path";
import type { LlmProviderMode, RuntimeArtifactKind } from "@backend-shared/types";

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
export const DEFAULT_LOCAL_REPLY_LLAMA_RUNTIME_PATH = path.join(
  PROJECT_ROOT,
  "outputs",
  "training",
  "manual_llama31_local_check_20260421_025259",
  "runtime",
);

let localEnvValues: Map<string, string> | null = null;

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEnvValue(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readLocalEnvValues() {
  if (localEnvValues) {
    return localEnvValues;
  }

  const values = new Map<string, string>();
  const envPath = path.join(PROJECT_ROOT, ".env.local");

  if (!fs.existsSync(envPath)) {
    localEnvValues = values;
    return values;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    if (key) {
      values.set(key, value);
    }
  }

  localEnvValues = values;
  return values;
}

export function getServerEnv(key: string) {
  const directValue = trimToNull(process.env[key]);
  if (directValue) {
    return directValue;
  }

  const fallback = trimToNull(readLocalEnvValues().get(key));
  if (fallback) {
    process.env[key] = fallback;
  }
  return fallback;
}

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

function resolveProjectPath(rawPath: string | null | undefined) {
  const trimmed = trimToNull(rawPath);
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

const providerMode =
  getServerEnv("LLM_PROVIDER_MODE") === "openai"
    ? "openai"
    : getServerEnv("LLM_PROVIDER_MODE") === "deterministic"
      ? "deterministic"
      : "codex";
const localReplyAdapterMode = parseLocalReplyAdapterMode();
const localReplyModelFamily = parseLocalReplyModelFamily();
const localReplyUsePromoted = parseBooleanEnv(
  "LOCAL_REPLY_USE_PROMOTED",
  localReplyModelFamily === "qwen",
);

export const appConfig = {
  providerMode: providerMode as LlmProviderMode,
  localReplyAdapterMode: localReplyAdapterMode as LocalReplyAdapterMode,
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
    family: localReplyModelFamily as LocalReplyModelFamily,
    usePromoted: localReplyUsePromoted,
    mlxModel: getServerEnv("LOCAL_REPLY_MLX_MODEL") || DEFAULT_LOCAL_REPLY_MLX_MODEL,
    maxTokens: Number(getServerEnv("LOCAL_REPLY_MAX_TOKENS") || "160"),
    llamaRuntimePath:
      resolveProjectPath(getServerEnv("LOCAL_REPLY_LLAMA_RUNTIME_PATH")) ||
      DEFAULT_LOCAL_REPLY_LLAMA_RUNTIME_PATH,
    llamaPromptFormat: parseLocalReplyPromptFormat(
      "LOCAL_REPLY_LLAMA_PROMPT_FORMAT",
      "scene_state_min",
    ) as LocalReplyPromptFormat,
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
