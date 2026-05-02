import type {
  EpisodeExportPaths,
  InteractionTraceEntry,
  InspectorPayload,
  InteractionRequestPayload,
  InteractionResponsePayload,
} from "@backend-contracts/api";
import type {
  InteractionLogEntry,
} from "@backend-persistence";
import { formatPlayerConversationText, nowIso } from "@backend-support/utils";
import {
  cleanupExportPaths,
  exportEpisodeDataset,
} from "@server/engine/dataset-export";
import {
  generateValidatedInteraction,
  judgeInteractionReplyWithTrace,
  resolveShadowComparisonWithTrace,
  rewriteFinalReplyWithTrace,
} from "@server/engine/interaction-ai-flow";
import { isPersistedNpcId } from "@server/engine/interaction-context";
import { prepareInteractionTurnContext } from "@server/engine/interaction-turn/context";
import { applyInteractionTurnStateTransition } from "@server/engine/interaction-turn/state";
import {
  buildMemoryEntries,
  updateMemoryBank,
} from "@server/engine/memory";
import { buildWorldSnapshot } from "@server/engine/world-state";
import { buildRuntimeStatus, getLlmProvider } from "@server/providers/llm-provider";
import { maybeGenerateShadowComparison } from "@server/providers/shadow-compare";
import {
  finishInteractionTraceStage,
  recordInteractionTraceStage,
  startInteractionTraceStage,
} from "@server/engine/interaction-trace";
import { createWorldRepository } from "@server/store/repositories";
import type { WorldRepositoryOptions } from "@server/store/repositories";
import type { WorldStateBundle } from "@server/store/world-bundle";

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
  const turnStartedAtMs = Date.now();
  const interactionTraceEntries: InteractionTraceEntry[] = [];

  const prepareContextTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "prepare_context",
    "입력 정리·컨텍스트 수집",
  );
  const turnContext = prepareInteractionTurnContext(bundle, request);
  const {
    worldState,
    memoryFile,
    interactionLog,
    npc,
    normalizedInput,
    recentConversation,
    consensusBoardBefore,
    leaderBefore,
    recentEvents,
    retrievedMemories,
    retrievedKnowledge,
    roundBefore,
    promptContextSummary,
    generationInput,
    interactionContract,
  } = turnContext;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    prepareContextTrace,
    "ok",
    `memory=${retrievedMemories.length}, evidence=${retrievedKnowledge.length}, recentConversation=${recentConversation.length}`,
  );

  const provider = getLlmProvider();
  const shadowComparisonPromise = maybeGenerateShadowComparison(generationInput);
  let {
    llmResult,
    fallbackUsed,
    failureDebugEntries,
  } = await generateValidatedInteraction({
    provider,
    generationInput,
    interactionContract,
    npcName: npc.persona.name,
    turnStartedAtMs,
    interactionTraceEntries,
  });
  const replyRewrite = await rewriteFinalReplyWithTrace({
    generationInput,
    llmResult,
    turnStartedAtMs,
    interactionTraceEntries,
    failureDebugEntries,
  });
  llmResult = replyRewrite.llmResult;
  const replyRewriteSource = replyRewrite.replyRewriteSource;
  const replyRewriteReason = replyRewrite.replyRewriteReason;
  const replyJudge = await judgeInteractionReplyWithTrace({
    interactionContract,
    replyText: llmResult.reply.text,
    turnStartedAtMs,
    interactionTraceEntries,
  });
  const sanitizedShadowComparison = await resolveShadowComparisonWithTrace({
    shadowComparisonPromise,
    turnStartedAtMs,
    interactionTraceEntries,
  });
  const structuredTargetNpcId = isPersistedNpcId(
    llmResult.structuredImpact.targetNpcId,
    worldState.npcs,
  )
    ? llmResult.structuredImpact.targetNpcId
    : null;
  const effectiveTargetNpcId = request.targetNpcId ?? structuredTargetNpcId;

  const {
    timestamp,
    targetLabel,
    relationshipDelta,
    pressureChanges,
    eventLogEntry,
    leadingCandidate,
    resolution,
    autonomyPhase,
  } = applyInteractionTurnStateTransition({
    worldState,
    request,
    npc,
    llmResult,
    effectiveTargetNpcId,
    normalizedInputSummary: normalizedInput.promptSummary,
    roundBefore,
    turnStartedAtMs,
    interactionTraceEntries,
  });

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
      pressureChanges,
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

  const inspector: InspectorPayload = {
    timestamp,
    episodeId: worldState.episodeId,
    npcId: request.npcId,
    targetNpcId: effectiveTargetNpcId,
    replyText: llmResult.reply.text,
    fallbackUsed,
    replyRewriteSource,
    replyRewriteReason,
    replyJudge,
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
    pressureChanges,
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
    replyJudge,
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
    pressureChanges,
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
    pressureChanges,
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
