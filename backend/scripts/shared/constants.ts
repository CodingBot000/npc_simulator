import type {
  AllowedActionType,
  EmotionPrimary,
  JudgementDimensions,
  PlayerAction,
} from "./types";

export const DEFAULT_PLAYER_ID = "local-player";
export const DEFAULT_PLAYER_LABEL = "당신";
export const MAX_EVENT_LOG_ENTRIES = 12;
export const MAX_SHORT_MEMORIES = 8;
export const MAX_LONG_MEMORIES = 5;
export const MAX_CONVERSATION_MESSAGES = 10;
export const MAX_RETRIEVED_MEMORIES = 4;
export const MAX_RETRIEVED_KNOWLEDGE = 5;

export const PLAYER_ACTION_LABELS: Record<PlayerAction, string> = {
  make_case: "책임 묻기",
  expose: "사실 확인",
  appeal: "양심 흔들기",
  ally: "편들기",
  deflect: "화살 돌리기",
  stall: "시간 끌기",
  confess: "작게 인정하기",
};

export const PLAYER_ACTION_DESCRIPTIONS: Record<PlayerAction, string> = {
  make_case: "타겟이 왜 남아야 하는지 논리부터 세운다.",
  expose: "타겟에게 불리한 기록과 사실을 꺼내 몰아세운다.",
  appeal: "죄책감과 연민을 자극해 상대의 판단을 흔든다.",
  ally: "현재 대화상대와 한편이 되어 타겟을 고립시킨다.",
  deflect: "당신에게 온 책임과 시선을 타겟에게 돌린다.",
  stall: "판단을 미루고 다음 라운드까지 버틴다.",
  confess: "내 잘못을 먼저 인정해 나에게 몰린 압박을 낮춘다.",
};

export const PLAYER_ACTION_TARGET_MODES: Record<
  PlayerAction,
  "required" | "optional" | "ignored"
> = {
  make_case: "required",
  expose: "required",
  appeal: "optional",
  ally: "required",
  deflect: "required",
  stall: "ignored",
  confess: "ignored",
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
