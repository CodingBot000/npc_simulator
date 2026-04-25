import type { components } from "@contracts/openapi-types";

type Schema = components["schemas"];

export type EmotionPrimary = Schema["EmotionPrimary"];
export type AllowedActionType = Schema["AllowedActionType"];
export type PlayerAction = Schema["PlayerAction"];
export type AutonomyMoveType = Schema["AutonomyMoveType"];
export type ImpactTag = Schema["ImpactTag"];
export type CandidateId = Schema["CandidateId"];
export type ConsensusBoardEntry = Schema["ConsensusBoardEntry"];

export interface JudgementDimensions {
  blame: number;
  distrust: number;
  hostility: number;
  dispensability: number;
  utility: number;
  sympathy: number;
}
