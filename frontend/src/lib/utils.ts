import { EMOTION_LABELS } from "@/lib/constants";
import type {
  EmotionPrimary,
  RelationshipState,
  ScenarioScoringSnapshot,
  WorldSnapshot,
} from "@/lib/types";
export {
  actionLabel,
  candidateLabel,
  clamp,
  containsAny,
  extractTags,
  formatDelta,
  formatDimensionDelta,
  formatPlayerConversationText,
  groupBy,
  nowIso,
  pressureSummary,
  safeJsonParse,
  stripCodeFence,
  tokenize,
  uniqueStrings,
} from "@sim-shared/utils";

export function emotionLabel(primary: EmotionPrimary) {
  return EMOTION_LABELS[primary];
}

export function relationshipSummary(relationship: RelationshipState) {
  if (relationship.playerTrust >= 68 && relationship.playerTension <= 30) {
    return "한쪽으로 기우는 중";
  }

  if (relationship.playerTension >= 60) {
    return "당신을 경계함";
  }

  if (relationship.playerAffinity >= 55) {
    return "감정적으로 흔들리는 중";
  }

  return "판단을 유보 중";
}

export function formatTimestampShort(timestamp: string) {
  const source = new Date(timestamp);

  if (Number.isNaN(source.getTime())) {
    return "--.-- --:--";
  }

  const kst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const hour = String(kst.getUTCHours()).padStart(2, "0");
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");

  return `${month}.${day} ${hour}:${minute}`;
}

export function hasScenarioScoring(
  scoring: ScenarioScoringSnapshot | null | undefined,
): scoring is ScenarioScoringSnapshot {
  return Boolean(
    scoring &&
      Number.isFinite(scoring.minRoundsBeforeResolution) &&
      Number.isFinite(scoring.maxRounds) &&
      Number.isFinite(scoring.instantConsensusVotes) &&
      Number.isFinite(scoring.leadGapThreshold),
  );
}

export function mergeWorldSnapshotScoring(
  snapshot: WorldSnapshot,
  fallbackScoring: ScenarioScoringSnapshot | null | undefined,
) {
  if (hasScenarioScoring(snapshot.scoring) || !hasScenarioScoring(fallbackScoring)) {
    return snapshot;
  }

  return {
    ...snapshot,
    scoring: fallbackScoring,
  } satisfies WorldSnapshot;
}
