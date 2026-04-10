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
import { normalizeInteractionInput } from "@/server/engine/intent";
import {
  buildMemoryEntries,
  retrieveRelevantMemories,
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
import { getLlmProvider } from "@/server/providers/llm-provider";
import { createWorldRepository } from "@/server/store/repositories";

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

export async function interactWithNpc(
  request: InteractionRequestPayload,
): Promise<InteractionResponsePayload> {
  const repository = createWorldRepository();
  await repository.ensureSeedData();

  const [worldState, memoryFile, interactionLog] = await Promise.all([
    repository.readWorldState(),
    repository.readMemoryFile(),
    repository.readInteractionLog(),
  ]);

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
      ? worldState.npcs.find((candidate) => candidate.persona.id === request.targetNpcId) ?? null
      : null;

  const normalizedInput = normalizeInteractionInput({
    text: request.text,
    action: request.action,
    inputMode: request.inputMode,
  });
  const recentConversation = recentConversationForNpc(interactionLog.entries, request.npcId);
  const retrievedMemories = retrieveRelevantMemories(npc.memories, normalizedInput);
  const consensusBoardBefore = buildConsensusBoard({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
  });
  const recentEvents = worldState.events.slice(0, 4);

  const provider = getLlmProvider();
  const llmResult = normalizeLlmInteractionResult(
    await provider.generateInteraction({
      request,
      world: worldState.world,
      npc,
      targetNpc,
      round: worldState.round,
      consensusBoard: consensusBoardBefore,
      recentEvents,
      recentConversation,
      retrievedMemories,
      normalizedInput,
    }),
  );

  const { npc: nextNpc, relationshipDelta } = nextSpeakerState({
    npc,
    action: request.action,
  });
  persistNpc(nextNpc, worldState.npcs);

  const pressureUpdate = applyInteractionPressure({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
    targetNpcId: request.targetNpcId,
    action: request.action,
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
  const targetLabel = request.targetNpcId
    ? boardTargetLabel(request.targetNpcId, worldState.npcs)
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
    npcId: request.npcId,
    targetNpcId: request.targetNpcId,
    retrievedMemories,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction,
    selectedActionReason: llmResult.selectedAction.reason,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    leadingCandidateId: leadingCandidate?.candidateId ?? null,
    leadingCandidateLabel: leadingCandidate?.candidateLabel ?? null,
    round: worldState.round.currentRound,
    resolution,
  };
  worldState.lastInspector = inspector;

  const logEntry: InteractionLogEntry = {
    id: crypto.randomUUID(),
    npcId: request.npcId,
    targetNpcId: request.targetNpcId,
    playerId: request.playerId,
    inputMode: request.inputMode,
    playerText:
      normalizedInput.text ||
      (request.targetNpcId
        ? `${actionLabel(request.action)}: ${targetLabel ?? DEFAULT_PLAYER_LABEL}`
        : actionLabel(request.action)),
    playerAction: request.action,
    replyText: llmResult.reply.text,
    timestamp,
    selectedAction: llmResult.selectedAction.type,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    round: worldState.round.currentRound,
  };
  interactionLog.entries.push(logEntry);

  await Promise.all([
    repository.saveWorldState(worldState),
    repository.saveMemoryFile(memoryFile),
    repository.saveInteractionLog(interactionLog),
  ]);

  const runtime = await provider.getStatus();
  const world = buildWorldSnapshot({
    worldState,
    memories: memoryFile.memories,
    interactionLog: interactionLog.entries,
    runtime,
  });

  return {
    reply: llmResult.reply,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    eventLogEntry,
    inspector,
    resolution,
    world,
  };
}
