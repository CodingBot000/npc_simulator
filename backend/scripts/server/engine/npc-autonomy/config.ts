import type {
  AutonomyMoveType,
  JudgementDimensions,
} from "@backend-shared/types";
import type { ScenarioAutonomyConfig } from "@server/scenario/types";

type Range = readonly [number, number];

interface AutonomyMoveRule {
  targetDelta?: Partial<Record<keyof JudgementDimensions, Range>>;
  secondaryTargetDelta?: Partial<Record<keyof JudgementDimensions, Range>>;
  opinionDelta?: Range;
  secondaryOpinionDelta?: Range;
  emotionDelta?: Range;
}

export const AUTONOMY_STEP_RULES = {
  baseSecondStepChance: 0.14,
  lateRoundBonus: 0.16,
  narrowGapThreshold: 24,
  narrowGapBonus: 0.2,
  dangerToneBonus: 0.18,
} as const;

export const AUTONOMY_MOVE_RULES: Record<AutonomyMoveType, AutonomyMoveRule> = {
  pile_on: {
    targetDelta: {
      blame: [1, 2],
      distrust: [1, 2],
      hostility: [0, 1],
    },
    opinionDelta: [2, 5],
    emotionDelta: [1, 4],
  },
  shield: {
    targetDelta: {
      blame: [2, 3],
      distrust: [2, 3],
      utility: [1, 3],
      sympathy: [1, 3],
    },
    opinionDelta: [1, 3],
    emotionDelta: [0, 2],
  },
  redirect: {
    targetDelta: {
      blame: [1, 2],
      distrust: [1, 2],
      hostility: [0, 1],
    },
    secondaryTargetDelta: {
      blame: [2, 3],
      distrust: [2, 3],
    },
    opinionDelta: [2, 4],
    secondaryOpinionDelta: [1, 2],
    emotionDelta: [1, 3],
  },
  freeze: {
    opinionDelta: [1, 2],
    emotionDelta: [0, 1],
  },
} as const;

/**
 * Resolve the round-specific volatility multiplier so late rounds can react a bit
 * harder without changing the planner/apply rules themselves.
 */
export function getAutonomyRoundVolatilityScale(
  autonomy: ScenarioAutonomyConfig,
  roundNumber: number,
) {
  return (
    autonomy.roundVolatility.find(
      (rule) => roundNumber >= rule.fromRound && roundNumber <= rule.toRound,
    )?.scale ?? 1
  );
}
