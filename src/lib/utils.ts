import {
  EMOTION_LABELS,
  NPC_ACTION_LABELS,
  PLAYER_ACTION_LABELS,
} from "@/lib/constants";
import type {
  AllowedActionType,
  EmotionPrimary,
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
  return uniqueStrings([...fallback, ...tokens]).slice(0, 6);
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

export function emotionLabel(primary: EmotionPrimary) {
  return EMOTION_LABELS[primary];
}

export function relationshipSummary(relationship: RelationshipState) {
  if (relationship.playerTrust >= 68) {
    return "신뢰 높음";
  }

  if (relationship.playerTrust >= 50) {
    return "탐색 중";
  }

  if (relationship.playerTension >= 55) {
    return "긴장 높음";
  }

  return "거리 두는 중";
}

export function formatDelta(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return `${value}`;
}

export function formatTimestampShort(timestamp: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
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
