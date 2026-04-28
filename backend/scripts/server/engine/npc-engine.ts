import {
  DEFAULT_PLAYER_ID,
  NPC_ACTION_LABELS,
} from "@backend-support/constants";
import type {
  EpisodeExportPaths,
  InteractionFailureDebugEntry,
  InteractionTraceEntry,
  InteractionTraceStage,
  InteractionTraceStatus,
  InspectorPayload,
  NpcState,
  InteractionRequestPayload,
  InteractionResponsePayload,
} from "@backend-contracts/api";
import type {
  InteractionLogEntry,
} from "@backend-persistence";
import type {
  PersistedNpcState,
} from "@backend-domain";
import { formatPlayerConversationText, nowIso } from "@backend-support/utils";
import { normalizeLlmInteractionResult } from "@server/engine/action-selection";
import { simulateNpcAutonomyPhase } from "@server/engine/npc-autonomy";
import {
  buildInteractionContract,
  validateReplyAgainstContract,
  validateStructuredResultAgainstContract,
} from "@server/engine/interaction-contract";
import {
  cleanupExportPaths,
  exportEpisodeDataset,
} from "@server/engine/dataset-export";
import { normalizeInteractionInput } from "@server/engine/intent";
import {
  buildMemoryEntries,
  updateMemoryBank,
} from "@server/engine/memory";
import {
  applyInteractionPressure,
  boardTargetLabel,
  buildConsensusBoard,
  nextSpeakerState,
  progressRound,
  resolveIfNeeded,
} from "@server/engine/pressure-engine";
import {
  buildWorldSnapshot,
  composeInteractionEventLogEntry,
  composeRoundEventLogEntry,
} from "@server/engine/world-state";
import { buildFallbackInteractionResult } from "@server/engine/fallback-interaction";
import { maybeGenerateFinalReply } from "@server/providers/mlx-reply-adapter";
import { retrieveEvidenceBundle } from "@server/engine/retrieval";
import { buildRuntimeStatus, getLlmProvider } from "@server/providers/llm-provider";
import { maybeGenerateShadowComparison } from "@server/providers/shadow-compare";
import { createWorldRepository } from "@server/store/repositories";
import type { WorldRepositoryOptions } from "@server/store/repositories";
import type { WorldStateBundle } from "@server/store/world-bundle";

const REPLY_LABEL_PREFIX = /^(?:\.\.\.|…|\s)*(?:npc\s*대사|npc\s*reply|대사|의사|감독관|엔지니어|소장|doctor|supervisor|engineer|director)\s*:\s*/iu;
const META_OPENING_PATTERNS = [
  /^(?:\.\.\.|…|\s)*(?:의무실 기록에 따르면|기록에 따르면)[,.: ]*/u,
  /^(?:\.\.\.|…|\s)*(?:판단 기준(?:은|으로는)?|검토하십시오|검토(?:하면|하면요)?)[,.: ]*/u,
  /^(?:\.\.\.|…|\s)*(?:response|reply|assistant)\s*:\s*/iu,
];

function recentConversationForNpc(
  entries: InteractionLogEntry[],
  npcId: string,
) {
  return entries
    .filter((entry) => entry.npcId === npcId)
    .slice(-4)
    .flatMap((entry) => [
      {
        id: `${entry.id}-player`,
        npcId: entry.npcId,
        speaker: "player" as const,
        text: entry.playerText,
        timestamp: entry.timestamp,
        action: entry.playerAction,
        fallbackUsed: false,
      },
      {
        id: `${entry.id}-npc`,
        npcId: entry.npcId,
        speaker: "npc" as const,
        text: entry.replyText,
        timestamp: entry.timestamp,
        action: entry.selectedAction,
        fallbackUsed: entry.fallbackUsed ?? false,
        replyRewriteSource: entry.replyRewriteSource ?? null,
      },
    ]);
}

function persistNpc(nextNpc: PersistedNpcState, npcs: PersistedNpcState[]) {
  const index = npcs.findIndex((candidate) => candidate.persona.id === nextNpc.persona.id);

  if (index >= 0) {
    npcs[index] = nextNpc;
  }
}

function isPersistedNpcId(npcId: string | null, npcs: PersistedNpcState[]) {
  return Boolean(npcId && npcs.some((npc) => npc.persona.id === npcId));
}

function buildPromptContextSummary(params: {
  roundBefore: number;
  leaderLabel: string | null;
  targetLabel: string | null;
  memoryCount: number;
  knowledgeTitles: string[];
}) {
  return [
    `roundBefore=${params.roundBefore}`,
    `leaderBefore=${params.leaderLabel ?? "none"}`,
    `target=${params.targetLabel ?? "none"}`,
    `retrievedMemories=${params.memoryCount}`,
    `retrievedEvidence=${params.knowledgeTitles.join(", ") || "none"}`,
  ].join(" | ");
}

function sanitizeReplyText(text: string) {
  const original = String(text ?? "").trim();
  if (!original) {
    return original;
  }

  let cleaned = original.replace(REPLY_LABEL_PREFIX, "").trim();
  for (const pattern of META_OPENING_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of quotePairs) {
    if (cleaned.startsWith(open) && cleaned.endsWith(close)) {
      cleaned = cleaned.slice(open.length, cleaned.length - close.length).trim();
      break;
    }
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || original;
}

type PendingInteractionTrace = {
  stage: InteractionTraceStage;
  label: string;
  detail?: string | null;
  sourceRef?: string | null;
  startedAtMs: number;
  startedAtAbsoluteMs: number;
};

function startInteractionTraceStage(
  originMs: number,
  stage: InteractionTraceStage,
  label: string,
  detail?: string | null,
  sourceRef?: string | null,
): PendingInteractionTrace {
  const startedAtAbsoluteMs = Date.now();
  return {
    stage,
    label,
    detail,
    sourceRef,
    startedAtMs: Math.max(0, startedAtAbsoluteMs - originMs),
    startedAtAbsoluteMs,
  };
}

function finishInteractionTraceStage(
  entries: InteractionTraceEntry[],
  originMs: number,
  pending: PendingInteractionTrace,
  status: InteractionTraceStatus,
  detail?: string | null,
  sourceRef?: string | null,
) {
  const finishedAtAbsoluteMs = Date.now();
  const finishedAtMs = Math.max(0, finishedAtAbsoluteMs - originMs);
  entries.push({
    stage: pending.stage,
    label: pending.label,
    status,
    startedAtMs: pending.startedAtMs,
    finishedAtMs,
    durationMs: Math.max(0, finishedAtAbsoluteMs - pending.startedAtAbsoluteMs),
    detail: detail ?? pending.detail ?? null,
    sourceRef: sourceRef ?? pending.sourceRef ?? null,
  });
}

function recordInteractionTraceStage(
  entries: InteractionTraceEntry[],
  originMs: number,
  stage: InteractionTraceStage,
  label: string,
  status: InteractionTraceStatus,
  detail?: string | null,
  sourceRef?: string | null,
) {
  const atAbsoluteMs = Date.now();
  const atMs = Math.max(0, atAbsoluteMs - originMs);
  entries.push({
    stage,
    label,
    status,
    startedAtMs: atMs,
    finishedAtMs: atMs,
    durationMs: 0,
    detail: detail ?? null,
    sourceRef: sourceRef ?? null,
  });
}

export interface InteractionTurnWorkerResult {
  nextBundle: WorldStateBundle;
  cleanupExportPaths: EpisodeExportPaths | null;
  reply: InteractionResponsePayload["reply"];
  relationshipDelta: InteractionResponsePayload["relationshipDelta"];
  pressureChanges: InteractionResponsePayload["pressureChanges"];
  eventLogEntry: InteractionResponsePayload["eventLogEntry"];
  inspector: InteractionResponsePayload["inspector"];
  resolution: InteractionResponsePayload["resolution"];
}

export async function runInteractionTurn(
  bundle: WorldStateBundle,
  request: InteractionRequestPayload,
): Promise<InteractionTurnWorkerResult> {
  const { worldState, memoryFile, interactionLog } = bundle;
  const turnStartedAtMs = Date.now();
  const interactionTraceEntries: InteractionTraceEntry[] = [];

  if (worldState.resolution.resolved) {
    throw new Error("이미 희생 대상이 확정되었습니다. reset 후 다시 시작하세요.");
  }

  const npcIndex = worldState.npcs.findIndex(
    (candidate) => candidate.persona.id === request.npcId,
  );

  if (npcIndex < 0) {
    throw new Error(`NPC '${request.npcId}' does not exist.`);
  }

  const persistedNpc = worldState.npcs[npcIndex];
  const npc: NpcState = {
    ...persistedNpc,
    memories: memoryFile.memories[request.npcId] ?? [],
  };
  const targetNpc =
    request.targetNpcId && request.targetNpcId !== DEFAULT_PLAYER_ID
      ? worldState.npcs.find(
          (candidate) => candidate.persona.id === request.targetNpcId,
        ) ?? null
      : null;

  const prepareContextTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "prepare_context",
    "입력 정리·컨텍스트 수집",
  );
  const normalizedInput = normalizeInteractionInput({
    text: request.text,
    action: request.action,
    inputMode: request.inputMode,
    targetNpcId: request.targetNpcId,
    targetNpcLabel: targetNpc?.persona.name ?? null,
    targetCandidates: worldState.npcs.map((candidate) => ({
      id: candidate.persona.id,
      label: candidate.persona.name,
    })),
  });
  const recentConversation = recentConversationForNpc(
    interactionLog.entries,
    request.npcId,
  );
  const consensusBoardBefore = buildConsensusBoard({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
  });
  const leaderBefore = consensusBoardBefore[0] ?? null;
  const recentEvents = worldState.events.slice(0, 4);
  const retrieval = retrieveEvidenceBundle({
    memories: npc.memories,
    normalizedInput,
    npcId: request.npcId,
    targetNpcId: request.targetNpcId,
    recentEvents,
    roundNumber: worldState.round.currentRound,
  });
  const retrievedMemories = retrieval.memories;
  const retrievedKnowledge = retrieval.knowledge;
  const roundBefore = worldState.round.currentRound;
  const initialTargetLabel = request.targetNpcId
    ? boardTargetLabel(request.targetNpcId, worldState.npcs)
    : null;
  const promptContextSummary = buildPromptContextSummary({
    roundBefore,
    leaderLabel: leaderBefore?.candidateLabel ?? null,
    targetLabel: initialTargetLabel,
    memoryCount: retrievedMemories.length,
    knowledgeTitles: retrievedKnowledge.map((entry) => entry.title),
  });
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    prepareContextTrace,
    "ok",
    `memory=${retrievedMemories.length}, evidence=${retrievedKnowledge.length}, recentConversation=${recentConversation.length}`,
  );

  const provider = getLlmProvider();
  const generationInput = {
    request,
    world: worldState.world,
    npc,
    targetNpc,
    round: worldState.round,
    consensusBoard: consensusBoardBefore,
    recentEvents,
    recentConversation,
    retrievedMemories,
    retrievedKnowledge,
    normalizedInput,
    promptContextSummary,
  };
  const interactionContract = buildInteractionContract({
    inputMode: request.inputMode,
    text: request.text,
    action: request.action,
    targetNpcId: request.targetNpcId,
    targetNpcLabel: targetNpc?.persona.name ?? null,
    targetCandidates: worldState.npcs.map((candidate) => ({
      id: candidate.persona.id,
      label: candidate.persona.name,
    })),
  });
  const shadowComparisonPromise = maybeGenerateShadowComparison(generationInput);
  let fallbackUsed = false;
  let replyRewriteSource: string | null = null;
  let replyRewriteReason: string | null = null;
  const failureDebugEntries: InteractionFailureDebugEntry[] = [];
  let llmResult;

  const providerTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "interaction_provider",
    "기본 interaction 생성",
    null,
    provider.mode,
  );
  try {
    llmResult = normalizeLlmInteractionResult(
      await provider.generateInteraction(generationInput),
    );
    finishInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      providerTrace,
      "ok",
      `mode=${provider.mode}`,
      provider.mode,
    );
  } catch (error) {
    fallbackUsed = true;
    const providerErrorMessage =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "기본 interaction 생성 요청이 실패했습니다.";
    finishInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      providerTrace,
      "failed",
      providerErrorMessage,
      provider.mode,
    );
    console.warn(
      "[llm-provider] falling back to deterministic interaction:",
      error instanceof Error ? error.message : String(error),
    );
    failureDebugEntries.push({
      stage: "interaction_provider",
      kind: "provider_error",
      summary: providerErrorMessage,
      sourceRef: provider.mode,
    });
    const fallbackTrace = startInteractionTraceStage(
      turnStartedAtMs,
      "interaction_fallback",
      "deterministic fallback",
      null,
      "deterministic",
    );
    llmResult = normalizeLlmInteractionResult(
      buildFallbackInteractionResult(generationInput),
    );
    finishInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      fallbackTrace,
      "fallback",
      "provider 오류로 deterministic fallback을 사용했습니다.",
      "deterministic",
    );
  }

  if (!fallbackUsed) {
    const validationTrace = startInteractionTraceStage(
      turnStartedAtMs,
      "interaction_validation",
      "기본 interaction 검증",
      null,
      provider.mode,
    );
    const structuredValidation = validateStructuredResultAgainstContract({
      result: llmResult,
      contract: interactionContract,
    });
    const replyValidation = validateReplyAgainstContract({
      replyText: sanitizeReplyText(llmResult.reply.text),
      contract: interactionContract,
      npcName: npc.persona.name,
    });

    if (!structuredValidation.ok || !replyValidation.ok) {
      fallbackUsed = true;
      const validationIssues = [
        ...structuredValidation.issues,
        ...replyValidation.issues,
      ];
      finishInteractionTraceStage(
        interactionTraceEntries,
        turnStartedAtMs,
        validationTrace,
        "failed",
        validationIssues.map((issue) => issue.code).join(", "),
        provider.mode,
      );
      console.warn(
        "[llm-provider] contract validation failed, using deterministic fallback:",
        validationIssues
          .map((issue) => issue.code)
          .join(", "),
      );
      failureDebugEntries.push({
        stage: "interaction_validation",
        kind: "contract_validation",
        summary: "기본 interaction 결과가 계약 검증을 통과하지 못했습니다.",
        sourceRef: provider.mode,
        issues: validationIssues.map((issue) => `${issue.code}: ${issue.message}`),
        candidateReplyText: sanitizeReplyText(llmResult.reply.text),
        candidateSelectedActionType: llmResult.selectedAction.type,
        candidateSelectedActionReason: llmResult.selectedAction.reason,
        candidateTargetNpcId: llmResult.structuredImpact.targetNpcId,
        candidateImpactTags: llmResult.structuredImpact.impactTags,
      });
      const fallbackTrace = startInteractionTraceStage(
        turnStartedAtMs,
        "interaction_fallback",
        "deterministic fallback",
        null,
        "deterministic",
      );
      llmResult = normalizeLlmInteractionResult(
        buildFallbackInteractionResult(generationInput),
      );
      finishInteractionTraceStage(
        interactionTraceEntries,
        turnStartedAtMs,
        fallbackTrace,
        "fallback",
        "계약 검증 실패로 deterministic fallback을 사용했습니다.",
        "deterministic",
      );
    } else {
      finishInteractionTraceStage(
        interactionTraceEntries,
        turnStartedAtMs,
        validationTrace,
        "ok",
        `selectedAction=${llmResult.selectedAction.type}`,
        provider.mode,
      );
    }
  } else {
    recordInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      "interaction_validation",
      "기본 interaction 검증",
      "skipped",
      "fallback interaction이라 별도 검증을 건너뛰었습니다.",
      provider.mode,
    );
  }

  try {
    const rewrittenReply = await maybeGenerateFinalReply(generationInput, {
      draftReplyText: llmResult.reply.text,
      selectedActionType: llmResult.selectedAction.type,
      selectedActionReason: llmResult.selectedAction.reason,
    }, {
      traceOriginMs: turnStartedAtMs,
    });
    if (rewrittenReply?.trace?.length) {
      interactionTraceEntries.push(...rewrittenReply.trace);
    } else {
      recordInteractionTraceStage(
        interactionTraceEntries,
        turnStartedAtMs,
        "reply_rewrite_request",
        "final reply rewrite 요청",
        "skipped",
        "rewrite를 실행하지 않았습니다.",
        "final_reply",
      );
    }
    if (rewrittenReply?.debugFailures?.length) {
      failureDebugEntries.push(...rewrittenReply.debugFailures);
    }
    if (rewrittenReply?.text) {
      replyRewriteSource = rewrittenReply.sourceRef ?? rewrittenReply.adapterPath ?? null;
      replyRewriteReason = null;
      llmResult = {
        ...llmResult,
        reply: {
          text: rewrittenReply.text,
          rewriteSource: replyRewriteSource,
          rewriteReason: null,
        },
      };
    } else if (rewrittenReply?.sourceRef) {
      replyRewriteSource = rewrittenReply.sourceRef;
      replyRewriteReason = rewrittenReply.rejectedReason ?? "최종 reply 검증을 통과하지 못했습니다.";
    }
  } catch (error) {
    console.warn(
      "[mlx-reply-adapter] failed to rewrite reply:",
      error instanceof Error ? error.message : String(error),
    );
    failureDebugEntries.push({
      stage: "reply_rewrite",
      kind: "request_error",
      summary:
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "최종 reply rewrite 요청이 실패했습니다.",
      sourceRef: replyRewriteSource ?? "final_reply",
    });
    recordInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      "reply_rewrite_request",
      "final reply rewrite 요청",
      "failed",
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "최종 reply rewrite 요청이 실패했습니다.",
      replyRewriteSource ?? "final_reply",
    );
  }
  llmResult = {
    ...llmResult,
    reply: {
      text: sanitizeReplyText(llmResult.reply.text),
      rewriteSource: replyRewriteSource,
      rewriteReason: replyRewriteReason,
    },
  };
  const shadowWaitTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "shadow_compare_wait",
    "shadow compare 대기",
  );
  const shadowComparison = await shadowComparisonPromise;
  const sanitizedShadowComparison =
    shadowComparison?.result
      ? {
          ...shadowComparison,
          result: {
            ...shadowComparison.result,
            reply: {
              text: sanitizeReplyText(shadowComparison.result.reply.text),
            },
          },
        }
      : shadowComparison;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    shadowWaitTrace,
    shadowComparison ? "ok" : "skipped",
    shadowComparison
      ? `status=${shadowComparison.status}, duration=${shadowComparison.durationMs ?? 0}ms`
      : "shadow compare가 비활성화되어 있습니다.",
    shadowComparison?.sourceRef ?? null,
  );
  const structuredTargetNpcId = isPersistedNpcId(
    llmResult.structuredImpact.targetNpcId,
    worldState.npcs,
  )
    ? llmResult.structuredImpact.targetNpcId
    : null;
  const effectiveTargetNpcId = request.targetNpcId ?? structuredTargetNpcId;

  const { npc: nextNpc, relationshipDelta } = nextSpeakerState({
    npc,
    action: request.action,
    structuredImpact: llmResult.structuredImpact,
  });
  persistNpc(nextNpc, worldState.npcs);

  const pressureTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "pressure_update",
    "압력도 반영",
  );
  const pressureUpdate = applyInteractionPressure({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
    targetNpcId: effectiveTargetNpcId,
    action: request.action,
    structuredImpact: llmResult.structuredImpact,
    round: worldState.round,
  });
  worldState.judgements = pressureUpdate.judgements;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    pressureTrace,
    "ok",
    `changes=${pressureUpdate.pressureChanges.length}`,
  );

  const roundTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "round_progress",
    "라운드 진행",
  );
  const roundProgress = progressRound(worldState.round);
  worldState.round = roundProgress.round;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    roundTrace,
    "ok",
    `round=${roundBefore}->${worldState.round.currentRound}`,
  );

  const roundEventEntry = roundProgress.roundEvent
    ? composeRoundEventLogEntry(roundProgress.roundEvent)
    : null;
  const autonomyTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "autonomy_phase",
    "NPC 자율 턴",
  );
  const autonomyPhase = simulateNpcAutonomyPhase({
    worldState,
    requestNpcId: request.npcId,
    recentEvents: [
      ...(roundEventEntry ? [roundEventEntry] : []),
      ...worldState.events.slice(0, 4),
    ],
  });
  const consensusBoard = buildConsensusBoard({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
  });
  const resolution = resolveIfNeeded({
    round: worldState.round,
    consensusBoard,
  });
  worldState.resolution = resolution;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    autonomyTrace,
    "ok",
    `executed=${autonomyPhase.phase.executed}, steps=${autonomyPhase.phase.steps.length}, resolved=${resolution.resolved}`,
  );

  const turnEventBaseTime = Date.now();
  const timestamp = new Date(turnEventBaseTime).toISOString();
  const targetLabel = effectiveTargetNpcId
    ? boardTargetLabel(effectiveTargetNpcId, worldState.npcs)
    : null;

  const eventLogEntry = composeInteractionEventLogEntry({
    npcId: request.npcId,
    npcName: npc.persona.name,
    selectedActionLabel: NPC_ACTION_LABELS[llmResult.selectedAction.type],
    promptSummary: normalizedInput.promptSummary,
    targetLabel,
    pressureChanges: pressureUpdate.pressureChanges,
    resolution,
  });
  eventLogEntry.timestamp = timestamp;

  if (roundEventEntry) {
    roundEventEntry.timestamp = new Date(turnEventBaseTime + 1).toISOString();
  }

  autonomyPhase.eventEntries.forEach((entry, index) => {
    entry.timestamp = new Date(turnEventBaseTime + 2 + index).toISOString();
  });

  if (eventLogEntry) {
    worldState.events.unshift(eventLogEntry);
  }
  if (roundEventEntry) {
    worldState.events.unshift(roundEventEntry);
  }
  for (const entry of autonomyPhase.eventEntries) {
    worldState.events.unshift(entry);
  }

  const memoryTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "memory_update",
    "메모리 갱신",
  );
  const nextMemories = updateMemoryBank(
    memoryFile.memories[request.npcId] ?? [],
    buildMemoryEntries({
      npcName: npc.persona.name,
      normalizedInput,
      llmResult,
      relationshipDelta,
      pressureChanges: pressureUpdate.pressureChanges,
      resolution,
      existing: memoryFile.memories[request.npcId] ?? [],
    }),
  );
  memoryFile.memories[request.npcId] = nextMemories;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    memoryTrace,
    "ok",
    `memoryCount=${nextMemories.length}`,
  );

  const leadingCandidate = consensusBoard[0] ?? null;

  const inspector: InspectorPayload = {
    timestamp,
    episodeId: worldState.episodeId,
    npcId: request.npcId,
    targetNpcId: effectiveTargetNpcId,
    replyText: llmResult.reply.text,
    fallbackUsed,
    replyRewriteSource,
    replyRewriteReason,
    failureDebug: failureDebugEntries.length > 0 ? failureDebugEntries : null,
    interactionTrace:
      interactionTraceEntries.length > 0 ? interactionTraceEntries : null,
    retrievedMemories,
    retrievedKnowledge,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction,
    selectedActionReason: llmResult.selectedAction.reason,
    structuredImpact: llmResult.structuredImpact,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    leaderBefore,
    leaderAfter: leadingCandidate,
    leadingCandidateId: leadingCandidate?.candidateId ?? null,
    leadingCandidateLabel: leadingCandidate?.candidateLabel ?? null,
    round: worldState.round.currentRound,
    resolution,
    llmPromptContextSummary: promptContextSummary,
    datasetExportedAt: worldState.datasetExportedAt,
    exportPaths: worldState.exportPaths,
    shadowComparison: sanitizedShadowComparison,
    autonomyPhase: autonomyPhase.phase,
  };
  worldState.lastInspector = inspector;

  const logEntry: InteractionLogEntry = {
    id: crypto.randomUUID(),
    npcId: request.npcId,
    targetNpcId: effectiveTargetNpcId,
    playerId: request.playerId,
    inputMode: request.inputMode,
    fallbackUsed,
    replyRewriteSource,
    replyRewriteReason,
    failureDebug: failureDebugEntries.length > 0 ? failureDebugEntries : null,
    interactionTrace:
      interactionTraceEntries.length > 0 ? interactionTraceEntries : null,
    roundBefore,
    roundAfter: worldState.round.currentRound,
    playerText: formatPlayerConversationText({
      text: normalizedInput.text,
      action: request.action,
      targetLabel,
    }),
    rawPlayerText: request.text,
    normalizedInputSummary: normalizedInput.promptSummary,
    playerAction: request.action,
    replyText: llmResult.reply.text,
    timestamp,
    retrievedMemories,
    retrievedKnowledge,
    llmPromptContextSummary: promptContextSummary,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction.type,
    selectedActionReason: llmResult.selectedAction.reason,
    structuredImpact: llmResult.structuredImpact,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    leaderBefore,
    leaderAfter: leadingCandidate,
    resolutionAfter: resolution,
    round: worldState.round.currentRound,
    shadowComparison: sanitizedShadowComparison,
    autonomyPhase: autonomyPhase.phase,
  };
  const logCommitTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "log_commit",
    "턴 로그 적재",
  );
  interactionLog.entries.push(logEntry);
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    logCommitTrace,
    "ok",
    "inspector와 interaction log에 기록했습니다.",
  );

  let committedExportPaths: EpisodeExportPaths | null = null;

  if (worldState.resolution.resolved && !worldState.datasetExportedAt) {
    const datasetExportTrace = startInteractionTraceStage(
      turnStartedAtMs,
      "dataset_export",
      "데이터셋 export",
    );
    const exportedAt = nowIso();
    worldState.endedAt = worldState.endedAt ?? exportedAt;
    committedExportPaths = await exportEpisodeDataset({
      worldState,
      memoryFile,
      interactionLog,
      exportedAt,
    });
    worldState.exportPaths = committedExportPaths;
    worldState.datasetExportedAt = exportedAt;
    inspector.datasetExportedAt = exportedAt;
    inspector.exportPaths = committedExportPaths;
    worldState.lastInspector = inspector;
    finishInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      datasetExportTrace,
      "ok",
      "resolved episode dataset을 export했습니다.",
    );
  } else {
    recordInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      "dataset_export",
      "데이터셋 export",
      "skipped",
      "결말 확정 전이라 export를 건너뛰었습니다.",
    );
  }

  const turnFinishedAtMs = Date.now();
  interactionTraceEntries.push({
    stage: "turn_total",
    label: "전체 턴 처리",
    status: "ok",
    startedAtMs: 0,
    finishedAtMs: Math.max(0, turnFinishedAtMs - turnStartedAtMs),
    durationMs: Math.max(0, turnFinishedAtMs - turnStartedAtMs),
    detail: `total=${turnFinishedAtMs - turnStartedAtMs}ms`,
    sourceRef: null,
  });
  inspector.interactionTrace = interactionTraceEntries.length > 0 ? interactionTraceEntries : null;
  logEntry.interactionTrace = interactionTraceEntries.length > 0 ? interactionTraceEntries : null;

  return {
    nextBundle: {
      worldState,
      memoryFile,
      interactionLog,
    },
    cleanupExportPaths: committedExportPaths,
    reply: {
      ...llmResult.reply,
      rewriteSource: replyRewriteSource,
      rewriteReason: replyRewriteReason,
    },
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    eventLogEntry,
    inspector,
    resolution,
  };
}

export async function interactWithNpc(
  request: InteractionRequestPayload,
  repositoryOptions: WorldRepositoryOptions = {},
): Promise<InteractionResponsePayload> {
  const repository = createWorldRepository(repositoryOptions);
  return repository.withLockedState(async (bundle) => {
    const turn = await runInteractionTurn(bundle, request);
    const pathsToCleanup = turn.cleanupExportPaths;
    const world = buildWorldSnapshot({
      worldState: turn.nextBundle.worldState,
      memories: turn.nextBundle.memoryFile.memories,
      interactionLog: turn.nextBundle.interactionLog.entries,
      runtime: buildRuntimeStatus(),
    });

    return {
      nextBundle: turn.nextBundle,
      onSaveFailure: pathsToCleanup
        ? async () => {
            await cleanupExportPaths(pathsToCleanup);
          }
        : undefined,
      result: {
        reply: turn.reply,
        relationshipDelta: turn.relationshipDelta,
        pressureChanges: turn.pressureChanges,
        eventLogEntry: turn.eventLogEntry,
        inspector: turn.inspector,
        resolution: turn.resolution,
        world,
      },
    };
  });
}
