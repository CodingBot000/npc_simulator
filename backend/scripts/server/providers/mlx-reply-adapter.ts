import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { GenerateInteractionInput } from "@backend-provider";
import { buildModelExecutionChildEnv } from "@backend-support/bootstrap";
import { PROJECT_ROOT, appConfig } from "@server/config";
import { databaseConfig } from "@server/config/database";
import { dbQuery } from "@server/db/postgres";
import {
  buildInteractionContract,
  validateReplyAgainstContract,
} from "@server/engine/interaction-contract";
import {
  createRunpodVllmRunSync,
  extractRunpodVllmText,
} from "@server/runpod-client";
import { parseRemoteProviderRef } from "@server/remote-provider";
import { getCurrentScenario } from "@server/scenario";
import {
  createTogetherChatCompletion,
  extractTogetherChatText,
} from "@server/together-client";

// MLX runtime entrypoint for inference-time LoRA adapter routing and reply rewriting.
const LOCAL_MLX_BINARY = path.join(PROJECT_ROOT, ".venv", "bin", "mlx_lm.generate");
const GENERIC_SYSTEM_PROMPT =
  "해저연구소 생존 협상 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 설명문, 요약문, 해설, JSON, 목록, 라벨은 금지한다. 플레이어 또는 다른 NPC에게 지금 이 자리에서 바로 말하듯 한 단락의 한국어 대사만 말한다.";
const SCENE_STATE_MIN_SYSTEM_PROMPT =
  "해저연구소 생존 협상 장면 안의 생존자로서, 아래 상태를 바탕으로 지금 방 안 사람에게 바로 하는 한국어 대사만 한 단락으로 말한다. 플레이어 발화나 의도 카드를 설명, 번역, 요약, 해설하지 마라. '이 대사는', '라는 말에 대한 한국어 대사', '의사를 표현한다' 같은 메타 설명문은 절대 금지다.";
const ROLE_SYSTEM_PROMPTS: Record<string, string> = {
  doctor:
    "해저연구소 의사 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 의무실 기록, 경고, 무시된 중단 신호를 근거로 누가 사람을 버렸는지 직접 짚는다. 반드시 3~4개의 짧은 문장으로 말하고, 기록이나 경고 하나는 구체적으로 꺼내며, 책임져야 할 사람 이름을 바로 부른다. 회의록, 보고서, 판결문처럼 말하지 말고 지금 눈앞 사람에게 쏘아붙이듯 말한다. '의무실 기록에 따르면', '그럼에도 불구하고', '책임을 져야 합니다' 같은 보고서 문체와 존칭투, JSON, 라벨은 금지한다.",
  supervisor:
    "해저연구소 감독관 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 법적 책임, 비용선, 설명 가능성, 책임 분리를 기준으로 차갑게 자른다. 반드시 2~4개의 짧은 문장으로 말하고, 비용선과 중단권을 분리해 설명하며, 누가 먼저 답해야 하는지 한 사람을 선명하게 찍는다. 보고서, 메모, 검토 의견처럼 말하지 말고 지금 방 안에서 상대를 잘라내듯 짧게 말한다. '판단 기준', '검토하십시오', '기록으로 명확히' 같은 내부 문구, 훈령문, JSON, 라벨은 금지한다.",
};
const NPC_STYLE_HINTS: Record<string, string> = {
  engineer:
    "직선적이고 거칠다. 관리직 책임 회피를 싫어하고 현장 단어를 자주 쓴다. 공손체보다 반말/직설체에 가깝다.",
  doctor:
    "차분하지만 죄책감이 배어 있다. 윤리와 기록을 중시한다. 설교문보다 사람을 향한 직접 발화로 말한다.",
  supervisor:
    "감정을 눌러 말한다. 법적 책임, 비용, 대체 가능성을 기준으로 자른다. 군더더기 없이 차갑게 말한다.",
  director:
    "짧게 끊어 말하고 권위를 지키려 한다. 조직, 승인, 통제 계통을 중시한다. 훈계문보다 통제하는 대사처럼 말한다.",
};
const NPC_DISPLAY_LABELS: Record<string, string> = {
  engineer: "박도현(엔지니어)",
  doctor: "한유리(의사)",
  supervisor: "마야 로웰(감독관)",
  director: "서진호(연구소장)",
};
type PromptFormat = "raw_json" | "situation_card" | "direct_scene";
type ScenePromptFormat = PromptFormat | "scene_state_min";
type RuntimeArtifactKind = "mlx_adapter" | "mlx_fused_model" | "legacy_mlx_adapter";
type LocalAdapterConfig = {
  backend: "local";
  path: string;
  promptFormat: ScenePromptFormat;
  runtimeKind: RuntimeArtifactKind;
  mlxModel?: string;
};

type TogetherAdapterConfig = {
  backend: "together";
  model: string;
  provider: string | null;
  promptFormat: ScenePromptFormat;
};

type RunpodAdapterConfig = {
  backend: "runpod";
  endpointId: string;
  model: string;
  provider: string | null;
  promptFormat: ScenePromptFormat;
};

type ResolvedAdapterConfig = LocalAdapterConfig | TogetherAdapterConfig | RunpodAdapterConfig;
const LEGACY_QWEN_REPLY_MLX_MODEL =
  "mlx-community/Qwen2.5-7B-Instruct-4bit";

const LEGACY_QWEN_ADAPTER_CONFIGS: Record<string, LocalAdapterConfig> = {
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

const LLAMA_ADAPTER_CONFIGS: Record<string, LocalAdapterConfig> = {
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

function containsHangul(text: string) {
  return /[가-힣]/u.test(text);
}

function looksEnglishOnly(text: string) {
  return /[A-Za-z]/u.test(text) && !containsHangul(text);
}

function extractDelimitedText(output: string) {
  const matches = [...String(output).matchAll(/==========\n([\s\S]*?)\n==========/g)];
  return matches.at(-1)?.[1]?.trim() ?? "";
}

function normalizeReplyText(text: string) {
  const normalized = text
    .trim()
    .replace(/^(?:npc\s*대사|npc\s*reply|대사|엔지니어|의사|감독관|소장|director|supervisor|doctor|engineer)\s*:\s*/iu, "")
    .trim();
  return stripWrappingQuotes(normalized);
}

function normalizeInlineText(text: string) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function stripWrappingQuotes(text: string) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return trimmed;
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }

  return trimmed;
}

function compactSentence(text: string) {
  return normalizeInlineText(text).replace(/[.。]$/u, "");
}

function truncateForPrompt(text: string, maxLength = 96) {
  const normalized = normalizeInlineText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getAdapterConfigForNpc(npcId: string) {
  const preset =
    ADAPTER_CONFIG_PRESETS[appConfig.localReply.family] ??
    ADAPTER_CONFIG_PRESETS.llama;
  return preset[npcId] ?? preset.default;
}

function supportsPromotedAdapterLookup() {
  return /postgres(?:ql)?:/u.test(databaseConfig.datasourceUrl);
}

async function getPromotedAdapterConfigForNpc(npcId: string) {
  if (!appConfig.localReply.usePromoted || !supportsPromotedAdapterLookup()) {
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
    const baseConfig = getAdapterConfigForNpc(promptBinding);
    const remoteProviderRef = parseRemoteProviderRef(row?.remote_provider);
    if (row?.remote_model_name && remoteProviderRef?.kind === "runpod") {
      return {
        backend: "runpod",
        endpointId: remoteProviderRef.endpointId,
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

async function resolveAdapterConfigForNpc(npcId: string) {
  const promotedConfig = await getPromotedAdapterConfigForNpc(npcId);
  return promotedConfig ?? getAdapterConfigForNpc(npcId);
}

async function hasMlxBinary() {
  if (!binaryCheckPromise) {
    binaryCheckPromise = fileExists(LOCAL_MLX_BINARY);
  }
  return binaryCheckPromise;
}

async function resolveRuntimeArtifactKind(
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

async function hasRuntimeArtifact(
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

function resolveSystemPrompt(npcId: string, promptFormat: ScenePromptFormat) {
  if (promptFormat === "scene_state_min") {
    return SCENE_STATE_MIN_SYSTEM_PROMPT;
  }

  return ROLE_SYSTEM_PROMPTS[npcId] ?? GENERIC_SYSTEM_PROMPT;
}

function parsePromptContextSummary(summary: string) {
  const result = {
    roundBefore: null as string | null,
    leaderBefore: null as string | null,
    target: null as string | null,
  };

  const parts = String(summary ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim() || null;

    if (key === "roundBefore") {
      result.roundBefore = value;
    } else if (key === "leaderBefore") {
      result.leaderBefore = value;
    } else if (key === "target") {
      result.target = value;
    }
  }

  return result;
}

function resolveTargetLabel(input: GenerateInteractionInput) {
  const context = parsePromptContextSummary(input.promptContextSummary);

  return (
    input.targetNpc?.persona.name ||
    context.target ||
    NPC_DISPLAY_LABELS[input.request.targetNpcId ?? ""] ||
    input.request.targetNpcId ||
    "none"
  );
}

function summarizeKnowledgeForPrompt(
  entry: GenerateInteractionInput["retrievedKnowledge"][number],
) {
  const summary = normalizeInlineText(entry.summary || entry.title || "");
  const title = normalizeInlineText(entry.title);
  let text = summary;

  if (title && text.startsWith(title)) {
    text = text.slice(title.length).replace(/^[:,-]\s*/, "").trim();
  }

  if (!text) {
    text = title;
  }

  return truncateForPrompt(text);
}

function buildEvidencePromptSummary(input: GenerateInteractionInput) {
  const summaries = input.retrievedKnowledge
    .slice(0, 4)
    .map((entry) => summarizeKnowledgeForPrompt(entry))
    .filter(Boolean);

  return summaries.length > 0 ? summaries.join(" / ") : "없음";
}

function resolveLeaderLabel(input: GenerateInteractionInput) {
  const context = parsePromptContextSummary(input.promptContextSummary);
  return context.leaderBefore ?? input.consensusBoard[0]?.candidateLabel ?? "none";
}

function resolveInteractionContract(input: GenerateInteractionInput) {
  return buildInteractionContract({
    inputMode: input.request.inputMode,
    text: input.request.text,
    action: input.request.action,
    targetNpcId: input.request.targetNpcId,
    targetNpcLabel: input.targetNpc?.persona.name ?? null,
    targetCandidates: input.consensusBoard.map((entry) => ({
      id: entry.candidateId,
      label: entry.candidateLabel,
    })),
  });
}

function summarizeChatMessageForPrompt(
  entry: GenerateInteractionInput["recentConversation"][number],
) {
  const speakerLabel =
    entry.speaker === "player"
      ? "플레이어"
      : NPC_DISPLAY_LABELS[entry.npcId] ?? entry.npcId ?? "다른 생존자";

  return `${speakerLabel}: ${truncateForPrompt(entry.text, 72)}`;
}

function buildRecentConversationPromptSummary(input: GenerateInteractionInput) {
  const currentPlayerText = normalizeInlineText(
    input.request.text || input.normalizedInput.promptSummary,
  );

  const lines = input.recentConversation
    .filter((entry) => normalizeInlineText(entry.text) !== currentPlayerText)
    .slice(-2)
    .map((entry) => summarizeChatMessageForPrompt(entry))
    .filter(Boolean);

  return lines.length > 0 ? lines.join(" / ") : null;
}

function buildRecentEventPromptSummary(input: GenerateInteractionInput) {
  const lines = input.recentEvents
    .slice(-2)
    .map((entry) => truncateForPrompt(entry.detail || entry.title || "", 84))
    .filter(Boolean);

  return lines.length > 0 ? lines.join(" / ") : null;
}

function resolvePlayerPromptLines(input: GenerateInteractionInput) {
  return resolveInteractionContract(input).playerPromptLines;
}

function buildAdapterPromptContextSummary(input: GenerateInteractionInput) {
  const context = parsePromptContextSummary(input.promptContextSummary);

  return [
    `roundBefore=${context.roundBefore ?? String(input.round.currentRound)}`,
    `leaderBefore=${context.leaderBefore ?? input.consensusBoard[0]?.candidateLabel ?? "none"}`,
    `target=${resolveTargetLabel(input)}`,
    `retrievedMemories=${input.retrievedMemories.length}`,
    `retrievedEvidence=${buildEvidencePromptSummary(input)}`,
  ].join(" | ");
}

function buildRawJsonPrompt(input: GenerateInteractionInput) {
  const scenario = getCurrentScenario();
  const contract = resolveInteractionContract(input);
  const userPayload = {
    scenarioId: scenario.id,
    turnIndex: input.round.currentRound,
    npcId: input.npc.persona.id,
    targetNpcId: input.request.targetNpcId,
    npcStyleHint: NPC_STYLE_HINTS[input.npc.persona.id] ?? null,
    playerText: input.request.text || input.normalizedInput.promptSummary,
    normalizedInputSummary: input.normalizedInput.promptSummary,
    interactionContract: {
      mode: contract.mode,
      canonicalPlayerMove: contract.canonicalPlayerMove,
      playerPromptLines: contract.playerPromptLines,
      replyRules: contract.replyRules,
    },
    promptContextSummary: buildAdapterPromptContextSummary(input),
  };

  return [
    "다음은 NPC 응답 생성 입력이다.",
    "입력 JSON:",
    JSON.stringify(userPayload, null, 2),
    "출력 규칙:",
    "- 지금 이 자리에서 바로 내뱉는 대사만 말한다.",
    "- 두세 문장 이상으로 말하고, 책임선이나 근거 하나는 분명히 찍는다.",
    "- 입력 JSON의 필드명이나 '판단 기준' 같은 내부 메모 문구를 그대로 따라 말하지 않는다.",
    "- 화자 라벨, 설명, 요약, JSON, 메타 발언을 쓰지 않는다.",
  ].join("\n");
}

function buildSituationCardPrompt(input: GenerateInteractionInput) {
  const scenario = getCurrentScenario();
  const contract = resolveInteractionContract(input);
  const context = parsePromptContextSummary(input.promptContextSummary);
  const targetLabel = resolveTargetLabel(input);
  const evidenceSummary = buildEvidencePromptSummary(input);
  const playerLines = contract.playerPromptLines;

  return [
    "상황 카드",
    `- 시나리오: ${scenario.id}`,
    `- 화자: ${NPC_DISPLAY_LABELS[input.npc.persona.id] ?? `${input.npc.persona.name}(${input.npc.persona.role})`}`,
    `- 상대: ${targetLabel}`,
    ...playerLines,
    `- 플레이어 의도 요약: ${input.normalizedInput.promptSummary}`,
    ...contract.replyRules.map((rule) => `- 응답 규칙: ${rule}`),
    `- 현재 라운드: ${context.roundBefore ?? String(input.round.currentRound)}`,
    `- 직전 압박 선두: ${context.leaderBefore ?? input.consensusBoard[0]?.candidateLabel ?? "없음"}`,
    `- 핵심 근거: ${evidenceSummary}`,
    `- 말투 힌트: ${NPC_STYLE_HINTS[input.npc.persona.id] ?? "없음"}`,
    "출력 규칙:",
    "- 지금 이 자리에서 바로 내뱉는 대사만 말한다.",
    "- 두세 문장 이상으로 말하고, 책임선이나 근거 하나는 분명히 찍는다.",
    "- 필드명, 키, 내부 메모 문구를 따라 읽지 않는다.",
    "- 화자 라벨, 설명, 요약, JSON, 메타 발언을 쓰지 않는다.",
  ].join("\n");
}

function buildDirectScenePrompt(input: GenerateInteractionInput) {
  const contract = resolveInteractionContract(input);
  const context = parsePromptContextSummary(input.promptContextSummary);
  const targetLabel = resolveTargetLabel(input);
  const evidenceSummary = buildEvidencePromptSummary(input);
  const playerLines = contract.playerPromptLines;

  return [
    `너는 지금 ${NPC_DISPLAY_LABELS[input.npc.persona.id] ?? `${input.npc.persona.name}(${input.npc.persona.role})`}로 말한다.`,
    targetLabel && targetLabel !== "none"
      ? `상대는 ${targetLabel}다. 지금 그 사람이나 방 안 사람들에게 바로 쏘아붙이듯 말해라.`
      : "상대가 정해지지 않았다. 지금 방 안 사람들에게 바로 말해라.",
    ...playerLines,
    `지금 기억해야 할 근거: ${evidenceSummary}.`,
    `현재 라운드는 ${context.roundBefore ?? String(input.round.currentRound)}다.`,
    `직전 압박 선두는 ${resolveLeaderLabel(input) ?? "없음"}였다.`,
    `말투 힌트: ${NPC_STYLE_HINTS[input.npc.persona.id] ?? "없음"}`,
    "보고서, 회의록, 판결문처럼 쓰지 말고 지금 이 자리의 대사로만 2~4문장 말해라.",
    "문장 첫머리에 의무실 기록에 따르면, 판단 기준, 검토하십시오 같은 메타 문구를 쓰지 마라.",
    "플레이어 문장이나 의도 카드를 설명하거나 번역하지 마라.",
    "화자 라벨, JSON, 목록, 요약문은 금지다.",
    ...contract.replyRules,
  ].join("\n");
}

function buildSceneStateMinPrompt(input: GenerateInteractionInput) {
  const contract = resolveInteractionContract(input);
  const speakerLabel =
    NPC_DISPLAY_LABELS[input.npc.persona.id] ??
    `${input.npc.persona.name}(${input.npc.persona.role})`;
  const targetLabel = resolveTargetLabel(input);
  const evidenceLines = input.retrievedKnowledge
    .slice(0, 3)
    .map((entry) => summarizeKnowledgeForPrompt(entry))
    .filter(Boolean);
  const currentGoal = truncateForPrompt(input.npc.goals.currentGoal || "", 96);
  const survivalBias = truncateForPrompt(
    input.npc.decision.survivalRationale || input.npc.decision.biasSummary || "",
    120,
  );
  const recentConversation = buildRecentConversationPromptSummary(input);
  const recentEvent = buildRecentEventPromptSummary(input);
  const playerLines = contract.playerPromptLines;

  return [
    `화자: ${speakerLabel}`,
    `상대: ${targetLabel === "none" ? "없음" : targetLabel}`,
    ...playerLines,
    "",
    "화자 상태",
    `- 감정: ${input.npc.emotion.primary} ${input.npc.emotion.intensity}`,
    currentGoal ? `- 현재 목표: ${currentGoal}` : null,
    survivalBias ? `- 생존 편향: ${survivalBias}` : null,
    "",
    "지금 장면",
    `- 라운드: ${input.round.currentRound}`,
    `- 직전 압박 선두: ${resolveLeaderLabel(input) === "none" ? "없음" : resolveLeaderLabel(input)}`,
    recentEvent ? `- 최근 사건: ${recentEvent}` : null,
    recentConversation ? `- 최근 대화: ${recentConversation}` : null,
    "",
    "근거",
    ...(evidenceLines.length > 0 ? evidenceLines.map((line) => `- ${line}`) : ["- 뚜렷한 근거 없음"]),
    "",
    "출력 규칙",
    "- 지금 방 안에서 바로 하는 NPC 대사만 2~4문장으로 말한다.",
    "- 플레이어 발화나 의도 카드를 설명, 번역, 요약, 평가하지 않는다.",
    "- '이 대사는', '라는 말에 대한 한국어 대사', '의사를 표현한다' 같은 메타 설명문을 쓰지 않는다.",
    "- 화자 라벨, JSON, 목록, 요약문을 쓰지 않는다.",
    ...contract.replyRules.map((rule) => `- ${rule}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(
  input: GenerateInteractionInput,
  promptFormat: ScenePromptFormat,
) {
  if (promptFormat === "situation_card") {
    return buildSituationCardPrompt(input);
  }

  if (promptFormat === "direct_scene") {
    return buildDirectScenePrompt(input);
  }

  if (promptFormat === "scene_state_min") {
    return buildSceneStateMinPrompt(input);
  }

  return buildRawJsonPrompt(input);
}

async function runMlxGenerate(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(LOCAL_MLX_BINARY, args, {
      cwd: PROJECT_ROOT,
      env: buildModelExecutionChildEnv(PROJECT_ROOT),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("mlx_lm.generate timed out after 120000ms."));
    }, 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "mlx_lm.generate failed."));
        return;
      }
      resolve(extractDelimitedText(stdout || stderr));
    });
  });
}

async function runTogetherGenerate(params: {
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createTogetherChatCompletion({
    model: params.model,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.localReply.maxTokens,
    temperature: 0.7,
  });
  return extractTogetherChatText(response) ?? "";
}

async function runRunpodGenerate(params: {
  endpointId: string;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createRunpodVllmRunSync({
    endpointId: params.endpointId,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.localReply.maxTokens,
    temperature: 0.7,
  });
  return extractRunpodVllmText(response) ?? "";
}

function canonicalizeReplyForGuard(text: string) {
  return stripWrappingQuotes(normalizeInlineText(text))
    .replace(/^[“"'‘’]+|[“"'‘’]+$/gu, "")
    .trim();
}

function looksRepeatedRecentReply(text: string, input: GenerateInteractionInput) {
  const candidate = canonicalizeReplyForGuard(text);
  if (!candidate || candidate.length < 8) {
    return false;
  }

  const recentNpcReplies = input.recentConversation
    .filter((entry) => entry.speaker === "npc")
    .slice(-3)
    .map((entry) => canonicalizeReplyForGuard(entry.text))
    .filter(Boolean);

  return recentNpcReplies.some((entry) => entry === candidate);
}

export async function maybeGenerateReplyWithLocalAdapter(
  input: GenerateInteractionInput,
) {
  const mode = appConfig.localReplyAdapterMode;
  if (mode === "off") {
    return null;
  }

  const playerText = input.request.text || input.normalizedInput.promptSummary;
  if (looksEnglishOnly(playerText)) {
    return null;
  }

  const adapterConfig = await resolveAdapterConfigForNpc(input.npc.persona.id);
  const prompt = buildPrompt(input, adapterConfig.promptFormat);
  let text: string;
  let sourceRef: string;

  if (adapterConfig.backend === "together") {
    text = await runTogetherGenerate({
      model: adapterConfig.model,
      npcId: input.npc.persona.id,
      promptFormat: adapterConfig.promptFormat,
      prompt,
    });
    sourceRef = adapterConfig.model;
  } else if (adapterConfig.backend === "runpod") {
    text = await runRunpodGenerate({
      endpointId: adapterConfig.endpointId,
      model: adapterConfig.model,
      npcId: input.npc.persona.id,
      promptFormat: adapterConfig.promptFormat,
      prompt,
    });
    sourceRef = `${adapterConfig.endpointId}:${adapterConfig.model}`;
  } else {
    const binaryAvailable = await hasMlxBinary();
    if (!binaryAvailable) {
      if (mode === "on") {
        throw new Error(`MLX binary not found: ${LOCAL_MLX_BINARY}`);
      }
      return null;
    }

    const adapterPath = adapterConfig.path;
    const adapterAvailable = await hasRuntimeArtifact(
      adapterPath,
      adapterConfig.runtimeKind,
    );
    if (!adapterAvailable) {
      if (mode === "on") {
        throw new Error(`Runtime artifact not found: ${adapterPath}`);
      }
      return null;
    }

    text = await runMlxGenerate(
      adapterConfig.runtimeKind === "mlx_fused_model"
        ? [
            "--model",
            adapterPath,
            "--system-prompt",
            resolveSystemPrompt(input.npc.persona.id, adapterConfig.promptFormat),
            "--prompt",
            prompt,
            "--max-tokens",
            String(appConfig.localReply.maxTokens),
          ]
        : [
            "--model",
            adapterConfig.mlxModel ?? appConfig.localReply.mlxModel,
            "--adapter-path",
            adapterPath,
            "--system-prompt",
            resolveSystemPrompt(input.npc.persona.id, adapterConfig.promptFormat),
            "--prompt",
            prompt,
            "--max-tokens",
            String(appConfig.localReply.maxTokens),
          ],
    );
    sourceRef = adapterPath;
  }

  const normalized = text.trim();
  const cleaned = normalizeReplyText(normalized);
  const contract = resolveInteractionContract(input);
  const validation = validateReplyAgainstContract({
    replyText: cleaned,
    contract,
    npcName: input.npc.persona.name,
  });
  if (
    !cleaned ||
    /^!+$/u.test(cleaned) ||
    !validation.ok ||
    looksRepeatedRecentReply(cleaned, input)
  ) {
    return null;
  }

  return {
    text: cleaned,
    adapterPath: sourceRef,
  };
}
