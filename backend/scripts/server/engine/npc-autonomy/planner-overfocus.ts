import {
  DEFAULT_PLAYER_ID,
} from "@backend-support/constants";
import type { ConsensusBoardEntry } from "@backend-contracts/api";
import type { ScenarioAutonomyEventBias } from "@server/scenario/types";
import { getAutonomyRoundVolatilityScale } from "@server/engine/npc-autonomy/config";
import {
  npcOnlyBoard,
  playerLabelAwareNames,
} from "@server/engine/npc-autonomy/planner-common";
import {
  DEFAULT_PLAYER_SUSPICION_CONTEXT,
} from "@server/engine/npc-autonomy/player-suspicion";
import type {
  AutonomyPlannerInput,
  AutonomyPlannedStep,
} from "@server/engine/npc-autonomy/types";

const OVERFOCUS_REDIRECT_PRESSURE_MIN = 135;
const OVERFOCUS_REDIRECT_GAP = 36;
const OVERFOCUS_REDIRECT_TOP_VOTES = 2;

export function planOverfocusRedirect(params: {
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ScenarioAutonomyEventBias[];
}): AutonomyPlannedStep | null {
  const npcBoard = npcOnlyBoard(params.board, params.input.npcs);
  const leader = npcBoard[0] ?? null;
  const runnerUp = npcBoard[1] ?? null;

  if (!leader || !runnerUp) {
    return null;
  }

  const leadGap = leader.totalPressure - runnerUp.totalPressure;
  const isOverfocused =
    leader.totalPressure >= OVERFOCUS_REDIRECT_PRESSURE_MIN &&
    (
      leadGap >= OVERFOCUS_REDIRECT_GAP ||
      (leader.topVotes >= OVERFOCUS_REDIRECT_TOP_VOTES && leadGap >= OVERFOCUS_REDIRECT_GAP / 2)
    );

  if (!isOverfocused) {
    return null;
  }

  // Let the just-addressed NPC self-deflect once, but do not reuse an actor twice
  // within the same autonomy phase.
  if (
    params.input.excludedActorNpcIds.length > 1 &&
    params.input.excludedActorNpcIds.includes(leader.candidateId)
  ) {
    return null;
  }

  const actor = params.input.npcs.find(
    (npc) => npc.persona.id === leader.candidateId,
  );

  if (!actor) {
    return null;
  }

  const target = pickOverfocusRedirectTarget({
    actor,
    board: params.board,
    leaderCandidateId: leader.candidateId,
    input: params.input,
    eventBiases: params.eventBiases,
  });

  if (!target) {
    return null;
  }

  const labels = playerLabelAwareNames(params.input.npcs);
  const targetLabel = labels[target.candidateId] ?? target.candidateId;
  const leaderLabel = labels[leader.candidateId] ?? leader.candidateId;

  const suspicion = params.input.playerSuspicion ?? DEFAULT_PLAYER_SUSPICION_CONTEXT;
  const playerReason =
    target.candidateId === DEFAULT_PLAYER_ID &&
    suspicion.reasons.length > 0
      ? ` ${suspicion.reasons[0]}`
      : "";

  return {
    actorNpcId: actor.persona.id,
    moveType: "redirect",
    targetNpcId: target.candidateId,
    secondaryTargetNpcId: leader.candidateId,
    rationale:
      target.candidateId === DEFAULT_PLAYER_ID
        ? `${leaderLabel}은(는) 자신에게 굳어지는 책임선을 피하며, 판을 움직이는 ${targetLabel} 쪽으로 시선을 되돌린다.${playerReason}`
        : `${leaderLabel}은(는) 자신에게 굳어지는 책임선을 피하려고 가장 안전해 보이는 ${targetLabel} 쪽으로 시선을 밀어낸다.`,
    tone: "warning",
    volatilityScale: getAutonomyRoundVolatilityScale(
      params.input.autonomy,
      params.input.round.currentRound,
    ),
    targetDeltaScale:
      target.candidateId === DEFAULT_PLAYER_ID ? suspicion.deltaScale : 1,
    secondaryTargetDeltaScale: 1.2,
    boardBefore: params.board,
  };
}

function pressureAppeal(params: {
  entry: ConsensusBoardEntry;
  candidates: ConsensusBoardEntry[];
}) {
  const pressures = params.candidates.map((entry) => entry.totalPressure);
  const highest = Math.max(...pressures);
  const lowest = Math.min(...pressures);
  const range = Math.max(1, highest - lowest);

  return 1 + (highest - params.entry.totalPressure) / range;
}

function pickOverfocusRedirectTarget(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: ConsensusBoardEntry[];
  leaderCandidateId: string;
  input: AutonomyPlannerInput;
  eventBiases: ScenarioAutonomyEventBias[];
}) {
  const candidates = params.board.filter(
    (entry) => entry.candidateId !== params.leaderCandidateId,
  );
  const actorBias = params.input.autonomy.actorBias[params.actor.persona.id];
  const suspicion = params.input.playerSuspicion ?? DEFAULT_PLAYER_SUSPICION_CONTEXT;

  if (suspicion.score < 30) {
    return [...candidates].sort(
      (left, right) => left.totalPressure - right.totalPressure,
    )[0] ?? null;
  }

  return candidates
    .map((entry) => {
      let weight = pressureAppeal({ entry, candidates });

      if (params.actor.decision.initialTargets.includes(entry.candidateId)) {
        weight *= entry.candidateId === DEFAULT_PLAYER_ID ? 1.2 : 1.18;
      }

      if (actorBias?.preferredTargets?.includes(entry.candidateId)) {
        weight *= 1.14;
      }

      if (actorBias?.protectedTargets?.includes(entry.candidateId)) {
        weight *= 0.42;
      }

      if (entry.candidateId === DEFAULT_PLAYER_ID) {
        weight *= suspicion.targetWeightMultiplier;
        if (suspicion.score >= 55) {
          weight *= 1.18;
        } else if (suspicion.score >= 30) {
          weight *= 1.08;
        }
      }

      for (const bias of params.eventBiases) {
        weight *= bias.targetWeights?.[entry.candidateId] ?? 1;
      }

      return {
        entry,
        weight,
      };
    })
    .sort((left, right) => {
      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }

      return left.entry.totalPressure - right.entry.totalPressure;
    })[0]?.entry ?? null;
}
