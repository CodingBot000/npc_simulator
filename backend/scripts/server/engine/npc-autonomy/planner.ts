import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import type { AutonomyMoveType } from "@sim-shared/types";
import {
  AUTONOMY_STEP_RULES,
  getAutonomyRoundVolatilityScale,
} from "@server/engine/npc-autonomy/config";
import {
  actorWeight,
  matchingEventBiases,
  moveWeights,
  recentToneWeight,
} from "@server/engine/npc-autonomy/planner-weights";
import {
  defaultTone,
  stepRationale,
} from "@server/engine/npc-autonomy/planner-rationale";
import {
  planOverfocusRedirect,
} from "@server/engine/npc-autonomy/planner-overfocus";
import {
  pickFreezeTarget,
  pickPileOnTarget,
  pickRedirectTargets,
  pickShieldTarget,
} from "@server/engine/npc-autonomy/planner-targets";
import type {
  AutonomyPlannerInput,
  AutonomyPlannedStep,
  AutonomyRandom,
} from "@server/engine/npc-autonomy/types";
import { buildConsensusBoard } from "@server/engine/pressure-engine";

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
  const overfocusRedirect = planOverfocusRedirect({
    input,
    board,
    eventBiases,
  });

  if (overfocusRedirect) {
    return overfocusRedirect;
  }

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

    const plannedStep = planSelectedMove({
      actor,
      board,
      eventBiases,
      input,
      moveType,
      rng,
      volatilityScale,
    });

    if (plannedStep) {
      return plannedStep;
    }

    remainingMoves.delete(moveType);
  }

  return null;
}

function planSelectedMove(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: AutonomyPlannedStep["boardBefore"];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  input: AutonomyPlannerInput;
  moveType: AutonomyMoveType;
  rng: AutonomyRandom;
  volatilityScale: number;
}): AutonomyPlannedStep | null {
  if (params.moveType === "pile_on") {
    return planPileOnMove({ ...params, moveType: "pile_on" });
  }

  if (params.moveType === "shield") {
    return planShieldMove({ ...params, moveType: "shield" });
  }

  if (params.moveType === "redirect") {
    return planRedirectMove({ ...params, moveType: "redirect" });
  }

  return planFreezeMove({ ...params, moveType: "freeze" });
}

function planPileOnMove(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: AutonomyPlannedStep["boardBefore"];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  input: AutonomyPlannerInput;
  moveType: "pile_on";
  rng: AutonomyRandom;
  volatilityScale: number;
}): AutonomyPlannedStep | null {
  const targetNpcId = pickPileOnTarget(params);

  if (!targetNpcId) {
    return null;
  }

  return buildPlannedStep({
    ...params,
    targetNpcId,
    secondaryTargetNpcId: null,
  });
}

function planShieldMove(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: AutonomyPlannedStep["boardBefore"];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  input: AutonomyPlannerInput;
  moveType: "shield";
  rng: AutonomyRandom;
  volatilityScale: number;
}): AutonomyPlannedStep | null {
  const targetNpcId = pickShieldTarget(params);

  if (!targetNpcId) {
    return null;
  }

  return buildPlannedStep({
    ...params,
    targetNpcId,
    secondaryTargetNpcId: null,
  });
}

function planRedirectMove(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: AutonomyPlannedStep["boardBefore"];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  input: AutonomyPlannerInput;
  moveType: "redirect";
  rng: AutonomyRandom;
  volatilityScale: number;
}): AutonomyPlannedStep | null {
  const redirectTargets = pickRedirectTargets(params);

  if (!redirectTargets) {
    return null;
  }

  return buildPlannedStep({
    ...params,
    targetNpcId: redirectTargets.targetNpcId,
    secondaryTargetNpcId: redirectTargets.secondaryTargetNpcId,
  });
}

function planFreezeMove(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: AutonomyPlannedStep["boardBefore"];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  input: AutonomyPlannerInput;
  moveType: "freeze";
  rng: AutonomyRandom;
  volatilityScale: number;
}): AutonomyPlannedStep {
  return buildPlannedStep({
    ...params,
    targetNpcId: pickFreezeTarget(params) ?? null,
    secondaryTargetNpcId: null,
  });
}

function buildPlannedStep(params: {
  actor: AutonomyPlannerInput["npcs"][number];
  board: AutonomyPlannedStep["boardBefore"];
  input: AutonomyPlannerInput;
  moveType: AutonomyMoveType;
  secondaryTargetNpcId: string | null;
  targetNpcId: string | null;
  volatilityScale: number;
}): AutonomyPlannedStep {
  return {
    actorNpcId: params.actor.persona.id,
    moveType: params.moveType,
    targetNpcId: params.targetNpcId,
    secondaryTargetNpcId: params.secondaryTargetNpcId,
    rationale: stepRationale({
      actor: params.actor,
      moveType: params.moveType,
      targetNpcId: params.targetNpcId,
      secondaryTargetNpcId: params.secondaryTargetNpcId,
      input: params.input,
    }),
    tone: defaultTone(params.moveType),
    volatilityScale: params.volatilityScale,
    targetDeltaScale:
      params.targetNpcId === DEFAULT_PLAYER_ID
        ? (params.input.playerSuspicion?.deltaScale ?? 1)
        : 1,
    secondaryTargetDeltaScale: 1,
    boardBefore: params.board,
  };
}
