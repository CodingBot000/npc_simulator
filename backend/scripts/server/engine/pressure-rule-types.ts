/**
 * pressure-rule-types.ts
 *
 * This file collects the shared type definitions used by the pressure rule system.
 * Read this file when you want to answer:
 * - "What data shape does each rule layer use?"
 * - "What is the difference between an action rule, a bias profile, and a round profile?"
 * - "What input/output contract does the pressure adjustment builder follow?"
 *
 * This file should stay purely structural. It describes the vocabulary of the pressure
 * system without embedding scenario logic, NPC bias values, or round pacing data.
 *
 * Last updated: 2026-04-09
 */

import type {
  RelationshipDelta,
  RoundState,
} from "@backend-contracts/api";
import type {
  CandidateId,
  ConsensusBoardEntry,
  JudgementDimensions,
  PlayerAction,
} from "@sim-shared/types";

export type PressureRole = "player" | "target";
export type DimensionKey = keyof JudgementDimensions;
export type DimensionDelta = Partial<Record<DimensionKey, number>>;

export interface PressureActionRule {
  playerDelta: DimensionDelta;
  targetDelta: DimensionDelta;
  notes: Record<PressureRole, string>;
}

export interface EvaluatorReactionProfile {
  id: string;
  label: string;
  actionScale: Partial<Record<PressureRole, Partial<Record<PlayerAction, number>>>>;
  targetScale: Partial<Record<CandidateId, number>>;
  dimensionBias: Partial<Record<DimensionKey, number>>;
  relationshipAdjustment: Partial<Record<PlayerAction, RelationshipDelta>>;
  specialModifiers: Array<{
    id: string;
    note: string;
    scale: number;
    appliesTo?: PressureRole | "both";
    actions?: PlayerAction[];
    targetIds?: CandidateId[];
  }>;
}

export interface RoundPressureProfile {
  id: string;
  label: string;
  fromRound: number;
  toRound: number;
  actionScale: Partial<Record<PlayerAction, number>>;
  leaderDogpileBonus: number;
  selfPreservationBonus: number;
  stallPunishBonus: number;
}

export interface PressureAdjustmentInput {
  action: PlayerAction | null;
  evaluatorId: string;
  candidateId: CandidateId;
  targetNpcId: string | null;
  board: ConsensusBoardEntry[];
  round: RoundState;
}

export interface PressureAdjustmentResult {
  role: PressureRole;
  dimensionDelta: DimensionDelta;
  factors: string[];
}
