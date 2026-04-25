import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import type {
  EventLogEntry,
} from "@backend-contracts/api";
import type { JudgementState } from "@backend-persistence";
import type { PersistedNpcState } from "@backend-domain";
import type {
  AutonomyMoveType,
  ConsensusBoardEntry,
} from "@sim-shared/types";
import {
  AUTONOMY_STEP_RULES,
  getAutonomyRoundVolatilityScale,
} from "@server/engine/npc-autonomy/config";
import type {
  AutonomyPlannerInput,
  AutonomyPlannedStep,
  AutonomyRandom,
} from "@server/engine/npc-autonomy/types";
import { buildConsensusBoard } from "@server/engine/pressure-engine";

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

function recentToneWeight(events: EventLogEntry[]) {
  if (events.some((event) => event.tone === "danger")) {
    return AUTONOMY_STEP_RULES.dangerToneBonus;
  }

  if (events.some((event) => event.tone === "warning")) {
    return AUTONOMY_STEP_RULES.dangerToneBonus * 0.66;
  }

  return 0;
}

function matchingEventBiases(input: AutonomyPlannerInput) {
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
  return actor.relationship.npcOpinions[targetNpcId] ?? 30;
}

function actorWeight(params: {
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

function moveWeights(params: {
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

function pickPileOnTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  rng: AutonomyRandom;
}) {
  const { actor, input, board, eventBiases, rng } = params;
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
        let weight = 0.25;

        if (boardIndex >= 0) {
          weight *= boardRankWeight(boardIndex);
        }

        if (actor.decision.initialTargets.includes(candidate.persona.id)) {
          weight *= 1.38;
        }

        if (actorBias?.preferredTargets?.includes(candidate.persona.id)) {
          weight *= 1.28;
        }

        if (actorBias?.protectedTargets?.includes(candidate.persona.id)) {
          weight *= 0.4;
        }

        weight *= opinion <= 50 ? 1 + (50 - opinion) / 50 : 0.82;

        for (const bias of eventBiases) {
          weight *= bias.targetWeights?.[candidate.persona.id] ?? 1;
        }

        return {
          value: candidate.persona.id,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:pile-on-target`,
  );
}

function pickShieldTarget(params: {
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

function pickRedirectTargets(params: {
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
    input.npcs
      .filter(
        (candidate) =>
          candidate.persona.id !== actor.persona.id &&
          candidate.persona.id !== fromTarget,
      )
      .map((candidate) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidate.persona.id,
        );
        const opinion = evaluatorOpinion(actor, candidate.persona.id);
        let weight = 0.18;

        if (boardIndex >= 0) {
          weight *= boardRankWeight(Math.min(boardIndex + 1, 2));
        }

        if (actor.decision.initialTargets.includes(candidate.persona.id)) {
          weight *= 1.35;
        }

        if (actorBias?.preferredTargets?.includes(candidate.persona.id)) {
          weight *= 1.24;
        }

        if (actorBias?.protectedTargets?.includes(candidate.persona.id)) {
          weight *= 0.4;
        }

        weight *= opinion <= 50 ? 1 + (50 - opinion) / 50 : 0.86;

        for (const bias of eventBiases) {
          weight *= bias.targetWeights?.[candidate.persona.id] ?? 1;
        }

        return {
          value: candidate.persona.id,
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

function pickFreezeTarget(params: {
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

function defaultTone(moveType: AutonomyMoveType): EventLogEntry["tone"] {
  return moveType === "pile_on" || moveType === "redirect" ? "warning" : "info";
}

function stepRationale(params: {
  actor: PersistedNpcState;
  moveType: AutonomyMoveType;
  targetNpcId: string | null;
  secondaryTargetNpcId: string | null;
  input: AutonomyPlannerInput;
}) {
  const { actor, moveType, targetNpcId, secondaryTargetNpcId, input } = params;
  const namesById = Object.fromEntries(
    input.npcs.map((npc) => [npc.persona.id, npc.persona.name]),
  );
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

/**
 * Decide how many autonomy steps should fire this turn.
 */
export function determineAutonomyStepCount(
  input: AutonomyPlannerInput,
  rng: AutonomyRandom,
) {
  if (!input.autonomy.enabled) {
    return 0;
  }

  const minSteps = Math.max(0, input.autonomy.minStepsPerTurn);
  const maxSteps = Math.max(minSteps, input.autonomy.maxStepsPerTurn);

  if (maxSteps <= minSteps) {
    return minSteps;
  }

  const board = buildConsensusBoard({
    judgements: input.judgements,
    npcs: input.npcs,
  });
  const volatilityScale = getAutonomyRoundVolatilityScale(
    input.autonomy,
    input.round.currentRound,
  );
  const leadGap =
    board[0] && board[1] ? board[0].totalPressure - board[1].totalPressure : 0;
  let extraStepChance = AUTONOMY_STEP_RULES.baseSecondStepChance * volatilityScale;

  if (input.round.currentRound >= input.round.minRoundsBeforeResolution) {
    extraStepChance += AUTONOMY_STEP_RULES.lateRoundBonus;
  }

  if (leadGap <= AUTONOMY_STEP_RULES.narrowGapThreshold) {
    extraStepChance += AUTONOMY_STEP_RULES.narrowGapBonus;
  }

  extraStepChance += recentToneWeight(input.recentEvents);

  if (rng.nextFloat("autonomy:step-count-extra") < Math.min(extraStepChance, 0.85)) {
    return Math.min(maxSteps, minSteps + 1);
  }

  return minSteps;
}

/**
 * Pick the next actor/move/target set without mutating runtime state.
 */
export function planAutonomyStep(
  input: AutonomyPlannerInput,
  rng: AutonomyRandom,
): AutonomyPlannedStep | null {
  if (!input.autonomy.enabled) {
    return null;
  }

  const board = buildConsensusBoard({
    judgements: input.judgements,
    npcs: input.npcs,
  });
  const eventBiases = matchingEventBiases(input);
  const actor = rng.pickWeighted(
    input.npcs
      .filter((npc) => !input.excludedActorNpcIds.includes(npc.persona.id))
      .map((npc) => ({
        value: npc,
        weight: actorWeight({
          actor: npc,
          input,
          board,
          eventBiases,
        }),
      })),
    "autonomy:actor",
  );

  if (!actor) {
    return null;
  }

  const weights = moveWeights({
    actor,
    input,
    board,
    eventBiases,
  });
  const volatilityScale = getAutonomyRoundVolatilityScale(
    input.autonomy,
    input.round.currentRound,
  );
  const remainingMoves = new Set<AutonomyMoveType>([
    "pile_on",
    "shield",
    "redirect",
    "freeze",
  ]);

  while (remainingMoves.size > 0) {
    const moveType = rng.pickWeighted(
      Array.from(remainingMoves).map((move) => ({
        value: move,
        weight: weights[move],
      })),
      `autonomy:${actor.persona.id}:move`,
    );

    if (!moveType) {
      break;
    }

    if (moveType === "pile_on") {
      const targetNpcId = pickPileOnTarget({
        actor,
        input,
        board,
        eventBiases,
        rng,
      });

      if (targetNpcId) {
        return {
          actorNpcId: actor.persona.id,
          moveType,
          targetNpcId,
          secondaryTargetNpcId: null,
          rationale: stepRationale({
            actor,
            moveType,
            targetNpcId,
            secondaryTargetNpcId: null,
            input,
          }),
          tone: defaultTone(moveType),
          volatilityScale,
          boardBefore: board,
        };
      }
    }

    if (moveType === "shield") {
      const targetNpcId = pickShieldTarget({
        actor,
        input,
        board,
        rng,
      });

      if (targetNpcId) {
        return {
          actorNpcId: actor.persona.id,
          moveType,
          targetNpcId,
          secondaryTargetNpcId: null,
          rationale: stepRationale({
            actor,
            moveType,
            targetNpcId,
            secondaryTargetNpcId: null,
            input,
          }),
          tone: defaultTone(moveType),
          volatilityScale,
          boardBefore: board,
        };
      }
    }

    if (moveType === "redirect") {
      const redirectTargets = pickRedirectTargets({
        actor,
        input,
        board,
        eventBiases,
        rng,
      });

      if (redirectTargets) {
        return {
          actorNpcId: actor.persona.id,
          moveType,
          targetNpcId: redirectTargets.targetNpcId,
          secondaryTargetNpcId: redirectTargets.secondaryTargetNpcId,
          rationale: stepRationale({
            actor,
            moveType,
            targetNpcId: redirectTargets.targetNpcId,
            secondaryTargetNpcId: redirectTargets.secondaryTargetNpcId,
            input,
          }),
          tone: defaultTone(moveType),
          volatilityScale,
          boardBefore: board,
        };
      }
    }

    if (moveType === "freeze") {
      const targetNpcId = pickFreezeTarget({
        actor,
        input,
        board,
        rng,
      });

      return {
        actorNpcId: actor.persona.id,
        moveType,
        targetNpcId: targetNpcId ?? null,
        secondaryTargetNpcId: null,
        rationale: stepRationale({
          actor,
          moveType,
          targetNpcId: targetNpcId ?? null,
          secondaryTargetNpcId: null,
          input,
        }),
        tone: defaultTone(moveType),
        volatilityScale,
        boardBefore: board,
      };
    }

    remainingMoves.delete(moveType);
  }

  return null;
}
