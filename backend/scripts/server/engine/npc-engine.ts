import type {
  EpisodeExportPaths,
  InteractionTraceEntry,
  InteractionRequestPayload,
  InteractionResponsePayload,
} from "@backend-contracts/api";
import { cleanupExportPaths } from "@server/engine/dataset-export";
import {
  generateValidatedInteraction,
  judgeInteractionReplyWithTrace,
  resolveShadowComparisonWithTrace,
  rewriteFinalReplyWithTrace,
} from "@server/engine/interaction-ai-flow";
import { isPersistedNpcId } from "@server/engine/interaction-context";
import { prepareInteractionTurnContext } from "@server/engine/interaction-turn/context";
import { commitResolvedEpisodeExport } from "@server/engine/interaction-turn/export";
import { buildRecentPlayerMoveHistory } from "@server/engine/interaction-turn/player-move-history";
import { commitInteractionTurnRecords } from "@server/engine/interaction-turn/records";
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
    leaderBefore,
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
  const recentPlayerMoves = buildRecentPlayerMoveHistory(interactionLog.entries);

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
    recentPlayerMoves,
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

  const { inspector, logEntry } = commitInteractionTurnRecords({
    worldState,
    interactionLog,
    request,
    npc,
    normalizedInput,
    llmResult,
    fallbackUsed,
    replyRewriteSource,
    replyRewriteReason,
    replyJudge,
    failureDebugEntries,
    interactionTraceEntries,
    retrievedMemories,
    retrievedKnowledge,
    timestamp,
    effectiveTargetNpcId,
    targetLabel,
    relationshipDelta,
    pressureChanges,
    leaderBefore,
    leadingCandidate,
    resolution,
    promptContextSummary,
    sanitizedShadowComparison,
    autonomyPhase,
    roundBefore,
    turnStartedAtMs,
  });

  const committedExportPaths = await commitResolvedEpisodeExport({
    worldState,
    memoryFile,
    interactionLog,
    inspector,
    turnStartedAtMs,
    interactionTraceEntries,
  });

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
  inspector.interactionTrace =
    interactionTraceEntries.length > 0 ? interactionTraceEntries : null;
  logEntry.interactionTrace =
    interactionTraceEntries.length > 0 ? interactionTraceEntries : null;

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
