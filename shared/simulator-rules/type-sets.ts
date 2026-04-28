import type {
  AllowedActionType,
  AutonomyMoveType,
  EmotionPrimary,
  ImpactTag,
  PlayerAction,
} from "./types";

export const emotionPrimaries = [
  "focused",
  "fearful",
  "angry",
  "guilty",
  "cold",
  "desperate",
] as const satisfies readonly EmotionPrimary[];

export const allowedActionTypes = [
  "accuse",
  "defend",
  "deflect",
  "appeal",
  "ally",
  "stall",
  "probe",
] as const satisfies readonly AllowedActionType[];

export const playerActions = [
  "make_case",
  "expose",
  "appeal",
  "ally",
  "deflect",
  "stall",
  "confess",
] as const satisfies readonly PlayerAction[];

export const autonomyMoveTypes = [
  "pile_on",
  "shield",
  "redirect",
  "freeze",
] as const satisfies readonly AutonomyMoveType[];

export const impactTags = [
  "player_distrust_up",
  "player_distrust_down",
  "player_blame_up",
  "player_blame_down",
  "player_sympathy_up",
  "player_sympathy_down",
  "target_blame_up",
  "target_blame_high_up",
  "target_blame_down",
  "target_distrust_up",
  "target_distrust_down",
  "target_hostility_up",
  "target_hostility_down",
  "target_sympathy_up",
  "target_sympathy_down",
  "target_utility_down",
  "target_utility_up",
  "target_dispensability_up",
  "target_dispensability_down",
  "room_pressure_shift",
  "no_major_shift",
] as const satisfies readonly ImpactTag[];
