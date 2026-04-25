/**
 * pressure-rules.ts
 *
 * This file is the composition layer for the pressure system.
 * Read this file when you want to answer:
 * - "How are action rules, character bias, and round pacing combined?"
 * - "In what order are multipliers applied to a pressure change?"
 * - "Where is the final pressure adjustment result assembled?"
 *
 * The raw rule data lives in `action-rules.ts`, `bias-profiles.ts`, and
 * `round-profiles.ts`. This file intentionally keeps only the shared helper logic
 * that turns those readable rule tables into an actual adjustment result.
 *
 * Last updated: 2026-04-09
 */

import { DEFAULT_PLAYER_ID } from "@backend-shared/constants";
import type { RelationshipDelta } from "@backend-shared/api-contract-types";
import type {
  CandidateId,
  ConsensusBoardEntry,
  PlayerAction,
} from "@sim-shared/types";
import { ACCUSATORY_ACTIONS, ACTION_PRESSURE_RULES, BASE_RELATIONSHIP_DELTAS } from "@server/engine/action-rules";
import { EVALUATOR_REACTION_PROFILES } from "@server/engine/bias-profiles";
import {
  type DimensionDelta,
  type DimensionKey,
  type EvaluatorReactionProfile,
  type PressureAdjustmentInput,
  type PressureAdjustmentResult,
  type PressureRole,
  type RoundPressureProfile,
} from "@server/engine/pressure-rule-types";
import { ROUND_PRESSURE_PROFILES } from "@server/engine/round-profiles";

function emptyDimensionDelta(): DimensionDelta {
  return {
    blame: 0,
    distrust: 0,
    hostility: 0,
    dispensability: 0,
    utility: 0,
    sympathy: 0,
  };
}

function scaleDimensionDelta(
  delta: DimensionDelta,
  scale: number,
  dimensionBias: Partial<Record<DimensionKey, number>>,
) {
  const next = emptyDimensionDelta();

  for (const key of Object.keys(next) as DimensionKey[]) {
    const base = delta[key] ?? 0;
    const bias = dimensionBias[key] ?? 1;
    next[key] = Math.round(base * scale * bias);
  }

  return next;
}

function boardEntry(candidateId: CandidateId, board: ConsensusBoardEntry[]) {
  return board.find((entry) => entry.candidateId === candidateId) ?? null;
}

function currentPressureScale(params: {
  action: PlayerAction;
  role: PressureRole;
  candidateId: CandidateId;
  board: ConsensusBoardEntry[];
  roundProfile: RoundPressureProfile;
}) {
  const factors: string[] = [];
  let scale = 1;
  const leader = params.board[0] ?? null;
  const current = boardEntry(params.candidateId, params.board);

  if (!leader || !current) {
    return { scale, factors };
  }

  if (
    params.role === "target" &&
    ACCUSATORY_ACTIONS.includes(params.action) &&
    leader.candidateId === params.candidateId
  ) {
    scale += params.roundProfile.leaderDogpileBonus;
    factors.push(`${params.roundProfile.label}이라 이미 선두인 대상을 더 몰기 쉽다.`);
  }

  if (params.role === "player" && params.candidateId === DEFAULT_PLAYER_ID) {
    if (
      leader.candidateId === DEFAULT_PLAYER_ID &&
      (params.action === "deflect" || params.action === "confess")
    ) {
      scale += params.roundProfile.selfPreservationBonus;
      factors.push(`${params.roundProfile.label}이라 자기보호 시도가 더 큰 변화를 만든다.`);
    }

    if (leader.candidateId === DEFAULT_PLAYER_ID && params.action === "stall") {
      scale += params.roundProfile.stallPunishBonus;
      factors.push(`${params.roundProfile.label}이라 시간 끌기는 더 위험하게 읽힌다.`);
    }
  }

  return { scale, factors };
}

function matchingSpecialModifiers(params: {
  profile: EvaluatorReactionProfile;
  action: PlayerAction;
  role: PressureRole;
  candidateId: CandidateId;
}) {
  return params.profile.specialModifiers.filter((modifier) => {
    const actionMatches = !modifier.actions || modifier.actions.includes(params.action);
    const roleMatches =
      !modifier.appliesTo ||
      modifier.appliesTo === "both" ||
      modifier.appliesTo === params.role;
    const targetMatches =
      !modifier.targetIds || modifier.targetIds.includes(params.candidateId);

    return actionMatches && roleMatches && targetMatches;
  });
}

export function getRoundPressureProfile(roundNumber: number) {
  return (
    ROUND_PRESSURE_PROFILES.find(
      (profile) => roundNumber >= profile.fromRound && roundNumber <= profile.toRound,
    ) ?? ROUND_PRESSURE_PROFILES[0]
  );
}

export function buildRelationshipDeltaForNpc(
  action: PlayerAction | null,
  evaluatorId: string,
) {
  if (!action) {
    return { trust: 0, affinity: 0, tension: 0 } satisfies RelationshipDelta;
  }

  const base = BASE_RELATIONSHIP_DELTAS[action];
  const adjustment =
    EVALUATOR_REACTION_PROFILES[evaluatorId]?.relationshipAdjustment[action] ??
    ({ trust: 0, affinity: 0, tension: 0 } satisfies RelationshipDelta);

  return {
    trust: base.trust + adjustment.trust,
    affinity: base.affinity + adjustment.affinity,
    tension: base.tension + adjustment.tension,
  } satisfies RelationshipDelta;
}

export function buildPressureAdjustment(
  params: PressureAdjustmentInput,
): PressureAdjustmentResult | null {
  if (!params.action) {
    return null;
  }

  const role: PressureRole | null =
    params.candidateId === DEFAULT_PLAYER_ID
      ? "player"
      : params.targetNpcId && params.candidateId === params.targetNpcId
        ? "target"
        : null;

  if (!role) {
    return null;
  }

  const actionRule = ACTION_PRESSURE_RULES[params.action];
  const profile = EVALUATOR_REACTION_PROFILES[params.evaluatorId];
  const roundProfile = getRoundPressureProfile(params.round.currentRound);
  const baseDelta = role === "player" ? actionRule.playerDelta : actionRule.targetDelta;

  if (Object.keys(baseDelta).length === 0) {
    return null;
  }

  const factors = [actionRule.notes[role]];
  let scale = 1;

  const profileActionScale = profile.actionScale[role]?.[params.action] ?? 1;
  if (profileActionScale !== 1) {
    scale *= profileActionScale;
    factors.push(`${profile.label} 편향 때문에 ${role === "player" ? "당신" : "타깃"} 반응이 달라진다.`);
  }

  const profileTargetScale = profile.targetScale[params.candidateId] ?? 1;
  if (profileTargetScale !== 1) {
    scale *= profileTargetScale;
    factors.push(`${profile.label} 편향상 이 대상은 원래 더 잘 걸린다.`);
  }

  const roundActionScale = roundProfile.actionScale[params.action] ?? 1;
  if (roundActionScale !== 1) {
    scale *= roundActionScale;
    factors.push(`${roundProfile.label}이라 ${params.action}의 파급력이 달라진다.`);
  }

  const pressureMomentum = currentPressureScale({
    action: params.action,
    role,
    candidateId: params.candidateId,
    board: params.board,
    roundProfile,
  });
  scale *= pressureMomentum.scale;
  factors.push(...pressureMomentum.factors);

  for (const modifier of matchingSpecialModifiers({
    profile,
    action: params.action,
    role,
    candidateId: params.candidateId,
  })) {
    scale *= modifier.scale;
    factors.push(modifier.note);
  }

  return {
    role,
    dimensionDelta: scaleDimensionDelta(baseDelta, scale, profile.dimensionBias),
    factors,
  };
}
