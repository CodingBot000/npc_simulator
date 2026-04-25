import {
  PLAYER_ACTION_DESCRIPTIONS,
  PLAYER_ACTION_LABELS,
} from "@backend-shared/constants";
import type { PlayerAction } from "@sim-shared/types";

export interface PlayerActionSpec {
  id: PlayerAction;
  label: string;
  description: string;
  canonicalIntent: string;
  targetPolicy: "required" | "optional" | "ignored";
  actionOnlyFrame: (targetLabel: string | null) => string;
  combinedBias: (targetLabel: string | null) => string;
  replyAlignmentKeywords: string[];
  structuredImpactKeywords: string[];
  fallbackReplyHint: string;
}

function targetOrSomeone(targetLabel: string | null) {
  return targetLabel?.trim() || "그 사람";
}

export const PLAYER_ACTION_SPECS: Record<PlayerAction, PlayerActionSpec> = {
  make_case: {
    id: "make_case",
    label: PLAYER_ACTION_LABELS.make_case,
    description: PLAYER_ACTION_DESCRIPTIONS.make_case,
    canonicalIntent: "특정 인물의 책임선과 판단 근거를 세우려 한다.",
    targetPolicy: "required",
    actionOnlyFrame: (targetLabel) =>
      `플레이어는 ${targetOrSomeone(targetLabel)}의 책임을 따질 근거선을 세우려 했다.`,
    combinedBias: (targetLabel) =>
      `${targetOrSomeone(targetLabel)}의 책임을 따지는 방향으로 판세를 몰아가려 했다.`,
    replyAlignmentKeywords: ["책임", "근거", "이유", "기준", "판단", "남아야"],
    structuredImpactKeywords: ["target_blame", "target_distrust", "room_pressure_shift"],
    fallbackReplyHint: "책임선과 근거를 분명히 묻는 반응",
  },
  expose: {
    id: "expose",
    label: PLAYER_ACTION_LABELS.expose,
    description: PLAYER_ACTION_DESCRIPTIONS.expose,
    canonicalIntent: "숨은 기록과 사실을 들춰 특정 인물의 위험을 올리려 한다.",
    targetPolicy: "required",
    actionOnlyFrame: (targetLabel) =>
      `플레이어는 ${targetOrSomeone(targetLabel)}에게 불리한 기록이나 숨은 사실을 들추려 했다.`,
    combinedBias: (targetLabel) =>
      `${targetOrSomeone(targetLabel)} 관련 기록과 사실을 꺼내 판세를 흔들려 했다.`,
    replyAlignmentKeywords: ["기록", "사실", "숨긴", "감춘", "증거", "들춘", "꺼내"],
    structuredImpactKeywords: ["target_blame", "target_distrust", "room_pressure_shift"],
    fallbackReplyHint: "기록과 사실 노출에 반응하는 말",
  },
  appeal: {
    id: "appeal",
    label: PLAYER_ACTION_LABELS.appeal,
    description: PLAYER_ACTION_DESCRIPTIONS.appeal,
    canonicalIntent: "양심, 죄책감, 연민을 건드려 말을 바꾸게 하려 한다.",
    targetPolicy: "optional",
    actionOnlyFrame: (targetLabel) =>
      targetLabel
        ? `플레이어는 ${targetLabel}를 둘러싼 죄책감과 연민을 건드려 말을 바꾸게 하려 했다.`
        : "플레이어는 방 안 사람들의 양심과 죄책감을 건드려 말을 바꾸게 하려 했다.",
    combinedBias: (targetLabel) =>
      targetLabel
        ? `${targetLabel}를 둘러싼 양심과 죄책감을 자극해 반응을 흔들려 했다.`
        : "양심과 연민을 자극해 판세를 흔들려 했다.",
    replyAlignmentKeywords: ["양심", "죄책감", "연민", "미안", "사람", "마음", "흔들"],
    structuredImpactKeywords: ["sympathy", "blame", "room_pressure_shift"],
    fallbackReplyHint: "정서적 압박에 반응하는 말",
  },
  ally: {
    id: "ally",
    label: PLAYER_ACTION_LABELS.ally,
    description: PLAYER_ACTION_DESCRIPTIONS.ally,
    canonicalIntent: "지금 상대와 한편이 되어 다른 사람을 고립시키려 한다.",
    targetPolicy: "required",
    actionOnlyFrame: (targetLabel) =>
      `플레이어는 지금 상대와 손잡고 ${targetOrSomeone(targetLabel)}를 더 고립시키려 했다.`,
    combinedBias: (targetLabel) =>
      `지금 상대와 한편이 되어 ${targetOrSomeone(targetLabel)}를 몰아가려 했다.`,
    replyAlignmentKeywords: ["같이", "한편", "편", "함께", "손잡", "같은 편", "공조"],
    structuredImpactKeywords: ["target_blame", "room_pressure_shift"],
    fallbackReplyHint: "편들기와 공조 제안에 대한 반응",
  },
  deflect: {
    id: "deflect",
    label: PLAYER_ACTION_LABELS.deflect,
    description: PLAYER_ACTION_DESCRIPTIONS.deflect,
    canonicalIntent: "자신에게 오는 책임과 시선을 다른 쪽으로 돌리려 한다.",
    targetPolicy: "required",
    actionOnlyFrame: (targetLabel) =>
      `플레이어는 자신에게 향한 책임과 시선을 ${targetOrSomeone(targetLabel)} 쪽으로 돌리려 했다.`,
    combinedBias: (targetLabel) =>
      `${targetOrSomeone(targetLabel)} 쪽으로 책임의 방향을 옮기려 했다.`,
    replyAlignmentKeywords: ["책임", "화살", "시선", "왜", "돌리", "그쪽", "먼저"],
    structuredImpactKeywords: ["player_blame_down", "target_blame", "room_pressure_shift"],
    fallbackReplyHint: "책임 전가 시도에 대한 반응",
  },
  stall: {
    id: "stall",
    label: PLAYER_ACTION_LABELS.stall,
    description: PLAYER_ACTION_DESCRIPTIONS.stall,
    canonicalIntent: "당장 결정을 늦추고 다음 라운드까지 시간을 벌려 한다.",
    targetPolicy: "ignored",
    actionOnlyFrame: () =>
      "플레이어는 지금 결론을 내리지 말고 한 턴 더 미루자고 압박했다.",
    combinedBias: () =>
      "지금 결론을 늦추고 한 번 더 확인하자는 방향으로 판세를 묶으려 했다.",
    replyAlignmentKeywords: ["지금은", "아직", "미루", "서두르", "한 번 더", "확인", "결론"],
    structuredImpactKeywords: ["no_major_shift"],
    fallbackReplyHint: "결론 유예와 시간 벌기에 대한 반응",
  },
  confess: {
    id: "confess",
    label: PLAYER_ACTION_LABELS.confess,
    description: PLAYER_ACTION_DESCRIPTIONS.confess,
    canonicalIntent: "작은 잘못을 먼저 인정해 더 큰 불신을 막으려 한다.",
    targetPolicy: "ignored",
    actionOnlyFrame: () =>
      "플레이어는 작은 잘못부터 인정하며 더 큰 불신을 막으려 했다.",
    combinedBias: () =>
      "작은 잘못을 먼저 인정해 판세를 누그러뜨리려 했다.",
    replyAlignmentKeywords: ["인정", "실수", "잘못", "솔직", "고백", "숨기", "부분은 맞"],
    structuredImpactKeywords: ["player_blame_down", "player_sympathy_up"],
    fallbackReplyHint: "부분 인정과 솔직함에 대한 반응",
  },
};
