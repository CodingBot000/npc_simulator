import type {
  AllowedActionType,
  EmotionPrimary,
  JudgementDimensions,
  PlayerAction,
} from "@/lib/types";

export const DEFAULT_PLAYER_ID = "local-player";
export const DEFAULT_PLAYER_LABEL = "당신";
export const MAX_EVENT_LOG_ENTRIES = 12;
export const MAX_SHORT_MEMORIES = 8;
export const MAX_LONG_MEMORIES = 5;
export const MAX_CONVERSATION_MESSAGES = 10;
export const MAX_RETRIEVED_MEMORIES = 4;
export const MAX_RETRIEVED_KNOWLEDGE = 5;

export const PLAYER_ACTION_LABELS: Record<PlayerAction, string> = {
  make_case: "논리 제시",
  expose: "폭로",
  appeal: "감정 호소",
  ally: "연대 제안",
  deflect: "책임 전가",
  stall: "시간 끌기",
  confess: "부분 자백",
};

export const PLAYER_ACTION_DESCRIPTIONS: Record<PlayerAction, string> = {
  make_case: "대상을 희생 후보로 몰기 위한 논리를 세운다.",
  expose: "숨겨진 기록이나 책임을 들춰 대상의 압력을 높인다.",
  appeal: "양심, 연민, 의무를 자극해 판세를 흔든다.",
  ally: "현재 인물과 공동전선을 만들고 타깃을 고립시킨다.",
  deflect: "자신에게 온 책임을 다른 사람 쪽으로 돌린다.",
  stall: "당장 결정을 미루고 다음 라운드까지 시간을 번다.",
  confess: "작은 잘못을 인정해 더 큰 불신을 막는다.",
};

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

export const DATA_FILES = {
  worldState: "world-state.json",
  interactionLog: "interaction-log.json",
  npcMemory: "npc-memory.json",
} as const;
