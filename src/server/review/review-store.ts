import fs from "node:fs/promises";
import path from "node:path";
import type {
  PairReviewDecision,
  PairReviewItemView,
  LlmSuggestedDecision,
  ReviewCandidateView,
  ReviewDashboardData,
  ReviewDatasetView,
  ReviewKind,
  ReviewMutationResult,
  ReviewPromptView,
  ReviewSourceView,
  SftReviewDecision,
  SftReviewItemView,
} from "@/lib/review-types";

const REVIEW_DIR = path.join(process.cwd(), "data", "review", "live");
const EVALS_DIR = path.join(process.cwd(), "data", "evals");

const REVIEW_FILES = {
  sft: {
    json: path.join(REVIEW_DIR, "human_review_sft_queue.json"),
    jsonl: path.join(REVIEW_DIR, "human_review_sft_queue.jsonl"),
  },
  pair: {
    json: path.join(REVIEW_DIR, "human_review_pair_queue.json"),
    jsonl: path.join(REVIEW_DIR, "human_review_pair_queue.jsonl"),
  },
} as const;

const PIPELINE_FILES = {
  judgedSft: path.join(EVALS_DIR, "judged", "judged-review-live.jsonl"),
  judgedPairs: path.join(EVALS_DIR, "preference", "candidate_pairs_live_gap1.jsonl"),
} as const;

type RawRecord = Record<string, unknown>;

function asObject(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown, limit = 6): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry : null))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildPromptView(rawPrompt: unknown): ReviewPromptView {
  const prompt = asObject(rawPrompt);
  const memories = Array.isArray(prompt.retrievedMemories)
    ? prompt.retrievedMemories
    : [];
  const knowledge = Array.isArray(prompt.retrievedKnowledge)
    ? prompt.retrievedKnowledge
    : [];

  return {
    episodeId: asString(prompt.episodeId),
    scenarioId: asString(prompt.scenarioId) ?? "unknown-scenario",
    turnIndex: asNumber(prompt.turnIndex),
    npcId: asString(prompt.npcId) ?? "unknown",
    targetNpcId: asString(prompt.targetNpcId),
    inputMode: asString(prompt.inputMode) ?? "free_text",
    playerText: asString(prompt.playerText) ?? "",
    normalizedInputSummary:
      asString(prompt.normalizedInputSummary) ?? asString(prompt.playerText) ?? "",
    promptContextSummary: asString(prompt.promptContextSummary),
    retrievedMemorySummaries: memories
      .map((entry) => asString(asObject(entry).summary))
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 4),
    retrievedKnowledgeTitles: knowledge
      .map((entry) => {
        const item = asObject(entry);
        return asString(item.title) ?? asString(item.summary);
      })
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 6),
  };
}

function buildSourceView(rawSource: unknown): ReviewSourceView {
  const source = asObject(rawSource);

  return {
    episodeId: asString(source.episodeId),
    scenarioId: asString(source.scenarioId) ?? "unknown-scenario",
    turnIndex: asNumber(source.turnIndex),
    npcId: asString(source.npcId) ?? "unknown",
    targetNpcId: asString(source.targetNpcId),
    strategyLabel: asString(source.strategyLabel),
    exportPath: asString(source.exportPath),
    sourceLabel: asString(source.sourceLabel),
  };
}

function buildJudgeView(rawJudge: unknown) {
  const judge = asObject(rawJudge);

  if (!Object.keys(judge).length) {
    return null;
  }

  return {
    responseQuality: asNumber(judge.responseQuality),
    structuredImpactQuality: asNumber(judge.structuredImpactQuality),
    groundingQuality: asNumber(judge.groundingQuality),
    personaConsistency: asNumber(judge.personaConsistency),
    inspectorUsefulness: asNumber(judge.inspectorUsefulness),
    verdict: asString(judge.verdict),
    reasons: asStringArray(judge.reasons),
  };
}

function buildLlmFirstPassView(rawLlm: unknown) {
  const llm = asObject(rawLlm);
  const scores = asObject(llm.scores);

  if (!Object.keys(llm).length) {
    return null;
  }

  return {
    provider: asString(llm.provider),
    suggestedDecision:
      (asString(llm.suggestedDecision) as LlmSuggestedDecision) ?? null,
    verdict: asString(llm.verdict),
    decision: asString(llm.decision),
    confidence: asNumber(llm.confidence),
    preferenceStrength: asNumber(llm.preferenceStrength),
    responseQuality: asNumber(scores.responseQuality),
    structuredImpactQuality: asNumber(scores.structuredImpactQuality),
    groundingQuality: asNumber(scores.groundingQuality),
    personaConsistency: asNumber(scores.personaConsistency),
    inspectorUsefulness: asNumber(scores.inspectorUsefulness),
    reasons: asStringArray(llm.reasons, 10),
    llmError: asString(llm.llmError),
  };
}

function buildCandidateView(rawCandidate: unknown): ReviewCandidateView {
  const candidate = asObject(rawCandidate);
  const candidateOutput = asObject(candidate.candidateOutput);
  const structuredImpact = asObject(candidate.structuredImpact);
  const fallbackStructuredImpact = asObject(candidateOutput.structuredImpact);
  const directImpactTags = asStringArray(structuredImpact.impactTags, 8);

  return {
    rowId: asString(candidate.rowId) ?? undefined,
    verdict: asString(candidate.verdict) ?? undefined,
    weightedScore:
      asNumber(candidate.weightedScore) ??
      asNumber(asObject(candidate.scores).weightedScore) ??
      undefined,
    replyText:
      asString(candidate.replyText) ??
      asString(candidateOutput.replyText) ??
      "",
    selectedAction:
      asString(candidate.selectedAction) ??
      asString(candidateOutput.selectedAction),
    selectedActionReason:
      asString(candidate.selectedActionReason) ??
      asString(candidateOutput.selectedActionReason) ??
      "",
    impactTags:
      directImpactTags.length > 0
        ? directImpactTags
        : asStringArray(fallbackStructuredImpact.impactTags, 8),
    targetNpcId:
      asString(structuredImpact.targetNpcId) ??
      asString(fallbackStructuredImpact.targetNpcId),
    rationale:
      asString(structuredImpact.rationale) ??
      asString(fallbackStructuredImpact.rationale) ??
      "",
  };
}

function buildSftItemView(raw: RawRecord): SftReviewItemView {
  return {
    kind: "sft",
    reviewId: asString(raw.reviewId) ?? "",
    bucket: asString(raw.bucket),
    priority: asString(raw.priority),
    status: asString(raw.status) ?? "pending",
    decision: (asString(raw.decision) as SftReviewDecision) ?? null,
    reviewer: asString(raw.reviewer),
    reviewedAt: asString(raw.reviewedAt),
    notes: asString(raw.notes) ?? "",
    queueReason: asString(raw.queueReason),
    source: buildSourceView(raw.source),
    judge: buildJudgeView(raw.judge),
    weightedJudgeScore: asNumber(raw.weightedJudgeScore),
    prompt: buildPromptView(raw.promptBundle),
    candidate: buildCandidateView(raw.candidateOutput),
    llmFirstPass: buildLlmFirstPassView(raw.llmFirstPass),
  };
}

function buildPairItemView(raw: RawRecord): PairReviewItemView {
  return {
    kind: "pair",
    reviewId: asString(raw.reviewId) ?? "",
    pairId: asString(raw.pairId) ?? "",
    priority: asString(raw.priority),
    status: asString(raw.status) ?? "pending",
    decision: (asString(raw.decision) as PairReviewDecision) ?? null,
    reviewer: asString(raw.reviewer),
    reviewedAt: asString(raw.reviewedAt),
    notes: asString(raw.notes) ?? "",
    weightedGap: asNumber(asObject(raw.candidatePair).weightedGap),
    pairReason: asStringArray(asObject(raw.candidatePair).pairReason, 8),
    prompt: buildPromptView(asObject(raw.candidatePair).promptBundle),
    chosen: buildCandidateView(asObject(raw.candidatePair).chosenCandidate),
    rejected: buildCandidateView(asObject(raw.candidatePair).rejectedCandidate),
    llmFirstPass: buildLlmFirstPassView(raw.llmFirstPass),
  };
}

async function readJsonArrayFile(filePath: string): Promise<RawRecord[]> {

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is RawRecord =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readJsonlArrayFile(filePath: string): Promise<RawRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (entry): entry is RawRecord =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeReviewFile(kind: ReviewKind, items: RawRecord[]) {
  const { json, jsonl } = REVIEW_FILES[kind];
  await fs.mkdir(path.dirname(json), { recursive: true });
  await fs.writeFile(json, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  const jsonlPayload = items.map((entry) => JSON.stringify(entry)).join("\n");
  await fs.writeFile(jsonl, jsonlPayload ? `${jsonlPayload}\n` : "", "utf8");
}

async function readReviewFile(kind: ReviewKind): Promise<RawRecord[]> {
  return readJsonArrayFile(REVIEW_FILES[kind].json);
}

function buildSourceViewFromPipelineRecord(raw: RawRecord): ReviewSourceView {
  const prompt = asObject(raw.promptBundle);
  const source = asObject(raw.source);

  return {
    episodeId: asString(prompt.episodeId),
    scenarioId: asString(prompt.scenarioId) ?? "unknown-scenario",
    turnIndex: asNumber(prompt.turnIndex),
    npcId: asString(prompt.npcId) ?? "unknown",
    targetNpcId: asString(prompt.targetNpcId),
    strategyLabel: null,
    exportPath: asString(source.path),
    sourceLabel: asString(source.label),
  };
}

function buildLlmFirstPassFromJudge(rawJudge: unknown) {
  const judge = asObject(rawJudge);
  const finalJudge = asObject(judge.final);

  if (!Object.keys(finalJudge).length) {
    return null;
  }

  const verdict = asString(finalJudge.verdict);
  let suggestedDecision: LlmSuggestedDecision = "escalate";

  if (verdict === "keep") {
    suggestedDecision = "include";
  } else if (verdict === "drop") {
    suggestedDecision = "exclude";
  } else if (verdict === "review") {
    suggestedDecision = "escalate";
  }

  const pairDecision = asString(finalJudge.decision);
  if (pairDecision === "include" || pairDecision === "flip" || pairDecision === "exclude") {
    suggestedDecision = pairDecision;
  }

  return {
    provider: asString(judge.provider) ?? asString(judge.mode),
    suggestedDecision,
    verdict,
    decision: pairDecision,
    confidence: asNumber(finalJudge.confidence),
    preferenceStrength: asNumber(finalJudge.preferenceStrength),
    responseQuality: asNumber(finalJudge.responseQuality),
    structuredImpactQuality: asNumber(finalJudge.structuredImpactQuality),
    groundingQuality: asNumber(finalJudge.groundingQuality),
    personaConsistency: asNumber(finalJudge.personaConsistency),
    inspectorUsefulness: asNumber(finalJudge.inspectorUsefulness),
    reasons: asStringArray(finalJudge.reasons, 10),
    llmError: asString(judge.llmError),
  };
}

function buildDatasetView(
  sftRaw: RawRecord[],
  pairRaw: RawRecord[],
): ReviewDatasetView {
  return {
    sftItems: sftRaw.map((entry) => buildSftItemView(entry)),
    pairItems: pairRaw.map((entry) => buildPairItemView(entry)),
  };
}

function buildSftCompletedItemView(raw: RawRecord): SftReviewItemView {
  const judge = asObject(raw.judge);
  const finalJudge = asObject(judge.final);

  return {
    kind: "sft",
    reviewId: `auto:${asString(raw.rowId) ?? "unknown-row"}`,
    bucket: asString(finalJudge.verdict),
    priority: null,
    status: "reviewed",
    decision: null,
    reviewer: null,
    reviewedAt: null,
    notes: "",
    queueReason: null,
    source: buildSourceViewFromPipelineRecord(raw),
    judge: buildJudgeView(finalJudge),
    weightedJudgeScore: null,
    prompt: buildPromptView(raw.promptBundle),
    candidate: buildCandidateView(raw),
    llmFirstPass: buildLlmFirstPassFromJudge(raw.judge),
  };
}

function buildPairCompletedItemView(raw: RawRecord): PairReviewItemView {
  const judge = asObject(raw.judge);
  const finalJudge = asObject(judge.final);

  return {
    kind: "pair",
    reviewId: `auto:${asString(raw.pairId) ?? "unknown-pair"}`,
    pairId: asString(raw.pairId) ?? "",
    priority: null,
    status: "reviewed",
    decision: null,
    reviewer: null,
    reviewedAt: null,
    notes: "",
    weightedGap: asNumber(raw.weightedGap),
    pairReason: asStringArray(raw.pairReason, 8),
    prompt: buildPromptView(raw.promptBundle),
    chosen: buildCandidateView(asObject(raw).chosenCandidate),
    rejected: buildCandidateView(asObject(raw).rejectedCandidate),
    llmFirstPass:
      buildLlmFirstPassFromJudge(raw.judge) ??
      {
        provider: asString(judge.provider) ?? asString(judge.mode),
        suggestedDecision:
          ((asString(finalJudge.decision) as LlmSuggestedDecision) ?? "escalate"),
        verdict: null,
        decision: asString(finalJudge.decision),
        confidence: asNumber(finalJudge.confidence),
        preferenceStrength: asNumber(finalJudge.preferenceStrength),
        responseQuality: null,
        structuredImpactQuality: null,
        groundingQuality: null,
        personaConsistency: null,
        inspectorUsefulness: null,
        reasons: asStringArray(finalJudge.reasons, 10),
        llmError: asString(judge.llmError),
      },
  };
}

export async function getReviewDashboardData(): Promise<ReviewDashboardData> {
  const [humanSftRaw, humanPairRaw, judgedSftRaw, judgedPairRaw] = await Promise.all([
    readReviewFile("sft"),
    readReviewFile("pair"),
    readJsonlArrayFile(PIPELINE_FILES.judgedSft),
    readJsonlArrayFile(PIPELINE_FILES.judgedPairs),
  ]);

  const humanSftRowIds = new Set(
    humanSftRaw
      .map((entry) => asString(entry.sourceRowId) ?? asString(entry.rowId))
      .filter((entry): entry is string => Boolean(entry)),
  );
  const humanPairIds = new Set(
    humanPairRaw
      .map((entry) => asString(entry.pairId))
      .filter((entry): entry is string => Boolean(entry)),
  );
  const completedSftItems = judgedSftRaw
    .filter((entry) => {
      const rowId = asString(entry.rowId);
      return rowId ? !humanSftRowIds.has(rowId) : true;
    })
    .map((entry) => buildSftCompletedItemView(entry));
  const completedPairItems = judgedPairRaw
    .filter((entry) => {
      const pairId = asString(entry.pairId);
      return pairId ? !humanPairIds.has(pairId) : true;
    })
    .map((entry) => buildPairCompletedItemView(entry));

  return {
    humanRequired: buildDatasetView(humanSftRaw, humanPairRaw),
    llmCompleted: {
      sftItems: completedSftItems,
      pairItems: completedPairItems,
    },
  };
}

type ReviewMutationInput =
  | {
      kind: "sft";
      reviewId: string;
      decision: SftReviewDecision;
      reviewer?: string | null;
      notes?: string;
    }
  | {
      kind: "pair";
      reviewId: string;
      decision: PairReviewDecision;
      reviewer?: string | null;
      notes?: string;
    };

export async function updateReviewDecision(
  input: ReviewMutationInput,
): Promise<ReviewMutationResult> {
  const items = await readReviewFile(input.kind);
  const targetIndex = items.findIndex(
    (entry) => asString(asObject(entry).reviewId) === input.reviewId,
  );

  if (targetIndex === -1) {
    throw new Error(`검수 항목을 찾지 못했습니다: ${input.reviewId}`);
  }

  const current = asObject(items[targetIndex]);
  const next: RawRecord = {
    ...current,
    decision: input.decision,
    reviewer: input.reviewer?.trim() || null,
    notes: input.notes ?? "",
    status: input.decision ? "reviewed" : "pending",
    reviewedAt: input.decision ? new Date().toISOString() : null,
  };

  items[targetIndex] = next;
  await writeReviewFile(input.kind, items);

  return {
    kind: input.kind,
    item:
      input.kind === "sft"
        ? buildSftItemView(next)
        : buildPairItemView(next),
  };
}
