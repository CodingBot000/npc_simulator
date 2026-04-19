/**
 * bias-profiles.ts
 *
 * This file defines how each NPC evaluator bends the baseline action rules according
 * to personality, prejudice, role, and prior values.
 * Read this file when you want to answer:
 * - "Why does the doctor react more strongly to confession than the supervisor?"
 * - "Which targets does the engineer already distrust before the scene starts?"
 * - "What character-specific modifiers apply on top of the base action effect?"
 *
 * This is the "people react differently" layer of the pressure model. The goal is to
 * keep every character's bias readable as data instead of burying it inside conditionals.
 *
 * Last updated: 2026-04-09
 */

import { DEFAULT_PLAYER_ID } from "@/lib/constants";
import type { EvaluatorReactionProfile } from "@server/engine/pressure-rule-types";

export const EVALUATOR_REACTION_PROFILES: Record<string, EvaluatorReactionProfile> = {
  director: {
    id: "director",
    label: "연구 성과와 지휘 체계 우선",
    actionScale: {
      player: { appeal: 0.82, stall: 0.9, confess: 0.92 },
      target: { make_case: 1.05, deflect: 1.08, expose: 0.94 },
    },
    targetScale: {
      [DEFAULT_PLAYER_ID]: 1.12,
      supervisor: 1.15,
    },
    dimensionBias: {
      dispensability: 1.18,
      utility: 1.28,
      sympathy: 0.78,
    },
    relationshipAdjustment: {
      appeal: { trust: -1, affinity: -1, tension: 1 },
      stall: { trust: -1, affinity: 0, tension: 1 },
    },
    specialModifiers: [
      {
        id: "director-supervisor-deflect",
        note: "연구소장은 감독관 쪽으로 책임선을 미는 말에 쉽게 올라탄다.",
        scale: 1.12,
        appliesTo: "target",
        actions: ["deflect", "make_case"],
        targetIds: ["supervisor"],
      },
    ],
  },
  supervisor: {
    id: "supervisor",
    label: "법적 리스크와 대체 가능성 우선",
    actionScale: {
      player: { expose: 1.08, deflect: 1.1, appeal: 0.84, confess: 0.88 },
      target: { expose: 1.18, deflect: 1.14, appeal: 0.9 },
    },
    targetScale: {
      [DEFAULT_PLAYER_ID]: 1.18,
      doctor: 1.12,
      director: 1.06,
    },
    dimensionBias: {
      distrust: 1.3,
      dispensability: 1.25,
      sympathy: 0.7,
    },
    relationshipAdjustment: {
      expose: { trust: 1, affinity: 0, tension: 1 },
      appeal: { trust: -1, affinity: 0, tension: 0 },
      deflect: { trust: 0, affinity: -1, tension: 1 },
    },
    specialModifiers: [
      {
        id: "supervisor-director-expose",
        note: "감독관은 문서로 소장을 묶는 폭로에 특히 민감하다.",
        scale: 1.1,
        appliesTo: "target",
        actions: ["expose"],
        targetIds: ["director"],
      },
    ],
  },
  engineer: {
    id: "engineer",
    label: "현장 기술과 실사용 가치 우선",
    actionScale: {
      player: { expose: 1.05, ally: 1.1, stall: 1.16 },
      target: { expose: 1.08, ally: 1.12, make_case: 1.06, stall: 1.16 },
    },
    targetScale: {
      director: 1.24,
      supervisor: 1.24,
    },
    dimensionBias: {
      blame: 1.22,
      hostility: 1.16,
      utility: 1.18,
    },
    relationshipAdjustment: {
      expose: { trust: 1, affinity: 1, tension: 0 },
      ally: { trust: 1, affinity: 1, tension: 0 },
      stall: { trust: 0, affinity: 0, tension: 1 },
    },
    specialModifiers: [
      {
        id: "engineer-management-dogpile",
        note: "엔지니어는 관리 책임이 있는 사람을 겨냥할 때 훨씬 가차없다.",
        scale: 1.14,
        appliesTo: "target",
        actions: ["make_case", "expose", "deflect", "ally"],
        targetIds: ["director", "supervisor"],
      },
    ],
  },
  doctor: {
    id: "doctor",
    label: "윤리와 진실 고백 우선",
    actionScale: {
      player: { appeal: 1.18, confess: 1.24, deflect: 0.72 },
      target: { appeal: 1.12, deflect: 1.14, expose: 1.05 },
    },
    targetScale: {
      director: 1.08,
    },
    dimensionBias: {
      blame: 1.12,
      sympathy: 1.24,
      distrust: 1.08,
      dispensability: 0.88,
    },
    relationshipAdjustment: {
      appeal: { trust: 1, affinity: 1, tension: -1 },
      confess: { trust: 2, affinity: 2, tension: -1 },
      deflect: { trust: -1, affinity: -1, tension: 1 },
    },
    specialModifiers: [
      {
        id: "doctor-confession-response",
        note: "의사는 계산된 방어보다 고백에 훨씬 크게 흔들린다.",
        scale: 1.12,
        appliesTo: "player",
        actions: ["confess", "appeal"],
      },
    ],
  },
};
