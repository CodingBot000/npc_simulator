export type ReviewKind = "sft" | "pair";
export type ReviewSourceMode = "human_required" | "llm_completed";

export type SftReviewDecision = "include" | "exclude" | "escalate" | null;
export type PairReviewDecision =
  | "include"
  | "flip"
  | "exclude"
  | "escalate"
  | null;
export type LlmSuggestedDecision =
  | "include"
  | "flip"
  | "exclude"
  | "escalate"
  | null;

export interface ReviewPromptView {
  episodeId: string | null;
  scenarioId: string;
  turnIndex: number | null;
  npcId: string;
  targetNpcId: string | null;
  inputMode: string;
  playerText: string;
  normalizedInputSummary: string;
  promptContextSummary: string | null;
  retrievedMemorySummaries: string[];
  retrievedKnowledgeTitles: string[];
}

export interface ReviewSourceView {
  episodeId: string | null;
  scenarioId: string;
  turnIndex: number | null;
  npcId: string;
  targetNpcId: string | null;
  strategyLabel: string | null;
  exportPath: string | null;
  sourceLabel: string | null;
}

export interface ReviewJudgeView {
  responseQuality: number | null;
  structuredImpactQuality: number | null;
  groundingQuality: number | null;
  personaConsistency: number | null;
  inspectorUsefulness: number | null;
  verdict: string | null;
  reasons: string[];
}

export interface ReviewCandidateView {
  rowId?: string;
  verdict?: string | null;
  weightedScore?: number | null;
  replyText: string;
  selectedAction: string | null;
  selectedActionReason: string;
  impactTags: string[];
  targetNpcId: string | null;
  rationale: string;
}

export interface ReviewLlmFirstPassView {
  provider: string | null;
  suggestedDecision: LlmSuggestedDecision;
  verdict: string | null;
  decision: string | null;
  confidence: number | null;
  preferenceStrength: number | null;
  responseQuality: number | null;
  structuredImpactQuality: number | null;
  groundingQuality: number | null;
  personaConsistency: number | null;
  inspectorUsefulness: number | null;
  reasons: string[];
  llmError: string | null;
}

export interface SftReviewItemView {
  kind: "sft";
  reviewId: string;
  bucket: string | null;
  priority: string | null;
  status: string;
  decision: SftReviewDecision;
  reviewer: string | null;
  reviewedAt: string | null;
  notes: string;
  queueReason: string | null;
  source: ReviewSourceView;
  judge: ReviewJudgeView | null;
  weightedJudgeScore: number | null;
  prompt: ReviewPromptView;
  candidate: ReviewCandidateView;
  llmFirstPass: ReviewLlmFirstPassView | null;
}

export interface PairReviewItemView {
  kind: "pair";
  reviewId: string;
  pairId: string;
  priority: string | null;
  status: string;
  decision: PairReviewDecision;
  reviewer: string | null;
  reviewedAt: string | null;
  notes: string;
  weightedGap: number | null;
  pairReason: string[];
  prompt: ReviewPromptView;
  chosen: ReviewCandidateView;
  rejected: ReviewCandidateView;
  llmFirstPass: ReviewLlmFirstPassView | null;
}

export interface ReviewDatasetView {
  sftItems: SftReviewItemView[];
  pairItems: PairReviewItemView[];
}

export interface ReviewDashboardData {
  humanRequired: ReviewDatasetView;
  llmCompleted: ReviewDatasetView;
}

export interface ReviewMutationResult {
  kind: ReviewKind;
  item: SftReviewItemView | PairReviewItemView;
}

export interface ReviewFinalizePendingView {
  sft: number;
  pair: number;
  total: number;
}

export interface ReviewFinalizeDurationsView {
  sftMs: number | null;
  preferenceMs: number | null;
  totalMs: number | null;
}

export interface ReviewFinalizeStatusView {
  state: "idle" | "running" | "succeeded" | "failed";
  canFinalize: boolean;
  pending: ReviewFinalizePendingView;
  currentStep: "finalize_sft" | "finalize_preference" | null;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  durations: ReviewFinalizeDurationsView;
  outputs: {
    sft: string | null;
    preference: string | null;
  };
}
