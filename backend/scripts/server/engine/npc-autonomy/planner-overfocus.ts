import type { ConsensusBoardEntry } from "@backend-contracts/api";
import { getAutonomyRoundVolatilityScale } from "@server/engine/npc-autonomy/config";
import {
  npcOnlyBoard,
  playerLabelAwareNames,
} from "@server/engine/npc-autonomy/planner-common";
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
  const target = [...params.board]
    .filter((entry) => entry.candidateId !== leader.candidateId)
    .sort((left, right) => left.totalPressure - right.totalPressure)[0] ?? null;

  if (!actor || !target) {
    return null;
  }

  const labels = playerLabelAwareNames(params.input.npcs);
  const targetLabel = labels[target.candidateId] ?? target.candidateId;
  const leaderLabel = labels[leader.candidateId] ?? leader.candidateId;

  return {
    actorNpcId: actor.persona.id,
    moveType: "redirect",
    targetNpcId: target.candidateId,
    secondaryTargetNpcId: leader.candidateId,
    rationale: `${leaderLabel}은(는) 자신에게 굳어지는 책임선을 피하려고 가장 안전해 보이는 ${targetLabel} 쪽으로 시선을 밀어낸다.`,
    tone: "warning",
    volatilityScale: getAutonomyRoundVolatilityScale(
      params.input.autonomy,
      params.input.round.currentRound,
    ),
    boardBefore: params.board,
  };
}
