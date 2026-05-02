import type { GenerateInteractionInput } from "@backend-provider";
import { appConfig } from "@server/config";
import {
  runBasetenGenerate,
  runCodexGenerate,
  runMlxGenerate,
  runOpenAiGenerate,
  runRunpodGenerate,
  runTogetherGenerate,
  isBaseten400RequestError,
} from "@server/providers/final-reply-provider-clients";
import {
  LOCAL_MLX_BINARY,
  hasMlxBinary,
  hasRuntimeArtifact,
  type ResolvedAdapterConfig,
} from "@server/providers/mlx-reply-config";
import { resolveSystemPrompt } from "@server/providers/mlx-reply-prompts";

export const OPENAI_FALLBACK_FROM_BASETEN_400_MARKER = "fallback_from_baseten_400";
export { isBaseten400RequestError };

export type FinalReplyCandidate = {
  text: string;
  sourceRef: string;
  adapterPath: string | null;
};

export async function generateFinalReplyCandidate(params: {
  input: GenerateInteractionInput;
  candidatePrompt: string;
  config: ResolvedAdapterConfig;
  mode: string;
}): Promise<FinalReplyCandidate | null> {
  const npcId = params.input.npc.persona.id;

  if (params.config.backend === "codex") {
    const generated = await runCodexGenerate({
      models: params.config.models,
      npcId,
      promptFormat: params.config.promptFormat,
      prompt: params.candidatePrompt,
    });
    return {
      text: generated.text,
      sourceRef: `codex:${generated.model}`,
      adapterPath: null,
    };
  }

  if (params.config.backend === "openai_api") {
    const generated = await runOpenAiGenerate({
      models: params.config.models,
      npcId,
      promptFormat: params.config.promptFormat,
      prompt: params.candidatePrompt,
    });
    return {
      text: generated.text,
      sourceRef: `openai:${generated.model}`,
      adapterPath: null,
    };
  }

  if (params.config.backend === "together") {
    return {
      text: await runTogetherGenerate({
        model: params.config.model,
        npcId,
        promptFormat: params.config.promptFormat,
        prompt: params.candidatePrompt,
      }),
      sourceRef: `together:${params.config.model}`,
      adapterPath: null,
    };
  }

  if (params.config.backend === "runpod") {
    return {
      text: await runRunpodGenerate({
        endpointId: params.config.endpointId,
        model: params.config.model,
        npcId,
        promptFormat: params.config.promptFormat,
        prompt: params.candidatePrompt,
      }),
      sourceRef: `runpod:${params.config.endpointId}:${params.config.model}`,
      adapterPath: null,
    };
  }

  if (params.config.backend === "baseten") {
    return {
      text: await runBasetenGenerate({
        modelId: params.config.modelId,
        modelUrl: params.config.modelUrl,
        model: params.config.model,
        npcId,
        promptFormat: params.config.promptFormat,
        prompt: params.candidatePrompt,
      }),
      sourceRef: `baseten:${params.config.modelId}:${params.config.model}`,
      adapterPath: null,
    };
  }

  const localConfig = params.config;
  return generateLocalMlxFinalReply({
    input: params.input,
    candidatePrompt: params.candidatePrompt,
    config: localConfig,
    mode: params.mode,
  });
}

async function generateLocalMlxFinalReply(params: {
  candidatePrompt: string;
  config: Extract<ResolvedAdapterConfig, { backend: "local" }>;
  input: GenerateInteractionInput;
  mode: string;
}): Promise<FinalReplyCandidate | null> {
  const binaryAvailable = await hasMlxBinary();
  if (!binaryAvailable) {
    if (params.mode === "on") {
      throw new Error(`MLX binary not found: ${LOCAL_MLX_BINARY}`);
    }
    return null;
  }

  const adapterPath = params.config.path;
  const adapterAvailable = await hasRuntimeArtifact(
    adapterPath,
    params.config.runtimeKind,
  );
  if (!adapterAvailable) {
    if (params.mode === "on") {
      throw new Error(`Runtime artifact not found: ${adapterPath}`);
    }
    return null;
  }

  const npcId = params.input.npc.persona.id;
  return {
    text: await runMlxGenerate(buildMlxArgs({
      adapterPath,
      candidatePrompt: params.candidatePrompt,
      config: params.config,
      npcId,
    })),
    sourceRef: `local:${params.config.mlxModel ?? appConfig.localReply.family}`,
    adapterPath,
  };
}

function buildMlxArgs(params: {
  adapterPath: string;
  candidatePrompt: string;
  config: Extract<ResolvedAdapterConfig, { backend: "local" }>;
  npcId: string;
}) {
  if (params.config.runtimeKind === "mlx_fused_model") {
    return [
      "--model",
      params.adapterPath,
      "--system-prompt",
      resolveSystemPrompt(params.npcId, params.config.promptFormat),
      "--prompt",
      params.candidatePrompt,
      "--max-tokens",
      String(appConfig.finalReply.maxTokens),
    ];
  }

  return [
    "--model",
    params.config.mlxModel ?? appConfig.localReply.mlxModel,
    "--adapter-path",
    params.adapterPath,
    "--system-prompt",
    resolveSystemPrompt(params.npcId, params.config.promptFormat),
    "--prompt",
    params.candidatePrompt,
    "--max-tokens",
    String(appConfig.finalReply.maxTokens),
  ];
}
