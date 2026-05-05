import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, appConfig } from "@server/config";
import { databaseConfig } from "@server/config/database";
import { openAiConfig } from "@server/config/openai";
import { dbQuery } from "@server/db/postgres";
import { parseRemoteProviderRef } from "@server/remote-provider";
import type { RunpodEndpointMode } from "@server/runpod-client";
import type { ScenePromptFormat } from "@server/providers/mlx-reply-prompts";

export const LOCAL_MLX_BINARY = path.join(PROJECT_ROOT, ".venv", "bin", "mlx_lm.generate");

export type RuntimeArtifactKind = "mlx_adapter" | "mlx_fused_model" | "legacy_mlx_adapter";
export type LocalReplyBackendConfig = {
  backend: "local";
  path: string;
  promptFormat: ScenePromptFormat;
  runtimeKind: RuntimeArtifactKind;
  mlxModel?: string;
};

export type TogetherAdapterConfig = {
  backend: "together";
  model: string;
  provider: string | null;
  promptFormat: ScenePromptFormat;
};

export type RunpodAdapterConfig = {
  backend: "runpod";
  endpointId: string;
  endpointMode: RunpodEndpointMode;
  model: string;
  provider: string | null;
  promptFormat: ScenePromptFormat;
};

export type BasetenAdapterConfig = {
  backend: "baseten";
  modelId: string;
  modelUrl: string | null;
  model: string;
  provider: string | null;
  promptFormat: ScenePromptFormat;
};

export type CodexReplyConfig = {
  backend: "codex";
  promptFormat: ScenePromptFormat;
  models: string[];
};

export type OpenAiReplyConfig = {
  backend: "openai_api";
  promptFormat: ScenePromptFormat;
  models: string[];
};

export type ResolvedAdapterConfig =
  | LocalReplyBackendConfig
  | TogetherAdapterConfig
  | RunpodAdapterConfig
  | BasetenAdapterConfig
  | CodexReplyConfig
  | OpenAiReplyConfig;

const LEGACY_QWEN_REPLY_MLX_MODEL =
  "mlx-community/Qwen2.5-7B-Instruct-4bit";

const LEGACY_QWEN_ADAPTER_CONFIGS: Record<string, LocalReplyBackendConfig> = {
  doctor: {
    backend: "local",
    path: path.join(PROJECT_ROOT, "outputs", "qwen25-7b-doctor-role-v2"),
    promptFormat: "raw_json",
    runtimeKind: "legacy_mlx_adapter",
    mlxModel: LEGACY_QWEN_REPLY_MLX_MODEL,
  },
  supervisor: {
    backend: "local",
    path: path.join(PROJECT_ROOT, "outputs", "qwen25-7b-supervisor-role-v3"),
    promptFormat: "raw_json",
    runtimeKind: "legacy_mlx_adapter",
    mlxModel: LEGACY_QWEN_REPLY_MLX_MODEL,
  },
  default: {
    backend: "local",
    path: path.join(PROJECT_ROOT, "outputs", "qwen25-7b-aug26-v3"),
    promptFormat: "raw_json",
    runtimeKind: "legacy_mlx_adapter",
    mlxModel: LEGACY_QWEN_REPLY_MLX_MODEL,
  },
};

const LLAMA_ADAPTER_CONFIGS: Record<string, LocalReplyBackendConfig> = {
  doctor: {
    backend: "local",
    path: appConfig.localReply.llamaRuntimePath,
    promptFormat: appConfig.localReply.llamaPromptFormat,
    runtimeKind: "mlx_fused_model",
  },
  supervisor: {
    backend: "local",
    path: appConfig.localReply.llamaRuntimePath,
    promptFormat: appConfig.localReply.llamaPromptFormat,
    runtimeKind: "mlx_fused_model",
  },
  default: {
    backend: "local",
    path: appConfig.localReply.llamaRuntimePath,
    promptFormat: appConfig.localReply.llamaPromptFormat,
    runtimeKind: "mlx_fused_model",
  },
};

const ADAPTER_CONFIG_PRESETS = {
  llama: LLAMA_ADAPTER_CONFIGS,
  qwen: LEGACY_QWEN_ADAPTER_CONFIGS,
} as const;

let binaryCheckPromise: Promise<boolean> | null = null;
const adapterAvailability = new Map<string, Promise<boolean>>();

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getLocalPresetConfigForNpc(
  npcId: string,
  family: "llama" | "qwen" = appConfig.localReply.family,
) {
  const preset =
    ADAPTER_CONFIG_PRESETS[family] ??
    ADAPTER_CONFIG_PRESETS.llama;
  return preset[npcId] ?? preset.default;
}

function supportsPromotedAdapterLookup() {
  return /postgres(?:ql)?:/u.test(databaseConfig.datasourceUrl);
}

async function getPromotedAdapterConfigForNpc(npcId: string) {
  if (
    !(appConfig.finalReply.backend === "promoted" || appConfig.localReply.usePromoted) ||
    !supportsPromotedAdapterLookup()
  ) {
    return null;
  }

  const bindingKeys =
    npcId === "default" ? ["default"] : [npcId, "default"];

  try {
    const result = await dbQuery<{
      training_backend: string | null;
      output_adapter_path: string | null;
      runtime_artifact_path: string | null;
      runtime_artifact_kind: string | null;
      remote_provider: string | null;
      remote_model_name: string | null;
      promoted_binding_key: string | null;
    }>(
      `SELECT training_backend,
              output_adapter_path,
              runtime_artifact_path,
              runtime_artifact_kind,
              remote_provider,
              remote_model_name,
              promoted_binding_key
         FROM npc_training_run
        WHERE state = 'succeeded'
          AND promoted_at IS NOT NULL
          AND (COALESCE(runtime_artifact_path, output_adapter_path) IS NOT NULL OR remote_model_name IS NOT NULL)
          AND promoted_binding_key = ANY($1::text[])
        ORDER BY CASE WHEN promoted_binding_key = $2 THEN 0 ELSE 1 END,
                 promoted_at DESC,
                 id DESC
        LIMIT 1`,
      [bindingKeys, npcId],
    );
    const row = result.rows[0];
    const promptBinding = row.promoted_binding_key ?? npcId;
    const baseConfig = getLocalPresetConfigForNpc(promptBinding);
    const remoteProviderRef = parseRemoteProviderRef(row?.remote_provider);

    if (row?.remote_model_name && remoteProviderRef?.kind === "runpod") {
      return {
        backend: "runpod",
        endpointId: remoteProviderRef.endpointId,
        endpointMode: appConfig.finalReply.remote.runpodEndpointMode,
        model: row.remote_model_name,
        provider: row.remote_provider,
        promptFormat: baseConfig.promptFormat,
      } as const;
    }

    if (row?.remote_model_name && remoteProviderRef?.kind === "baseten") {
      return {
        backend: "baseten",
        modelId: remoteProviderRef.modelId,
        modelUrl: null,
        model: row.remote_model_name,
        provider: row.remote_provider,
        promptFormat: baseConfig.promptFormat,
      } as const;
    }

    if (
      row?.remote_model_name &&
      (remoteProviderRef?.kind === "together" ||
        row?.training_backend === "together_serverless_lora")
    ) {
      return {
        backend: "together",
        model: row.remote_model_name,
        provider: row.remote_provider,
        promptFormat: baseConfig.promptFormat,
      } as const;
    }

    const runtimePath = row?.runtime_artifact_path ?? row?.output_adapter_path ?? null;
    if (!runtimePath) {
      return null;
    }

    const runtimeKind = await resolveRuntimeArtifactKind(runtimePath, row.runtime_artifact_kind);
    return {
      backend: "local",
      path: runtimePath,
      promptFormat: baseConfig.promptFormat,
      runtimeKind,
      mlxModel: baseConfig.mlxModel,
    } as const;
  } catch {
    return null;
  }
}

function getFinalReplyModelCandidates() {
  return Array.from(
    new Set(
      [
        appConfig.finalReply.models.primary,
        appConfig.finalReply.models.fallback,
      ].filter(Boolean),
    ),
  );
}

export function buildOpenAiFallbackReplyConfig(): OpenAiReplyConfig | null {
  if (!openAiConfig.apiKey) {
    return null;
  }

  return {
    backend: "openai_api",
    promptFormat: appConfig.finalReply.promptFormat,
    models: getFinalReplyModelCandidates(),
  };
}

export async function resolveAdapterConfigForNpc(npcId: string): Promise<ResolvedAdapterConfig | null> {
  switch (appConfig.finalReply.backend) {
    case "off":
      return null;
    case "local_llama":
      return getLocalPresetConfigForNpc(npcId, "llama");
    case "local_qwen":
      return getLocalPresetConfigForNpc(npcId, "qwen");
    case "promoted":
      return getPromotedAdapterConfigForNpc(npcId);
    case "codex":
      return {
        backend: "codex",
        promptFormat: appConfig.finalReply.promptFormat,
        models: getFinalReplyModelCandidates(),
      } as const;
    case "openai_api":
      return {
        backend: "openai_api",
        promptFormat: appConfig.finalReply.promptFormat,
        models: getFinalReplyModelCandidates(),
      } as const;
    case "together":
      if (!appConfig.finalReply.remote.modelName) {
        return null;
      }
      return {
        backend: "together",
        model: appConfig.finalReply.remote.modelName,
        provider: appConfig.finalReply.remote.provider,
        promptFormat: appConfig.finalReply.promptFormat,
      } as const;
    case "runpod": {
      const remoteProviderRef = parseRemoteProviderRef(
        appConfig.finalReply.remote.provider,
      );
      if (
        remoteProviderRef?.kind !== "runpod" ||
        !appConfig.finalReply.remote.modelName
      ) {
        return null;
      }
      return {
        backend: "runpod",
        endpointId: remoteProviderRef.endpointId,
        endpointMode: appConfig.finalReply.remote.runpodEndpointMode,
        model: appConfig.finalReply.remote.modelName,
        provider: appConfig.finalReply.remote.provider,
        promptFormat: appConfig.finalReply.promptFormat,
      } as const;
    }
    case "baseten": {
      const remoteProviderRef = parseRemoteProviderRef(
        appConfig.finalReply.remote.provider,
      );
      const modelId =
        remoteProviderRef?.kind === "baseten"
          ? remoteProviderRef.modelId
          : appConfig.finalReply.remote.basetenModelId;
      if (!modelId || !appConfig.finalReply.remote.modelName) {
        return null;
      }
      return {
        backend: "baseten",
        modelId,
        modelUrl: appConfig.finalReply.remote.basetenModelUrl ?? null,
        model: appConfig.finalReply.remote.modelName,
        provider: appConfig.finalReply.remote.provider,
        promptFormat: appConfig.finalReply.promptFormat,
      } as const;
    }
  }
}

export async function hasMlxBinary() {
  if (!binaryCheckPromise) {
    binaryCheckPromise = fileExists(LOCAL_MLX_BINARY);
  }

  return binaryCheckPromise;
}

export async function resolveRuntimeArtifactKind(
  artifactPath: string,
  artifactKind: string | null | undefined,
) {
  if (artifactKind === "mlx_adapter" || artifactKind === "mlx_fused_model" || artifactKind === "legacy_mlx_adapter") {
    return artifactKind;
  }
  if (await fileExists(path.join(artifactPath, "adapters.safetensors"))) {
    return "legacy_mlx_adapter" as const;
  }
  return "mlx_fused_model" as const;
}

export async function hasRuntimeArtifact(
  artifactPath: string,
  artifactKind: RuntimeArtifactKind,
) {
  if (!adapterAvailability.has(`${artifactKind}:${artifactPath}`)) {
    adapterAvailability.set(
      `${artifactKind}:${artifactPath}`,
      artifactKind === "mlx_fused_model"
        ? fileExists(artifactPath)
        : fileExists(path.join(artifactPath, "adapters.safetensors")),
    );
  }
  return adapterAvailability.get(`${artifactKind}:${artifactPath}`) ?? Promise.resolve(false);
}
