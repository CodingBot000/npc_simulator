import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
} from "./constants";

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

export { DEFAULT_PLAYER_ID, DEFAULT_PLAYER_LABEL };
