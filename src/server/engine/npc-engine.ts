import { NPC_ACTION_LABELS } from "@/lib/constants";
import type {
  InspectorPayload,
  InteractionLogEntry,
  InteractionRequestPayload,
  InteractionResponsePayload,
  NpcState,
  PersistedNpcState,
  RelationshipDelta,
} from "@/lib/types";
import { actionLabel } from "@/lib/utils";
import { normalizeLlmInteractionResult } from "@/server/engine/action-selection";
import { normalizeInteractionInput } from "@/server/engine/intent";
import {
  buildMemoryEntries,
  retrieveRelevantMemories,
  updateMemoryBank,
} from "@/server/engine/memory";
import {
  applyRelationshipDelta,
  applyRippleEffects,
  calculateRelationshipDelta,
  deriveRippleEffects,
} from "@/server/engine/relationship";
import { applyQuestUpdates } from "@/server/engine/quest-engine";
import {
  buildWorldSnapshot,
  composeEventLogEntry,
} from "@/server/engine/world-state";
import { getLlmProvider } from "@/server/providers/llm-provider";
import { createWorldRepository } from "@/server/store/repositories";

function evolveNpcState(npc: NpcState, delta: import("@/lib/types").RelationshipDelta) {
  return {
    ...npc,
    goals: {
      ...npc.goals,
      opennessToPlayer: Math.max(
        0,
        Math.min(100, npc.goals.opennessToPlayer + delta.trust + delta.affinity - delta.tension),
      ),
      currentNeed:
        delta.trust + delta.affinity > 1
          ? "플레이어가 약속을 실제 단서로 연결할 수 있는지 본다."
          : delta.tension > 1
            ? "리스크를 낮출 거리를 확보한다."
            : npc.goals.currentNeed,
    },
  };
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

  const normalizedInput = normalizeInteractionInput({
    text: request.text,
    action: request.action,
    inputMode: request.inputMode,
  });
  const recentConversation = interactionLog.entries
    .filter((entry) => entry.npcId === request.npcId)
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
  const retrievedMemories = retrieveRelevantMemories(npc.memories, normalizedInput);
  const relatedQuests = worldState.quests.filter(
    (quest) => quest.giverNpcId === request.npcId || quest.status !== "locked",
  );
  const recentEvents = worldState.events.slice(0, 3);

  const provider = getLlmProvider();
  const llmResult = normalizeLlmInteractionResult(
    await provider.generateInteraction({
      request,
      world: worldState.world,
      npc,
      relatedQuests,
      recentEvents,
      recentConversation,
      retrievedMemories,
      normalizedInput,
    }),
  );

  const relationshipDelta: RelationshipDelta = calculateRelationshipDelta({
    normalizedInput,
    selectedAction: llmResult.selectedAction,
  });

  const nextNpc = evolveNpcState(
    {
      ...npc,
      emotion: llmResult.emotion,
      relationship: applyRelationshipDelta(npc.relationship, relationshipDelta),
    },
    relationshipDelta,
  );
  const persistedNextNpc: PersistedNpcState = {
    persona: nextNpc.persona,
    emotion: nextNpc.emotion,
    relationship: nextNpc.relationship,
    goals: nextNpc.goals,
    currentLocation: nextNpc.currentLocation,
    statusLine: nextNpc.statusLine,
  };
  worldState.npcs[npcIndex] = persistedNextNpc;

  const questUpdates = applyQuestUpdates({
    npcId: request.npcId,
    quests: worldState.quests,
    normalizedInput,
    selectedAction: llmResult.selectedAction,
    relationship: nextNpc.relationship,
  });

  const rippleEffects = deriveRippleEffects({
    npcs: worldState.npcs,
    sourceNpcId: request.npcId,
    normalizedInput,
    selectedAction: llmResult.selectedAction,
  });
  applyRippleEffects(worldState.npcs, rippleEffects);
  relationshipDelta.rippleEffects = rippleEffects;

  const nextMemories = updateMemoryBank(
    memoryFile.memories[request.npcId] ?? [],
    buildMemoryEntries({
      npcName: npc.persona.name,
      normalizedInput,
      llmResult,
      relationshipDelta,
      questUpdates,
      existing: memoryFile.memories[request.npcId] ?? [],
    }),
  );
  memoryFile.memories[request.npcId] = nextMemories;

  const eventLogEntry = composeEventLogEntry({
    npcId: request.npcId,
    npcName: npc.persona.name,
    selectedActionLabel: NPC_ACTION_LABELS[llmResult.selectedAction.type],
    promptSummary: normalizedInput.promptSummary,
    questUpdates,
    rippleNotes: rippleEffects.map((effect) => effect.note),
  });
  worldState.events.unshift(eventLogEntry);

  const inspector: InspectorPayload = {
    timestamp: eventLogEntry.timestamp,
    npcId: request.npcId,
    retrievedMemories,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction,
    selectedActionReason: llmResult.selectedAction.reason,
    relationshipDelta,
    questUpdates,
  };
  worldState.lastInspector = inspector;

  const logEntry: InteractionLogEntry = {
    id: crypto.randomUUID(),
    npcId: request.npcId,
    playerId: request.playerId,
    inputMode: request.inputMode,
    playerText: normalizedInput.text || actionLabel(request.action),
    playerAction: request.action,
    replyText: llmResult.reply.text,
    timestamp: eventLogEntry.timestamp,
    selectedAction: llmResult.selectedAction.type,
    relationshipDelta,
    questUpdates,
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
    questUpdates,
    eventLogEntry,
    inspector,
    world,
  };
}
