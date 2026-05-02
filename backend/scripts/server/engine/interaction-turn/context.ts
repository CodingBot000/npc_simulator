import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import type { NpcState } from "@backend-contracts/api";
import { buildInteractionContract } from "@server/engine/interaction-contract";
import {
  buildPromptContextSummary,
  recentConversationForNpc,
} from "@server/engine/interaction-context";
import { normalizeInteractionInput } from "@server/engine/intent";
import {
  boardTargetLabel,
  buildConsensusBoard,
} from "@server/engine/pressure-engine";
import { retrieveEvidenceBundle } from "@server/engine/retrieval";
import type { WorldStateBundle } from "@server/store/world-bundle";
import type { InteractionTurnContext } from "@server/engine/interaction-turn/types";
import type { InteractionRequestPayload } from "@backend-contracts/api";

export function prepareInteractionTurnContext(
  bundle: WorldStateBundle,
  request: InteractionRequestPayload,
): InteractionTurnContext {
  const { worldState, memoryFile, interactionLog } = bundle;

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
  const targetCandidates = worldState.npcs.map((candidate) => ({
    id: candidate.persona.id,
    label: candidate.persona.name,
  }));
  const normalizedInput = normalizeInteractionInput({
    text: request.text,
    action: request.action,
    inputMode: request.inputMode,
    targetNpcId: request.targetNpcId,
    targetNpcLabel: targetNpc?.persona.name ?? null,
    targetCandidates,
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
    targetCandidates,
  });

  return {
    worldState,
    memoryFile,
    interactionLog,
    npc,
    targetNpc,
    normalizedInput,
    recentConversation,
    consensusBoardBefore,
    leaderBefore,
    recentEvents,
    retrievedMemories,
    retrievedKnowledge,
    roundBefore,
    initialTargetLabel,
    promptContextSummary,
    generationInput,
    interactionContract,
  };
}
