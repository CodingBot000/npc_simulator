import type {
  NormalizedInteractionInput,
  PersistedNpcState,
  RelationshipDelta,
  RelationshipState,
  RippleEffect,
  SelectedAction,
} from "@/lib/types";
import { clamp, containsAny } from "@/lib/utils";

const playerActionEffects = {
  question: { trust: 0, affinity: 1, tension: 0 },
  persuade: { trust: 1, affinity: 0, tension: 1 },
  trade: { trust: 1, affinity: 1, tension: 0 },
  request: { trust: 0, affinity: 0, tension: 1 },
  empathize: { trust: 1, affinity: 2, tension: -1 },
  pressure: { trust: -1, affinity: -2, tension: 2 },
} as const;

const npcActionEffects = {
  answer: { trust: 1, affinity: 0, tension: -1 },
  ask_back: { trust: 0, affinity: 1, tension: 0 },
  refuse: { trust: -2, affinity: -1, tension: 2 },
  hint: { trust: 1, affinity: 1, tension: 0 },
  negotiate: { trust: 0, affinity: 1, tension: 0 },
  accept_request: { trust: 2, affinity: 1, tension: -1 },
  delay: { trust: -1, affinity: 0, tension: 1 },
} as const;

export function calculateRelationshipDelta(params: {
  normalizedInput: NormalizedInteractionInput;
  selectedAction: SelectedAction;
}) {
  const { normalizedInput, selectedAction } = params;
  const fromPlayer = normalizedInput.action
    ? playerActionEffects[normalizedInput.action]
    : { trust: 0, affinity: 0, tension: 0 };
  const fromNpc = npcActionEffects[selectedAction.type];

  const courtesyBonus = containsAny(normalizedInput.text, ["부탁", "고마워", "please"])
    ? { trust: 1, affinity: 1, tension: 0 }
    : { trust: 0, affinity: 0, tension: 0 };

  const pushyPenalty = containsAny(normalizedInput.text, ["당장", "빨리", "명령"])
    ? { trust: -1, affinity: -1, tension: 1 }
    : { trust: 0, affinity: 0, tension: 0 };

  return {
    trust: clamp(
      fromPlayer.trust + fromNpc.trust + courtesyBonus.trust + pushyPenalty.trust,
      -3,
      3,
    ),
    affinity: clamp(
      fromPlayer.affinity +
        fromNpc.affinity +
        courtesyBonus.affinity +
        pushyPenalty.affinity,
      -3,
      3,
    ),
    tension: clamp(
      fromPlayer.tension + fromNpc.tension + courtesyBonus.tension + pushyPenalty.tension,
      -3,
      3,
    ),
  } satisfies RelationshipDelta;
}

export function applyRelationshipDelta(
  relationship: RelationshipState,
  delta: RelationshipDelta,
) {
  return {
    ...relationship,
    playerTrust: clamp(relationship.playerTrust + delta.trust, 0, 100),
    playerAffinity: clamp(relationship.playerAffinity + delta.affinity, 0, 100),
    playerTension: clamp(relationship.playerTension + delta.tension, 0, 100),
  };
}

export function deriveRippleEffects(params: {
  npcs: PersistedNpcState[];
  sourceNpcId: string;
  normalizedInput: NormalizedInteractionInput;
  selectedAction: SelectedAction;
}) {
  const { npcs, sourceNpcId, normalizedInput, selectedAction } = params;
  const effects: RippleEffect[] = [];

  const mentionsMerchant = containsAny(normalizedInput.text, [
    "상인",
    "merchant",
    "소문",
    "창고",
  ]);

  if (sourceNpcId === "innkeeper" && mentionsMerchant && selectedAction.type !== "refuse") {
    effects.push({
      npcId: "guard",
      trust: 1,
      affinity: 1,
      tension: 0,
      note: "여관발 소문이 경비 쪽 경계선과 연결됐다.",
    });
  }

  if (
    sourceNpcId === "guard" &&
    selectedAction.type !== "refuse" &&
    (normalizedInput.action === "persuade" || mentionsMerchant)
  ) {
    effects.push({
      npcId: "guild_clerk",
      trust: 1,
      affinity: 0,
      tension: 0,
      note: "경비병 보고가 길드 데스크에 전달될 만한 분위기가 됐다.",
    });
  }

  if (normalizedInput.action === "pressure" || selectedAction.type === "refuse") {
    npcs
      .filter((npc) => npc.persona.id !== sourceNpcId)
      .forEach((npc) => {
        effects.push({
          npcId: npc.persona.id,
          trust: -1,
          affinity: -1,
          tension: 1,
          note: "플레이어의 강한 태도가 주변 인상에 부담으로 남았다.",
        });
      });
  }

  return effects;
}

export function applyRippleEffects(
  npcs: PersistedNpcState[],
  effects: RippleEffect[],
) {
  effects.forEach((effect) => {
    const target = npcs.find((npc) => npc.persona.id === effect.npcId);

    if (!target) {
      return;
    }

    target.relationship = applyRelationshipDelta(target.relationship, {
      trust: effect.trust,
      affinity: effect.affinity,
      tension: effect.tension,
    });
  });
}
