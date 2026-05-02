import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
} from "@backend-support/constants";
import type {
  ConsensusBoardEntry,
  EventLogEntry,
} from "@backend-contracts/api";
import type { PersistedNpcState } from "@backend-domain";

export function uniqueRecentTags(events: EventLogEntry[]) {
  return Array.from(
    new Set(events.flatMap((event) => event.tags).filter(Boolean)),
  );
}

export function npcOnlyBoard(board: ConsensusBoardEntry[], npcs: PersistedNpcState[]) {
  const npcIds = new Set(npcs.map((npc) => npc.persona.id));
  return board.filter((entry) => npcIds.has(entry.candidateId));
}

export function boardRankWeight(index: number) {
  if (index <= 0) {
    return 1.45;
  }

  if (index === 1) {
    return 1.22;
  }

  return 1.05;
}

function boundedOpinion(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function targetCandidateIds(params: {
  input: { npcs: PersistedNpcState[] };
  actorNpcId: string;
  excludedCandidateId?: string | null;
}) {
  return [
    DEFAULT_PLAYER_ID,
    ...params.input.npcs.map((npc) => npc.persona.id),
  ].filter(
    (candidateId) =>
      candidateId !== params.actorNpcId &&
      candidateId !== params.excludedCandidateId,
  );
}

export function evaluatorOpinion(actor: PersistedNpcState, targetNpcId: string) {
  if (targetNpcId === DEFAULT_PLAYER_ID) {
    return boundedOpinion(
      (
        actor.relationship.playerTrust +
        actor.relationship.playerAffinity +
        (100 - actor.relationship.playerTension)
      ) / 3,
    );
  }

  return actor.relationship.npcOpinions[targetNpcId] ?? 30;
}

export function playerLabelAwareNames(npcs: PersistedNpcState[]) {
  return {
    [DEFAULT_PLAYER_ID]: DEFAULT_PLAYER_LABEL,
    ...Object.fromEntries(npcs.map((npc) => [npc.persona.id, npc.persona.name])),
  };
}

export function playerTargetPressureScale(board: ConsensusBoardEntry[]) {
  const playerIndex = board.findIndex(
    (entry) => entry.candidateId === DEFAULT_PLAYER_ID,
  );

  if (playerIndex <= 0) {
    return 0.58;
  }

  if (playerIndex === 1) {
    return 0.86;
  }

  return 1.16;
}
