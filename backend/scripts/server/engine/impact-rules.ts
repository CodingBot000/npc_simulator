import { DEFAULT_PLAYER_ID } from "@backend-shared/constants";
import type {
  CandidateId,
  ImpactTag,
  JudgementDimensions,
  RelationshipDelta,
  StructuredImpactInference,
} from "@backend-shared/types";

type DimensionDelta = Partial<JudgementDimensions>;

const IMPACT_PRESSURE_DELTAS: Record<ImpactTag, DimensionDelta> = {
  player_distrust_up: { distrust: 3 },
  player_distrust_down: { distrust: -4 },
  player_blame_up: { blame: 4 },
  player_blame_down: { blame: -5 },
  player_sympathy_up: { sympathy: 4 },
  player_sympathy_down: { sympathy: -4 },
  target_blame_up: { blame: 5 },
  target_blame_high_up: { blame: 8, distrust: 2 },
  target_blame_down: { blame: -4 },
  target_distrust_up: { distrust: 5 },
  target_distrust_down: { distrust: -4 },
  target_hostility_up: { hostility: 4 },
  target_hostility_down: { hostility: -3 },
  target_sympathy_up: { sympathy: 4 },
  target_sympathy_down: { sympathy: -4 },
  target_utility_down: { utility: -5 },
  target_utility_up: { utility: 5 },
  target_dispensability_up: { dispensability: 5 },
  target_dispensability_down: { dispensability: -4 },
  room_pressure_shift: { blame: 2, distrust: 2 },
  no_major_shift: {},
};

const IMPACT_RELATIONSHIP_DELTAS: Record<ImpactTag, RelationshipDelta> = {
  player_distrust_up: { trust: -2, affinity: 0, tension: 2 },
  player_distrust_down: { trust: 2, affinity: 0, tension: -1 },
  player_blame_up: { trust: -1, affinity: 0, tension: 1 },
  player_blame_down: { trust: 1, affinity: 0, tension: -1 },
  player_sympathy_up: { trust: 0, affinity: 2, tension: -1 },
  player_sympathy_down: { trust: 0, affinity: -1, tension: 1 },
  target_blame_up: { trust: 0, affinity: 0, tension: 1 },
  target_blame_high_up: { trust: 0, affinity: 0, tension: 2 },
  target_blame_down: { trust: 0, affinity: 1, tension: -1 },
  target_distrust_up: { trust: 0, affinity: 0, tension: 1 },
  target_distrust_down: { trust: 0, affinity: 0, tension: -1 },
  target_hostility_up: { trust: 0, affinity: 0, tension: 1 },
  target_hostility_down: { trust: 0, affinity: 0, tension: -1 },
  target_sympathy_up: { trust: 0, affinity: 1, tension: -1 },
  target_sympathy_down: { trust: 0, affinity: -1, tension: 1 },
  target_utility_down: { trust: 0, affinity: 0, tension: 1 },
  target_utility_up: { trust: 0, affinity: 1, tension: -1 },
  target_dispensability_up: { trust: 0, affinity: 0, tension: 1 },
  target_dispensability_down: { trust: 0, affinity: 1, tension: -1 },
  room_pressure_shift: { trust: 0, affinity: 0, tension: 1 },
  no_major_shift: { trust: 0, affinity: 0, tension: 0 },
};

const IMPACT_FACTOR_LABELS: Record<ImpactTag, string> = {
  player_distrust_up: "LLM 구조화 추론: 플레이어 불신 상승",
  player_distrust_down: "LLM 구조화 추론: 플레이어 불신 하락",
  player_blame_up: "LLM 구조화 추론: 플레이어 책임 상승",
  player_blame_down: "LLM 구조화 추론: 플레이어 책임 하락",
  player_sympathy_up: "LLM 구조화 추론: 플레이어 연민 상승",
  player_sympathy_down: "LLM 구조화 추론: 플레이어 연민 하락",
  target_blame_up: "LLM 구조화 추론: 타깃 책임 상승",
  target_blame_high_up: "LLM 구조화 추론: 타깃 책임 급상승",
  target_blame_down: "LLM 구조화 추론: 타깃 책임 하락",
  target_distrust_up: "LLM 구조화 추론: 타깃 불신 상승",
  target_distrust_down: "LLM 구조화 추론: 타깃 불신 하락",
  target_hostility_up: "LLM 구조화 추론: 타깃 적대 상승",
  target_hostility_down: "LLM 구조화 추론: 타깃 적대 하락",
  target_sympathy_up: "LLM 구조화 추론: 타깃 연민 상승",
  target_sympathy_down: "LLM 구조화 추론: 타깃 연민 하락",
  target_utility_down: "LLM 구조화 추론: 타깃 생존 필요성 하락",
  target_utility_up: "LLM 구조화 추론: 타깃 생존 필요성 상승",
  target_dispensability_up: "LLM 구조화 추론: 타깃 대체 가능성 상승",
  target_dispensability_down: "LLM 구조화 추론: 타깃 대체 가능성 하락",
  room_pressure_shift: "LLM 구조화 추론: 방 전체 압력 이동",
  no_major_shift: "LLM 구조화 추론: 큰 판세 변화 없음",
};

function addDimensionDelta(
  current: DimensionDelta,
  delta: DimensionDelta,
) {
  return {
    blame: (current.blame ?? 0) + (delta.blame ?? 0),
    distrust: (current.distrust ?? 0) + (delta.distrust ?? 0),
    hostility: (current.hostility ?? 0) + (delta.hostility ?? 0),
    dispensability: (current.dispensability ?? 0) + (delta.dispensability ?? 0),
    utility: (current.utility ?? 0) + (delta.utility ?? 0),
    sympathy: (current.sympathy ?? 0) + (delta.sympathy ?? 0),
  } satisfies DimensionDelta;
}

function addRelationshipDelta(
  current: RelationshipDelta,
  delta: RelationshipDelta,
) {
  return {
    trust: current.trust + delta.trust,
    affinity: current.affinity + delta.affinity,
    tension: current.tension + delta.tension,
  } satisfies RelationshipDelta;
}

function targetForImpactTag(tag: ImpactTag, targetNpcId: string | null) {
  if (tag.startsWith("player_")) {
    return DEFAULT_PLAYER_ID;
  }

  if (tag.startsWith("target_") || tag === "room_pressure_shift") {
    return targetNpcId;
  }

  return null;
}

export function buildStructuredImpactPressureAdjustments(params: {
  structuredImpact: StructuredImpactInference;
  targetNpcId: string | null;
}) {
  const byCandidate = new Map<
    CandidateId,
    { dimensionDelta: DimensionDelta; factors: string[] }
  >();

  for (const tag of params.structuredImpact.impactTags) {
    const candidateId = targetForImpactTag(tag, params.targetNpcId);

    if (!candidateId || tag === "no_major_shift") {
      continue;
    }

    const current = byCandidate.get(candidateId) ?? {
      dimensionDelta: {},
      factors: [],
    };

    byCandidate.set(candidateId, {
      dimensionDelta: addDimensionDelta(
        current.dimensionDelta,
        IMPACT_PRESSURE_DELTAS[tag],
      ),
      factors: Array.from(new Set([...current.factors, IMPACT_FACTOR_LABELS[tag]])),
    });
  }

  return byCandidate;
}

export function buildRelationshipDeltaFromImpact(
  structuredImpact: StructuredImpactInference,
) {
  return structuredImpact.impactTags.reduce<RelationshipDelta>(
    (current, tag) =>
      addRelationshipDelta(current, IMPACT_RELATIONSHIP_DELTAS[tag]),
    { trust: 0, affinity: 0, tension: 0 },
  );
}
