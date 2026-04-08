import {
  MAX_LONG_MEMORIES,
  MAX_RETRIEVED_MEMORIES,
  MAX_SHORT_MEMORIES,
} from "@/lib/constants";
import type {
  LlmInteractionResult,
  MemoryEntry,
  NormalizedInteractionInput,
  QuestUpdate,
  RelationshipDelta,
} from "@/lib/types";
import { clamp, extractTags, nowIso, tokenize } from "@/lib/utils";

export function retrieveRelevantMemories(
  memories: MemoryEntry[],
  normalizedInput: NormalizedInteractionInput,
) {
  const queryTokens = new Set([
    ...tokenize(normalizedInput.text),
    ...(normalizedInput.action ? [normalizedInput.action] : []),
  ]);

  return [...memories]
    .sort((left, right) => scoreMemory(right, queryTokens) - scoreMemory(left, queryTokens))
    .slice(0, MAX_RETRIEVED_MEMORIES);
}

function scoreMemory(entry: MemoryEntry, queryTokens: Set<string>) {
  const overlap = entry.tags.filter((tag) => queryTokens.has(tag)).length;
  const recencyBonus =
    Date.now() - new Date(entry.timestamp).getTime() < 1000 * 60 * 60 * 24 ? 1 : 0;
  const scopeBonus = entry.scope === "long" ? 2 : 0;
  return overlap * 5 + entry.importance + recencyBonus + scopeBonus;
}

export function buildMemoryEntries(params: {
  npcName: string;
  normalizedInput: NormalizedInteractionInput;
  llmResult: LlmInteractionResult;
  relationshipDelta: RelationshipDelta;
  questUpdates: QuestUpdate[];
  existing: MemoryEntry[];
}) {
  const { npcName, normalizedInput, llmResult, relationshipDelta, questUpdates, existing } =
    params;
  const timestamp = nowIso();
  const summary = `플레이어가 ${normalizedInput.promptSummary}를 시도했고 ${npcName}은 ${llmResult.selectedAction.reason}을 근거로 반응했다.`;
  const importance = clamp(
    3 +
      Math.abs(relationshipDelta.trust) +
      Math.abs(relationshipDelta.affinity) +
      Math.abs(relationshipDelta.tension) +
      questUpdates.length * 2,
    1,
    10,
  );
  const tags = extractTags(
    [
      normalizedInput.text,
      llmResult.reply.text,
      llmResult.intent.summary,
      questUpdates.map((update) => update.questId).join(" "),
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
          summary: `${npcName}은 이번 상호작용을 '${normalizedInput.promptSummary}'의 후속 단서로 기억한다.`,
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
