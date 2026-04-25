import { MAX_RETRIEVED_KNOWLEDGE } from "@backend-support/constants";
import type {
  EventLogEntry,
  RetrievalScoreBreakdown,
  RetrievedKnowledgeEvidence,
} from "@backend-contracts/api";
import type { KnowledgeEvidence } from "@backend-domain";
import type { NormalizedInteractionInput } from "@backend-provider";
import { tokenize, uniqueStrings } from "@backend-support/utils";
import { retrieveRelevantMemories } from "@server/engine/memory";
import { getCurrentScenario } from "@server/scenario";

function queryTokensForInput(input: NormalizedInteractionInput) {
  return new Set(
    uniqueStrings([
      ...tokenize(input.text),
      ...tokenize(input.promptSummary),
      ...(input.action ? [input.action] : []),
      ...(input.actionLabel ? tokenize(input.actionLabel) : []),
    ]),
  );
}

function scoreEvidence(params: {
  evidence: KnowledgeEvidence;
  queryTokens: Set<string>;
  queryText: string;
  npcId: string;
  targetNpcId: string | null;
  recentEvents: EventLogEntry[];
  roundNumber: number;
}): RetrievalScoreBreakdown {
  const tokenOverlap = params.evidence.tags.filter((tag) => {
    return params.queryTokens.has(tag) || params.queryText.includes(tag.toLowerCase());
  }).length;
  const tagOverlap = params.evidence.tags.filter((tag) => params.queryTokens.has(tag)).length;
  const npcMatch = params.evidence.relatedNpcIds.includes(params.npcId) ? 3 : 0;
  const targetMatch =
    params.targetNpcId && params.evidence.relatedNpcIds.includes(params.targetNpcId) ? 5 : 0;
  const eventMatch = params.recentEvents.some((event) =>
    event.tags.some((tag) => params.evidence.tags.includes(tag)),
  )
    ? 3
    : 0;
  const recency =
    params.evidence.roundIntroduced !== null &&
    params.evidence.roundIntroduced <= params.roundNumber &&
    params.roundNumber - params.evidence.roundIntroduced <= 1
      ? 2
      : 0;
  const gatedFuturePenalty =
    params.evidence.roundIntroduced !== null &&
    params.evidence.roundIntroduced > params.roundNumber + 1
      ? -2
      : 0;
  const priority = params.evidence.priority;
  const total =
    tokenOverlap * 4 +
    tagOverlap * 3 +
    npcMatch +
    targetMatch +
    eventMatch +
    recency +
    priority +
    gatedFuturePenalty;

  return {
    tokenOverlap,
    tagOverlap,
    recency,
    importance: 0,
    priority,
    npcMatch,
    targetMatch,
    eventMatch,
    total,
  };
}

function evidenceMatchReasons(
  evidence: KnowledgeEvidence,
  score: RetrievalScoreBreakdown,
) {
  return [
    score.tokenOverlap > 0 ? `입력/태그 겹침 ${score.tokenOverlap}` : null,
    score.targetMatch > 0 ? "현재 논의 대상과 직접 관련" : null,
    score.npcMatch > 0 ? "발화 NPC의 편향/역할과 관련" : null,
    score.eventMatch > 0 ? "최근 라운드 이벤트와 연결" : null,
    score.recency > 0 ? "방금 공개된 사건과 가까움" : null,
    `${evidence.sourceType} 우선도 ${evidence.priority}`,
  ].filter(Boolean) as string[];
}

export function retrieveRelevantKnowledge(params: {
  normalizedInput: NormalizedInteractionInput;
  npcId: string;
  targetNpcId: string | null;
  recentEvents: EventLogEntry[];
  roundNumber: number;
}) {
  const scenario = getCurrentScenario();
  const queryTokens = queryTokensForInput(params.normalizedInput);
  const queryText = [
    params.normalizedInput.text,
    params.normalizedInput.promptSummary,
    params.normalizedInput.action ?? "",
    params.normalizedInput.actionLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return scenario.knowledge
    .map<RetrievedKnowledgeEvidence>((evidence) => {
      const scoreBreakdown = scoreEvidence({
        evidence,
        queryTokens,
        queryText,
        npcId: params.npcId,
        targetNpcId: params.targetNpcId,
        recentEvents: params.recentEvents,
        roundNumber: params.roundNumber,
      });

      return {
        ...evidence,
        score: scoreBreakdown.total,
        scoreBreakdown,
        matchReasons: evidenceMatchReasons(evidence, scoreBreakdown),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RETRIEVED_KNOWLEDGE);
}

export function retrieveEvidenceBundle(params: {
  memories: Parameters<typeof retrieveRelevantMemories>[0];
  normalizedInput: NormalizedInteractionInput;
  npcId: string;
  targetNpcId: string | null;
  recentEvents: EventLogEntry[];
  roundNumber: number;
}) {
  return {
    memories: retrieveRelevantMemories(params.memories, params.normalizedInput),
    knowledge: retrieveRelevantKnowledge({
      normalizedInput: params.normalizedInput,
      npcId: params.npcId,
      targetNpcId: params.targetNpcId,
      recentEvents: params.recentEvents,
      roundNumber: params.roundNumber,
    }),
  };
}
