import {
  MAX_LONG_MEMORIES,
  MAX_RETRIEVED_MEMORIES,
  MAX_SHORT_MEMORIES,
} from "@backend-shared/constants";
import type {
  LlmInteractionResult,
  MemoryEntry,
  PressureChange,
  RetrievalScoreBreakdown,
  RetrievedMemoryEntry,
  RelationshipDelta,
  ResolutionState,
} from "@backend-shared/api-contract-types";
import type { NormalizedInteractionInput } from "@backend-shared/provider-types";
import { clamp, extractTags, nowIso, tokenize } from "@backend-shared/utils";

export function retrieveRelevantMemories(
  memories: MemoryEntry[],
  normalizedInput: NormalizedInteractionInput,
) {
  const queryTokens = new Set([
    ...tokenize(normalizedInput.text),
    ...(normalizedInput.action ? [normalizedInput.action] : []),
  ]);

  return [...memories]
    .map((entry) => withMemoryRetrievalScore(entry, queryTokens))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RETRIEVED_MEMORIES);
}

function scoreMemory(entry: MemoryEntry, queryTokens: Set<string>): RetrievalScoreBreakdown {
  const overlap = entry.tags.filter((tag) => queryTokens.has(tag)).length;
  const recencyBonus =
    Date.now() - new Date(entry.timestamp).getTime() < 1000 * 60 * 60 * 24 ? 1 : 0;
  const scopeBonus = entry.scope === "long" ? 2 : 0;
  const total = overlap * 5 + entry.importance + recencyBonus + scopeBonus;

  return {
    tokenOverlap: overlap,
    tagOverlap: overlap,
    recency: recencyBonus,
    importance: entry.importance + scopeBonus,
    priority: 0,
    npcMatch: 0,
    targetMatch: 0,
    eventMatch: 0,
    total,
  };
}

function memoryMatchReasons(entry: MemoryEntry, score: RetrievalScoreBreakdown) {
  return [
    score.tagOverlap > 0 ? `태그 ${score.tagOverlap}개가 입력과 겹침` : null,
    entry.scope === "long" ? "장기 기억 가중치" : "최근 경험 기억",
    `중요도 ${entry.importance}`,
    score.recency > 0 ? "24시간 내 형성된 기억" : null,
  ].filter(Boolean) as string[];
}

function withMemoryRetrievalScore(
  entry: MemoryEntry,
  queryTokens: Set<string>,
): RetrievedMemoryEntry {
  const scoreBreakdown = scoreMemory(entry, queryTokens);

  return {
    ...entry,
    score: scoreBreakdown.total,
    scoreBreakdown,
    matchReasons: memoryMatchReasons(entry, scoreBreakdown),
  };
}

export function buildMemoryEntries(params: {
  npcName: string;
  normalizedInput: NormalizedInteractionInput;
  llmResult: LlmInteractionResult;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  resolution: ResolutionState;
  existing: MemoryEntry[];
}) {
  const {
    npcName,
    normalizedInput,
    llmResult,
    relationshipDelta,
    pressureChanges,
    resolution,
    existing,
  } = params;
  const timestamp = nowIso();
  const summary = `플레이어가 ${normalizedInput.promptSummary}를 시도했고 ${npcName}은 ${llmResult.selectedAction.reason}을 근거로 반응했다.`;
  const importance = clamp(
    3 +
      Math.abs(relationshipDelta.trust) +
      Math.abs(relationshipDelta.affinity) +
      Math.abs(relationshipDelta.tension) +
      pressureChanges.reduce((acc, entry) => acc + Math.abs(entry.totalPressureDelta), 0) / 6 +
      (resolution.resolved ? 4 : 0),
    1,
    10,
  );
  const tags = extractTags(
    [
      normalizedInput.text,
      llmResult.reply.text,
      llmResult.intent.summary,
      llmResult.structuredImpact.rationale,
      llmResult.structuredImpact.impactTags.join(" "),
      pressureChanges.map((entry) => entry.candidateId).join(" "),
      resolution.summary ?? "",
    ],
    [llmResult.selectedAction.type],
  );

  const shortMemory: MemoryEntry = {
    id: crypto.randomUUID(),
    scope: "short",
    summary,
    tags,
    importance,
    timestamp,
  };

  const repeatedTag = existing.some((memory) =>
    memory.tags.some((tag) => shortMemory.tags.includes(tag)),
  );

  const promotedMemory =
    importance >= 7 || repeatedTag
      ? {
          id: crypto.randomUUID(),
          scope: "long" as const,
          summary: resolution.resolved
            ? `${npcName}은 이번 대화를 희생 대상이 굳어진 분기점으로 기억한다.`
            : `${npcName}은 이번 대화를 방 안의 희생 압력이 이동한 순간으로 기억한다.`,
          tags: shortMemory.tags.slice(0, 4),
          importance: clamp(importance - 1, 1, 10),
          timestamp,
        }
      : null;

  return promotedMemory ? [shortMemory, promotedMemory] : [shortMemory];
}

export function updateMemoryBank(
  current: MemoryEntry[],
  nextEntries: MemoryEntry[],
) {
  const shortEntries = [...current, ...nextEntries]
    .filter((entry) => entry.scope === "short")
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, MAX_SHORT_MEMORIES);

  const longEntries = [...current, ...nextEntries]
    .filter((entry) => entry.scope === "long")
    .sort((left, right) => {
      if (right.importance !== left.importance) {
        return right.importance - left.importance;
      }

      return right.timestamp.localeCompare(left.timestamp);
    })
    .slice(0, MAX_LONG_MEMORIES);

  return [...longEntries, ...shortEntries];
}
