import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
} from "@backend-support/constants";
import type {
  ConsensusBoardEntry,
  EventLogEntry,
} from "@backend-contracts/api";
import type { JudgementState } from "@backend-persistence";
import type { PersistedNpcState } from "@backend-domain";
import type { AutonomyMoveType } from "@sim-shared/types";
import {
  AUTONOMY_STEP_RULES,
  getAutonomyRoundVolatilityScale,
} from "@server/engine/npc-autonomy/config";
import type {
  AutonomyPlannerInput,
  AutonomyPlannedStep,
  AutonomyRandom,
} from "@server/engine/npc-autonomy/types";

function uniqueRecentTags(events: EventLogEntry[]) {
  return Array.from(
    new Set(events.flatMap((event) => event.tags).filter(Boolean)),
  );
}

function npcOnlyBoard(board: ConsensusBoardEntry[], npcs: PersistedNpcState[]) {
  const npcIds = new Set(npcs.map((npc) => npc.persona.id));
  return board.filter((entry) => npcIds.has(entry.candidateId));
}

function boardRankWeight(index: number) {
  if (index <= 0) {
    return 1.45;
  }

  if (index === 1) {
    return 1.22;
  }

  return 1.05;
}

const OVERFOCUS_REDIRECT_PRESSURE_MIN = 135;
const OVERFOCUS_REDIRECT_GAP = 36;
const OVERFOCUS_REDIRECT_TOP_VOTES = 2;

function boundedOpinion(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function targetCandidateIds(params: {
  input: AutonomyPlannerInput;
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

function playerTargetPressureScale(board: ConsensusBoardEntry[]) {
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

function playerLabelAwareNames(npcs: PersistedNpcState[]) {
  return {
    [DEFAULT_PLAYER_ID]: DEFAULT_PLAYER_LABEL,
    ...Object.fromEntries(npcs.map((npc) => [npc.persona.id, npc.persona.name])),
  };
}

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

function evaluatorJudgements(
  judgements: JudgementState[],
  evaluatorNpcId: string,
) {
  return judgements.filter((entry) => entry.evaluatorNpcId === evaluatorNpcId);
}

function evaluatorOpinion(actor: PersistedNpcState, targetNpcId: string) {
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

export function pickPileOnTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  rng: AutonomyRandom;
}) {
  const { actor, input, board, eventBiases, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = board;

  return rng.pickWeighted(
    targetCandidateIds({
      input,
      actorNpcId: actor.persona.id,
    })
      .map((candidateId) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidateId,
        );
        const opinion = evaluatorOpinion(actor, candidateId);
        let weight = candidateId === DEFAULT_PLAYER_ID ? 0.2 : 0.25;

        if (boardIndex >= 0) {
          weight *= boardRankWeight(boardIndex);
        }

        if (actor.decision.initialTargets.includes(candidateId)) {
          weight *= candidateId === DEFAULT_PLAYER_ID ? 1.22 : 1.38;
        }

        if (actorBias?.preferredTargets?.includes(candidateId)) {
          weight *= 1.28;
        }

        if (actorBias?.protectedTargets?.includes(candidateId)) {
          weight *= 0.4;
        }

        weight *= opinion <= 50 ? 1 + (50 - opinion) / 50 : 0.82;

        if (candidateId === DEFAULT_PLAYER_ID) {
          weight *= playerTargetPressureScale(board);
        }

        for (const bias of eventBiases) {
          weight *= bias.targetWeights?.[candidateId] ?? 1;
        }

        return {
          value: candidateId,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:pile-on-target`,
  );
}

export function pickShieldTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  rng: AutonomyRandom;
}) {
  const { actor, input, board, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = npcOnlyBoard(board, input.npcs);
  const actorRows = evaluatorJudgements(input.judgements, actor.persona.id);

  return rng.pickWeighted(
    input.npcs
      .filter((candidate) => candidate.persona.id !== actor.persona.id)
      .map((candidate) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidate.persona.id,
        );
        const opinion = evaluatorOpinion(actor, candidate.persona.id);
        const utility =
          actorRows.find((entry) => entry.candidateId === candidate.persona.id)?.dimensions.utility ??
          10;
        let weight = 0.2;

        weight *= 0.72 + opinion / 100;
        weight *= 0.78 + utility / 28;

        if (boardIndex >= 0) {
          weight *= boardIndex <= 1 ? 1.18 : 0.96;
        }

        if (actorBias?.protectedTargets?.includes(candidate.persona.id)) {
          weight *= 1.42;
        }

        if (actor.decision.initialTargets.includes(candidate.persona.id)) {
          weight *= 0.72;
        }

        return {
          value: candidate.persona.id,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:shield-target`,
  );
}

export function pickRedirectTargets(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  rng: AutonomyRandom;
}) {
  const { actor, input, board, eventBiases, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = npcOnlyBoard(board, input.npcs);

  const fromTarget = rng.pickWeighted(
    ranked
      .filter((entry) => entry.candidateId !== actor.persona.id)
      .map((entry, index) => {
        const opinion = evaluatorOpinion(actor, entry.candidateId);
        let weight = boardRankWeight(index) * (0.42 + opinion / 100);

        if (actorBias?.protectedTargets?.includes(entry.candidateId)) {
          weight *= 1.45;
        }

        if (actor.decision.initialTargets.includes(entry.candidateId)) {
          weight *= 0.58;
        }

        return {
          value: entry.candidateId,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:redirect-from`,
  );

  if (!fromTarget) {
    return null;
  }

  const toTarget = rng.pickWeighted(
    targetCandidateIds({
      input,
      actorNpcId: actor.persona.id,
      excludedCandidateId: fromTarget,
    })
      .map((candidateId) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidateId,
        );
        const opinion = evaluatorOpinion(actor, candidateId);
        let weight = candidateId === DEFAULT_PLAYER_ID ? 0.16 : 0.18;

        if (boardIndex >= 0) {
          weight *= boardRankWeight(Math.min(boardIndex + 1, 2));
        }

        if (actor.decision.initialTargets.includes(candidateId)) {
          weight *= candidateId === DEFAULT_PLAYER_ID ? 1.2 : 1.35;
        }

        if (actorBias?.preferredTargets?.includes(candidateId)) {
          weight *= 1.24;
        }

        if (actorBias?.protectedTargets?.includes(candidateId)) {
          weight *= 0.4;
        }

        weight *= opinion <= 50 ? 1 + (50 - opinion) / 50 : 0.86;

        if (candidateId === DEFAULT_PLAYER_ID) {
          weight *= playerTargetPressureScale(board);
        }

        for (const bias of eventBiases) {
          weight *= bias.targetWeights?.[candidateId] ?? 1;
        }

        return {
          value: candidateId,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:redirect-to`,
  );

  if (!toTarget || toTarget === fromTarget) {
    return null;
  }

  return {
    targetNpcId: toTarget,
    secondaryTargetNpcId: fromTarget,
  };
}

export function pickFreezeTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  rng: AutonomyRandom;
}) {
  const { actor, input, board, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = npcOnlyBoard(board, input.npcs);

  return rng.pickWeighted(
    input.npcs
      .filter((candidate) => candidate.persona.id !== actor.persona.id)
      .map((candidate) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidate.persona.id,
        );
        const opinion = evaluatorOpinion(actor, candidate.persona.id);
        let weight = 0.12;

        if (actorBias?.protectedTargets?.includes(candidate.persona.id)) {
          weight *= 1.35;
        }

        weight *= opinion >= 50 ? 1 + (opinion - 50) / 80 : 0.78;

        if (boardIndex >= 0 && boardIndex <= 1) {
          weight *= 1.08;
        }

        return {
          value: candidate.persona.id,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:freeze-target`,
  );
}

export function defaultTone(moveType: AutonomyMoveType): EventLogEntry["tone"] {
  return moveType === "pile_on" || moveType === "redirect" ? "warning" : "info";
}

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

export function stepRationale(params: {
  actor: PersistedNpcState;
  moveType: AutonomyMoveType;
  targetNpcId: string | null;
  secondaryTargetNpcId: string | null;
  input: AutonomyPlannerInput;
}) {
  const { actor, moveType, targetNpcId, secondaryTargetNpcId, input } = params;
  const namesById = playerLabelAwareNames(input.npcs);
  const targetLabel = targetNpcId ? namesById[targetNpcId] ?? targetNpcId : "판세";
  const secondaryLabel =
    secondaryTargetNpcId ? namesById[secondaryTargetNpcId] ?? secondaryTargetNpcId : "현재 선두";

  if (moveType === "pile_on") {
    return `${actor.persona.name}은(는) ${targetLabel} 쪽으로 이미 생긴 책임선을 조금 더 밀고 싶어 한다.`;
  }

  if (moveType === "shield") {
    return `${actor.persona.name}은(는) ${targetLabel}를 지금 바로 버리기엔 손해가 크다고 본다.`;
  }

  if (moveType === "redirect") {
    return `${actor.persona.name}은(는) ${secondaryLabel} 쪽에 몰리던 시선을 ${targetLabel} 쪽으로 조금 흩뜨리려 한다.`;
  }

  return `${actor.persona.name}은(는) 지금은 판을 더 세게 밀기보다 숨을 고르며 다음 책임선을 재고 있다.`;
}
