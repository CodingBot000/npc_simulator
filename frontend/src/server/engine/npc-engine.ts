import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
  NPC_ACTION_LABELS,
} from "@/lib/constants";
import type {
  InspectorPayload,
  InteractionLogEntry,
  InteractionRequestPayload,
  InteractionResponsePayload,
  NpcState,
  PersistedNpcState,
} from "@/lib/types";
import { actionLabel, nowIso } from "@/lib/utils";
import { normalizeLlmInteractionResult } from "@/server/engine/action-selection";
import {
  cleanupExportPaths,
  exportEpisodeDataset,
} from "@/server/engine/dataset-export";
import { normalizeInteractionInput } from "@/server/engine/intent";
import {
  buildMemoryEntries,
  updateMemoryBank,
} from "@/server/engine/memory";
import {
  applyInteractionPressure,
  boardTargetLabel,
  buildConsensusBoard,
  nextSpeakerState,
  progressRound,
  resolveIfNeeded,
} from "@/server/engine/pressure-engine";
import {
  buildWorldSnapshot,
  composeInteractionEventLogEntry,
  composeRoundEventLogEntry,
} from "@/server/engine/world-state";
import { buildFallbackInteractionResult } from "@/server/engine/fallback-interaction";
import { maybeGenerateReplyWithLocalAdapter } from "@/server/providers/mlx-reply-adapter";
import { retrieveEvidenceBundle } from "@/server/engine/retrieval";
import { getLlmProvider } from "@/server/providers/llm-provider";
import { createWorldRepository } from "@/server/store/repositories";
import type { WorldRepositoryOptions } from "@/server/store/repositories";

const REPLY_LABEL_PREFIX = /^(?:\.\.\.|…|\s)*(?:의사|감독관|엔지니어|소장|doctor|supervisor|engineer|director)\s*:\s*/iu;
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
      },
      {
        id: `${entry.id}-npc`,
        npcId: entry.npcId,
        speaker: "npc" as const,
        text: entry.replyText,
        timestamp: entry.timestamp,
        action: entry.selectedAction,
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

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || original;
}

export async function interactWithNpc(
  request: InteractionRequestPayload,
  repositoryOptions: WorldRepositoryOptions = {},
): Promise<InteractionResponsePayload> {
  const repository = createWorldRepository(repositoryOptions);
  return repository.withLockedState(async ({ worldState, memoryFile, interactionLog }) => {
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

    const normalizedInput = normalizeInteractionInput({
      text: request.text,
      action: request.action,
      inputMode: request.inputMode,
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
    let llmResult;

    try {
      llmResult = normalizeLlmInteractionResult(
        await provider.generateInteraction(generationInput),
      );
    } catch (error) {
      console.warn(
        "[llm-provider] falling back to deterministic interaction:",
        error instanceof Error ? error.message : String(error),
      );
      llmResult = normalizeLlmInteractionResult(
        buildFallbackInteractionResult(generationInput),
      );
    }

    try {
      const rewrittenReply = await maybeGenerateReplyWithLocalAdapter(generationInput);
      if (rewrittenReply?.text) {
        llmResult = {
          ...llmResult,
          reply: {
            text: rewrittenReply.text,
          },
        };
      }
    } catch (error) {
      console.warn(
        "[mlx-reply-adapter] failed to rewrite reply:",
        error instanceof Error ? error.message : String(error),
      );
    }
    llmResult = {
      ...llmResult,
      reply: {
        text: sanitizeReplyText(llmResult.reply.text),
      },
    };
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

    const pressureUpdate = applyInteractionPressure({
      judgements: worldState.judgements,
      npcs: worldState.npcs,
      targetNpcId: effectiveTargetNpcId,
      action: request.action,
      structuredImpact: llmResult.structuredImpact,
      round: worldState.round,
    });
    worldState.judgements = pressureUpdate.judgements;

    const roundProgress = progressRound(worldState.round);
    worldState.round = roundProgress.round;

    const consensusBoard = pressureUpdate.consensusBoard;
    const resolution = resolveIfNeeded({
      round: worldState.round,
      consensusBoard,
    });
    worldState.resolution = resolution;

    const timestamp = nowIso();
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
    worldState.events.unshift(eventLogEntry);

    if (roundProgress.roundEvent) {
      const roundEventEntry = composeRoundEventLogEntry(roundProgress.roundEvent);
      worldState.events.unshift(roundEventEntry);
    }

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

    const leadingCandidate = consensusBoard[0] ?? null;

    const inspector: InspectorPayload = {
      timestamp,
      episodeId: worldState.episodeId,
      npcId: request.npcId,
      targetNpcId: effectiveTargetNpcId,
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
    };
    worldState.lastInspector = inspector;

    const logEntry: InteractionLogEntry = {
      id: crypto.randomUUID(),
      npcId: request.npcId,
      targetNpcId: effectiveTargetNpcId,
      playerId: request.playerId,
      inputMode: request.inputMode,
      roundBefore,
      roundAfter: worldState.round.currentRound,
      playerText:
        normalizedInput.text ||
        (effectiveTargetNpcId
          ? `${actionLabel(request.action)}: ${targetLabel ?? DEFAULT_PLAYER_LABEL}`
          : actionLabel(request.action)),
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
    };
    interactionLog.entries.push(logEntry);

    let committedExportPaths = null;

    if (worldState.resolution.resolved && !worldState.datasetExportedAt) {
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
    }

    const runtime = await provider.getStatus();
    const world = buildWorldSnapshot({
      worldState,
      memories: memoryFile.memories,
      interactionLog: interactionLog.entries,
      runtime,
    });

    return {
      nextBundle: {
        worldState,
        memoryFile,
        interactionLog,
      },
      onSaveFailure: committedExportPaths
        ? async () => {
            await cleanupExportPaths(committedExportPaths);
          }
        : undefined,
      result: {
        reply: llmResult.reply,
        relationshipDelta,
        pressureChanges: pressureUpdate.pressureChanges,
        eventLogEntry,
        inspector,
        resolution,
        world,
      },
    };
  });
}
