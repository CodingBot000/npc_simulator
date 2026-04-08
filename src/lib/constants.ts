import type {
  AllowedActionType,
  EmotionPrimary,
  PlayerAction,
} from "@/lib/types";

export const DEFAULT_PLAYER_ID = "local-player";
export const MAX_EVENT_LOG_ENTRIES = 12;
export const MAX_SHORT_MEMORIES = 8;
export const MAX_LONG_MEMORIES = 5;
export const MAX_CONVERSATION_MESSAGES = 10;
export const MAX_RETRIEVED_MEMORIES = 4;

export const PLAYER_ACTION_LABELS: Record<PlayerAction, string> = {
  question: "질문",
  persuade: "설득",
  trade: "거래",
  request: "부탁",
  empathize: "공감",
  pressure: "압박",
};

export const NPC_ACTION_LABELS: Record<AllowedActionType, string> = {
  answer: "직접 응답",
  ask_back: "되묻기",
  refuse: "거절",
  hint: "힌트 제공",
  negotiate: "조건 협상",
  accept_request: "요청 수락",
  delay: "시간 끌기",
};

export const EMOTION_LABELS: Record<EmotionPrimary, string> = {
  calm: "차분함",
  curious: "호기심",
  guarded: "경계",
  annoyed: "짜증",
  friendly: "우호",
};

export const DATA_FILES = {
  worldState: "world-state.json",
  interactionLog: "interaction-log.json",
  npcMemory: "npc-memory.json",
} as const;
