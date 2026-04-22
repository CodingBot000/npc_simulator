import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
  EMOTION_LABELS,
  NPC_ACTION_LABELS,
  PRESSURE_DIMENSION_LABELS,
  PLAYER_ACTION_LABELS,
  PLAYER_ACTION_TARGET_MODES,
} from "@/lib/constants";
import type {
  AllowedActionType,
  CandidateId,
  ConsensusBoardEntry,
  EmotionPrimary,
  JudgementDimensions,
  PlayerAction,
  RelationshipState,
} from "@/lib/types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function extractTags(lines: string[], fallback: string[] = []) {
  const tokens = lines.flatMap((line) => tokenize(line));
  return uniqueStrings([...fallback, ...tokens]).slice(0, 8);
}

export function actionLabel(
  action: PlayerAction | AllowedActionType | null | undefined,
) {
  if (!action) {
    return "대화";
  }

  if (action in PLAYER_ACTION_LABELS) {
    return PLAYER_ACTION_LABELS[action as PlayerAction];
  }

  return NPC_ACTION_LABELS[action as AllowedActionType];
}

export function formatPlayerConversationText(params: {
  text: string;
  action: PlayerAction | null | undefined;
  targetLabel: string | null;
}) {
  const spokenText = params.text.trim();
  if (spokenText) {
    return spokenText;
  }

  if (!params.action) {
    return "짧게 숨을 고르며 방 안의 시선을 읽었다.";
  }

  const label = actionLabel(params.action);
  const targetMode = PLAYER_ACTION_TARGET_MODES[params.action];

  if (params.targetLabel && (targetMode === "required" || targetMode === "optional")) {
    return `${label} - 공격타겟 : ${params.targetLabel}`;
  }

  return label;
}

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

export function formatDelta(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return `${value}`;
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

export function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((accumulator, item) => {
    const key = getKey(item);
    accumulator[key] ??= [];
    accumulator[key].push(item);
    return accumulator;
  }, {});
}

export function containsAny(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function stripCodeFence(text: string) {
  return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function candidateLabel(
  candidateId: CandidateId,
  namesById: Record<string, string>,
) {
  if (candidateId === DEFAULT_PLAYER_ID) {
    return DEFAULT_PLAYER_LABEL;
  }

  return namesById[candidateId] ?? candidateId;
}

export function pressureSummary(entry: ConsensusBoardEntry) {
  if (entry.totalPressure >= 90) {
    return "즉시 희생 가능성 매우 높음";
  }

  if (entry.totalPressure >= 70) {
    return "방 안의 시선이 빠르게 몰리는 중";
  }

  if (entry.totalPressure >= 50) {
    return "위험권 진입";
  }

  return "아직 결정적 고립은 아님";
}

export function formatDimensionDelta(
  delta: Partial<JudgementDimensions>,
  options: { omitZero?: boolean } = {},
) {
  return (Object.keys(PRESSURE_DIMENSION_LABELS) as Array<keyof JudgementDimensions>)
    .filter((key) => {
      if (!options.omitZero) {
        return true;
      }

      return (delta[key] ?? 0) !== 0;
    })
    .map((key) => `${PRESSURE_DIMENSION_LABELS[key]} ${formatDelta(delta[key] ?? 0)}`)
    .join(" / ");
}
