import path from "node:path";
import type {
  LlmProviderMode,
  RuntimeArtifactKind,
} from "@backend-contracts/api";
import {
  canonicalModelCatalog,
  canonicalModelConfig,
} from "@server/config/canonical-models";
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
import { buildBasetenRemoteProvider } from "@server/remote-provider";

export const DEFAULT_LOCAL_CANONICAL_TRAINING_BASE_MODEL =
  canonicalModelCatalog.families[canonicalModelCatalog.defaultFamily]
    .localTrainingBaseModelId;
export const DEFAULT_LOCAL_REPLY_MLX_MODEL =
  canonicalModelCatalog.families[canonicalModelCatalog.defaultFamily]
    .localReplyMlxModelId;
export const DEFAULT_REMOTE_TRAINING_BASE_MODEL =
  canonicalModelCatalog.families[canonicalModelCatalog.defaultFamily]
    .remoteTrainingBaseModelId;
export const DEFAULT_SHADOW_COMPARE_LABEL = "Local Llama Shadow";

type FinalReplyMode = "off" | "on" | "auto";
type FinalReplyBackend =
  | "off"
  | "local_llama"
  | "local_qwen"
  | "promoted"
  | "codex"
  | "openai_api"
  | "together"
  | "baseten"
  | "runpod";
type LocalReplyModelFamily = "llama" | "qwen";
type LocalReplyPromptFormat =
  | "raw_json"
  | "situation_card"
  | "direct_scene"
  | "scene_state_min";
type InteractionJudgeMode = "off" | "on";
type InteractionJudgeEnforcement = "off" | "warn" | "retry" | "reject";
type RunpodEndpointMode = "queue_vllm" | "load_balancer_vllm";

const DEFAULT_FINAL_REPLY_TIMEOUT_MS = 180_000;
const DEFAULT_FINAL_REPLY_RUNPOD_REQUEST_TIMEOUT_MS = 90_000;

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

function parsePositiveNumberEnv(key: string, defaultValue: number) {
  const rawValue = getServerEnv(key);
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
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

function parseFinalReplyMode(): FinalReplyMode {
  const rawValue =
    getServerEnv("FINAL_REPLY_MODE") ??
    getServerEnv("LOCAL_REPLY_ADAPTER_MODE");
  if (rawValue === "on" || rawValue === "auto" || rawValue === "off") {
    return rawValue;
  }
  return "off";
}

function parseLocalReplyModelFamily(): LocalReplyModelFamily {
  return canonicalModelConfig.localReplyRuntimeFamily;
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

function parseInteractionJudgeMode(): InteractionJudgeMode {
  const rawValue = getServerEnv("INTERACTION_JUDGE_MODE");
  if (rawValue === "on" || rawValue === "off") {
    return rawValue;
  }
  return "off";
}

function parseInteractionJudgeEnforcement(): InteractionJudgeEnforcement {
  const rawValue = getServerEnv("INTERACTION_JUDGE_ENFORCEMENT");
  if (
    rawValue === "off" ||
    rawValue === "warn" ||
    rawValue === "retry" ||
    rawValue === "reject"
  ) {
    return rawValue;
  }
  return "off";
}

function parseProviderMode(): LlmProviderMode {
  const rawValue = getServerEnv("LLM_PROVIDER_MODE");
  if (rawValue === "codex") {
    if (serverRuntimeContext.isCloudMode) {
      throw new Error(
        "LLM_PROVIDER_MODE=codex is not allowed in cloud mode. Use openai or deterministic.",
      );
    }
    return rawValue;
  }
  if (rawValue === "openai" || rawValue === "deterministic") {
    return rawValue;
  }
  return serverRuntimeContext.isCloudMode ? "openai" : "codex";
}

function resolveRunpodRemoteProvider(endpointId: string | null) {
  return endpointId ? `runpod:${endpointId}` : null;
}

function parseRunpodEndpointMode(): RunpodEndpointMode {
  const rawValue =
    getServerEnv("FINAL_REPLY_RUNPOD_ENDPOINT_MODE") ||
    getServerEnv("RUNPOD_ENDPOINT_MODE");
  if (rawValue === "load_balancer_vllm" || rawValue === "queue_vllm") {
    return rawValue;
  }
  return "queue_vllm";
}

function resolveBasetenRemoteProvider(modelId: string | null) {
  return modelId ? buildBasetenRemoteProvider(modelId) : null;
}

function parseFinalReplyBackend(params: {
  mode: FinalReplyMode;
  localModelFamily: LocalReplyModelFamily;
  usePromoted: boolean;
}): FinalReplyBackend {
  const rawValue = getServerEnv("FINAL_REPLY_BACKEND");

  if (rawValue === "codex" && serverRuntimeContext.isCloudMode) {
    throw new Error(
      "FINAL_REPLY_BACKEND=codex is not allowed in cloud mode. Use openai_api, together, baseten, runpod, or off.",
    );
  }

  if (
    rawValue === "off" ||
    rawValue === "local_llama" ||
    rawValue === "local_qwen" ||
    rawValue === "promoted" ||
    rawValue === "codex" ||
    rawValue === "openai_api" ||
    rawValue === "together" ||
    rawValue === "baseten" ||
    rawValue === "runpod"
  ) {
    return rawValue;
  }

  if (params.mode === "off") {
    return "off";
  }

  if (params.usePromoted) {
    return "promoted";
  }

  return params.localModelFamily === "qwen" ? "local_qwen" : "local_llama";
}

const providerMode = parseProviderMode();
const finalReplyMode = parseFinalReplyMode();
const localReplyModelFamily = parseLocalReplyModelFamily();
const localReplyUsePromoted = parseBooleanEnv(
  "FINAL_REPLY_USE_PROMOTED",
  parseBooleanEnv(
    "LOCAL_REPLY_USE_PROMOTED",
    localReplyModelFamily === "qwen",
  ),
);
const finalReplyBackend = parseFinalReplyBackend({
  mode: finalReplyMode,
  localModelFamily: localReplyModelFamily,
  usePromoted: localReplyUsePromoted,
});
const finalReplyPromptFormat = parseLocalReplyPromptFormat(
  "FINAL_REPLY_PROMPT_FORMAT",
  parseLocalReplyPromptFormat(
    "LOCAL_REPLY_LLAMA_PROMPT_FORMAT",
    "scene_state_min",
  ),
);
const finalReplyRunpodEndpointId =
  getServerEnv("FINAL_REPLY_RUNPOD_ENDPOINT_ID") ||
  getServerEnv("RUNPOD_ENDPOINT_ID");
const finalReplyRunpodEndpointMode = parseRunpodEndpointMode();
const finalReplyBasetenModelId =
  getServerEnv("FINAL_REPLY_BASETEN_MODEL_ID") ||
  getServerEnv("BASETEN_MODEL_ID");
const finalReplyRemoteProvider =
  getServerEnv("FINAL_REPLY_REMOTE_PROVIDER") ||
  (finalReplyBackend === "runpod"
    ? resolveRunpodRemoteProvider(finalReplyRunpodEndpointId)
    : finalReplyBackend === "baseten"
      ? resolveBasetenRemoteProvider(finalReplyBasetenModelId)
    : finalReplyBackend === "together"
      ? "together"
      : null);

export const appConfig = {
  runtime: serverRuntimeContext,
  providerMode,
  localReplyAdapterMode: finalReplyMode,
  canonicalModel: {
    familyId: canonicalModelConfig.familyId,
    displayName: canonicalModelConfig.family.displayName,
    localTrainingBaseModelId: canonicalModelConfig.localTrainingBaseModelId,
    localReplyMlxModelId: canonicalModelConfig.localReplyMlxModelId,
    remoteTrainingBaseModelId: canonicalModelConfig.remoteTrainingBaseModelId,
  },
  models: {
    interactionModel:
      getServerEnv("INTERACTION_MODEL") ||
      getServerEnv("LOW_COST_MODEL") ||
      "gpt-4.1-mini",
    interactionFallbackModel:
      getServerEnv("INTERACTION_FALLBACK_MODEL") ||
      getServerEnv("LOW_COST_FALLBACK_MODEL") ||
      getServerEnv("LOW_COST_MODEL") ||
      "gpt-4.1-mini",
    openaiModel: getServerEnv("OPENAI_MODEL") || "gpt-5.4-mini",
    lowCostModel: getServerEnv("LOW_COST_MODEL") || "gpt-4.1-mini",
    premiumModel:
      getServerEnv("PREMIUM_MODEL") || getServerEnv("OPENAI_MODEL") || "gpt-5.4-mini",
    lowCostFallbackModel:
      getServerEnv("LOW_COST_FALLBACK_MODEL") || "gpt-4.1-mini",
    premiumFallbackModel:
      getServerEnv("PREMIUM_FALLBACK_MODEL") || "gpt-5.4-mini",
  },
  finalReply: {
    mode: finalReplyMode,
    backend: finalReplyBackend,
    promptFormat: finalReplyPromptFormat,
    maxTokens: Number(
      getServerEnv("FINAL_REPLY_MAX_TOKENS") ||
      getServerEnv("LOCAL_REPLY_MAX_TOKENS") ||
      "160",
    ),
    timeoutMs: parsePositiveNumberEnv(
      "FINAL_REPLY_TIMEOUT_MS",
      DEFAULT_FINAL_REPLY_TIMEOUT_MS,
    ),
    runpodRequestTimeoutMs: parsePositiveNumberEnv(
      "FINAL_REPLY_RUNPOD_REQUEST_TIMEOUT_MS",
      DEFAULT_FINAL_REPLY_RUNPOD_REQUEST_TIMEOUT_MS,
    ),
    models: {
      primary:
        getServerEnv("FINAL_REPLY_MODEL") ||
        getServerEnv("PREMIUM_MODEL") ||
        getServerEnv("OPENAI_MODEL") ||
        "gpt-5.4-mini",
      fallback:
        getServerEnv("FINAL_REPLY_FALLBACK_MODEL") ||
        getServerEnv("PREMIUM_FALLBACK_MODEL") ||
        getServerEnv("PREMIUM_MODEL") ||
        getServerEnv("OPENAI_MODEL") ||
        "gpt-5.4-mini",
    },
    remote: {
      provider: finalReplyRemoteProvider,
      modelName: getServerEnv("FINAL_REPLY_REMOTE_MODEL_NAME"),
      runpodEndpointId: finalReplyRunpodEndpointId,
      runpodEndpointMode: finalReplyRunpodEndpointMode,
      basetenModelId: finalReplyBasetenModelId,
      basetenModelUrl:
        getServerEnv("FINAL_REPLY_BASETEN_MODEL_URL") ||
        getServerEnv("BASETEN_MODEL_URL"),
    },
  },
  localReply: {
    family: localReplyModelFamily,
    usePromoted: localReplyUsePromoted,
    mlxModel: canonicalModelConfig.localReplyMlxModelId,
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
    mlxModel:
      getServerEnv("SHADOW_COMPARE_MLX_MODEL") ||
      canonicalModelConfig.localReplyMlxModelId,
    maxTokens: Number(getServerEnv("SHADOW_COMPARE_MAX_TOKENS") || "360"),
  },
  interactionJudge: {
    mode: parseInteractionJudgeMode(),
    model: getServerEnv("INTERACTION_JUDGE_MODEL") || "gpt-4.1-nano",
    timeoutMs: Number(getServerEnv("INTERACTION_JUDGE_TIMEOUT_MS") || "4000"),
    maxOutputTokens: Number(
      getServerEnv("INTERACTION_JUDGE_MAX_OUTPUT_TOKENS") || "96",
    ),
    enforcement: parseInteractionJudgeEnforcement(),
    confidenceThreshold: Number(
      getServerEnv("INTERACTION_JUDGE_CONFIDENCE_THRESHOLD") || "0.8",
    ),
  },
  npcAutonomy: {
    debugSeed: getServerEnv("NPC_AUTONOMY_DEBUG_SEED"),
  },
};
