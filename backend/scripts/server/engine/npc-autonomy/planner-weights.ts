import type {
  ConsensusBoardEntry,
  EventLogEntry,
} from "@backend-contracts/api";
import type { PersistedNpcState } from "@backend-domain";
import type { AutonomyMoveType } from "@sim-shared/types";
import { AUTONOMY_STEP_RULES } from "@server/engine/npc-autonomy/config";
import {
  npcOnlyBoard,
  uniqueRecentTags,
} from "@server/engine/npc-autonomy/planner-common";
import type { AutonomyPlannerInput } from "@server/engine/npc-autonomy/types";

export function recentToneWeight(events: EventLogEntry[]) {
  if (events.some((event) => event.tone === "danger")) {
    return AUTONOMY_STEP_RULES.dangerToneBonus;
  }

  if (events.some((event) => event.tone === "warning")) {
    return AUTONOMY_STEP_RULES.dangerToneBonus * 0.66;
  }

  return 0;
}

export function matchingEventBiases(input: AutonomyPlannerInput) {
  const tags = new Set(uniqueRecentTags(input.recentEvents));
  return input.autonomy.eventBiases.filter((bias) => tags.has(bias.tag));
}

export function actorWeight(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
}) {
  const { actor, input, board, eventBiases } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const localBoard = npcOnlyBoard(board, input.npcs);
  const actorBoardIndex = localBoard.findIndex(
    (entry) => entry.candidateId === actor.persona.id,
  );
  const leader = localBoard[0] ?? null;
  let weight = actorBias?.actorWeight ?? 1;

  weight *= 0.62 + actor.emotion.intensity / 100;

  if (actorBoardIndex >= 0 && actorBoardIndex <= 1) {
    weight *= 1.12;
  }

  if (leader && actor.decision.initialTargets.includes(leader.candidateId)) {
    weight *= 1.16;
  }

  if (leader && actorBias?.preferredTargets?.includes(leader.candidateId)) {
    weight *= 1.12;
  }

  if (leader && actorBias?.protectedTargets?.includes(leader.candidateId)) {
    weight *= 0.84;
  }

  const recentTags = uniqueRecentTags(input.recentEvents);
  const affinityMatches =
    actorBias?.eventTagAffinity?.filter((tag) => recentTags.includes(tag)).length ?? 0;

  if (affinityMatches > 0) {
    weight *= 1 + affinityMatches * 0.08;
  }

  for (const bias of eventBiases) {
    weight *= bias.actorWeights?.[actor.persona.id] ?? 1;
  }

  return weight;
}

export function moveWeights(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
}) {
  const { actor, input, board, eventBiases } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ownPressureRank = npcOnlyBoard(board, input.npcs).findIndex(
    (entry) => entry.candidateId === actor.persona.id,
  );
  const recentTags = uniqueRecentTags(input.recentEvents);
  const weights = {
    ...input.autonomy.moveWeights,
  };

  for (const move of Object.keys(weights) as AutonomyMoveType[]) {
    weights[move] *= actorBias?.moveWeights?.[move] ?? 1;
  }

  for (const bias of eventBiases) {
    for (const move of Object.keys(weights) as AutonomyMoveType[]) {
      weights[move] *= bias.moveWeights?.[move] ?? 1;
    }
  }

  if (ownPressureRank >= 0 && ownPressureRank <= 1) {
    weights.redirect *= 1.28;
    weights.freeze *= 0.88;
  }

  if (recentTags.includes("delay") || recentTags.includes("pressure")) {
    weights.pile_on *= 1.12;
  }

  if (actor.emotion.intensity < 40) {
    weights.freeze *= 1.22;
    weights.pile_on *= 0.82;
  }

  return weights;
}
