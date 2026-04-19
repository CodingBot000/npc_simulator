/**
 * action-rules.ts
 *
 * This file defines the baseline effect of each player action before NPC personality
 * bias or round-phase pressure is applied.
 * Read this file when you want to answer:
 * - "What does `expose` do at the raw rules level?"
 * - "How is `appeal` different from `confess` before character-specific modifiers?"
 * - "What is the default relationship impact of each action?"
 *
 * This is the "action physics" layer of the pressure model. It should explain the
 * base movement of blame, distrust, sympathy, and relationship tension in the most
 * direct form possible.
 *
 * Last updated: 2026-04-09
 */

import type { PlayerAction, RelationshipDelta } from "@/lib/types";
import type { PressureActionRule } from "@server/engine/pressure-rule-types";

export const ACCUSATORY_ACTIONS: PlayerAction[] = ["make_case", "expose", "ally", "deflect"];

export const ACTION_PRESSURE_RULES: Record<PlayerAction, PressureActionRule> = {
  make_case: {
    playerDelta: { distrust: 1 },
    targetDelta: { blame: 6, dispensability: 8, hostility: 2 },
    notes: {
      player: "타인을 논리로 몰아갈수록 당신의 계산성도 함께 노출된다.",
      target: "이 행동은 특정 인물을 '남아도 되는 사람'으로 규정하려 든다.",
    },
  },
  expose: {
    playerDelta: { distrust: 1, hostility: 1 },
    targetDelta: { blame: 10, distrust: 12, hostility: 4 },
    notes: {
      player: "폭로는 칼이지만, 그것을 드는 사람도 위험하게 보일 수 있다.",
      target: "숨겨진 기록이 드러나면 책임과 불신이 함께 오른다.",
    },
  },
  appeal: {
    playerDelta: { sympathy: 2, distrust: -1 },
    targetDelta: { sympathy: 6, utility: 2, blame: -2 },
    notes: {
      player: "감정 호소는 당신을 조금 더 인간적으로 보이게 만든다.",
      target: "감정 호소는 특정 인물을 즉시 버리기 어렵게 만든다.",
    },
  },
  ally: {
    playerDelta: { sympathy: 1, distrust: 1 },
    targetDelta: { hostility: 8, blame: 4, sympathy: -2 },
    notes: {
      player: "동맹 시도는 의도를 분명히 드러내는 만큼 계산도 읽히게 한다.",
      target: "둘이 손잡는 순간 제3자는 훨씬 더 빨리 고립된다.",
    },
  },
  deflect: {
    playerDelta: { blame: -4, distrust: -3 },
    targetDelta: { blame: 8, distrust: 7, hostility: 2 },
    notes: {
      player: "성공하면 당신 쪽 책임선을 떼어낼 수 있다.",
      target: "책임 전가는 타깃을 새 중심 책임선으로 밀어 넣는다.",
    },
  },
  stall: {
    playerDelta: { distrust: 3, hostility: 1 },
    targetDelta: {},
    notes: {
      player: "결정을 미루면 방 안의 시선이 회피하는 사람에게 몰린다.",
      target: "직접 타깃은 없지만 압박은 방 전체에 남는다.",
    },
  },
  confess: {
    playerDelta: { blame: 3, distrust: -6, sympathy: 5 },
    targetDelta: {},
    notes: {
      player: "부분 자백은 책임을 조금 올리지만 불신을 크게 낮출 수 있다.",
      target: "직접 타깃은 없지만 방 안의 도덕 판단 기준이 흔들린다.",
    },
  },
};

export const BASE_RELATIONSHIP_DELTAS: Record<PlayerAction, RelationshipDelta> = {
  make_case: { trust: 1, affinity: 0, tension: 1 },
  expose: { trust: 1, affinity: 0, tension: 2 },
  appeal: { trust: 0, affinity: 1, tension: 0 },
  ally: { trust: 1, affinity: 1, tension: 1 },
  deflect: { trust: 0, affinity: 0, tension: 1 },
  stall: { trust: -1, affinity: 0, tension: 2 },
  confess: { trust: 1, affinity: 1, tension: 0 },
};
