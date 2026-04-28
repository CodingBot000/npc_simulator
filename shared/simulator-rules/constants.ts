import type {
  AllowedActionType,
  EmotionPrimary,
  JudgementDimensions,
} from "./types";
export {
  PLAYER_ACTION_DESCRIPTIONS,
  PLAYER_ACTION_LABELS,
  PLAYER_ACTION_TARGET_MODES,
} from "@sim-presentation/player-actions";

export const DEFAULT_PLAYER_ID = "local-player";
export const DEFAULT_PLAYER_LABEL = "당신";
export const MAX_EVENT_LOG_ENTRIES = 12;
export const MAX_SHORT_MEMORIES = 8;
export const MAX_LONG_MEMORIES = 5;
export const MAX_CONVERSATION_MESSAGES = 10;
export const MAX_RETRIEVED_MEMORIES = 4;
export const MAX_RETRIEVED_KNOWLEDGE = 5;

export const NPC_ACTION_LABELS: Record<AllowedActionType, string> = {
  accuse: "공격",
  defend: "방어",
  deflect: "책임 회피",
  appeal: "도덕 호소",
  ally: "동맹 신호",
  stall: "판단 유예",
  probe: "탐색 질문",
};

export const EMOTION_LABELS: Record<EmotionPrimary, string> = {
  focused: "집중",
  fearful: "공포",
  angry: "분노",
  guilty: "죄책감",
  cold: "냉정",
  desperate: "절박",
};

export const PRESSURE_DIMENSION_LABELS: Record<keyof JudgementDimensions, string> = {
  blame: "책임",
  distrust: "불신",
  hostility: "적대",
  dispensability: "대체 가능성",
  utility: "필요성",
  sympathy: "연민",
};
