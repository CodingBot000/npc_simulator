import {
  DEFAULT_PLAYER_ID,
  NPC_ACTION_LABELS,
} from "@backend-support/constants";
import type {
  EpisodeExportPaths,
  InteractionTraceEntry,
  InspectorPayload,
  NpcState,
  InteractionRequestPayload,
  InteractionResponsePayload,
} from "@backend-contracts/api";
import type {
  InteractionLogEntry,
} from "@backend-persistence";
import { formatPlayerConversationText, nowIso } from "@backend-support/utils";
import { simulateNpcAutonomyPhase } from "@server/engine/npc-autonomy";
import {
  buildInteractionContract,
} from "@server/engine/interaction-contract";
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
import {
  buildPromptContextSummary,
  isPersistedNpcId,
  persistNpc,
  recentConversationForNpc,
} from "@server/engine/interaction-context";
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
import { retrieveEvidenceBundle } from "@server/engine/retrieval";
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
