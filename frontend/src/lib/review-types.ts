export type ReviewKind = "sft" | "pair";
export type ReviewSourceMode =
  | "human_required"
  | "human_reviewed"
  | "llm_completed";
export type ReviewTrainingKind = "sft" | "dpo";
export type ReviewTrainingBackend =
  | "local_peft"
  | "together_serverless_lora"
  | "smoke";
export type ReviewTrainingExecutionMode =
  | ReviewTrainingBackend
  | "needs_new_sft"
  | "reuse_existing_sft"
  | "unsupported";
export type ReviewTrainingBindingKey =
  | "default"
  | "doctor"
  | "supervisor"
  | "director";

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

export interface ReviewTrainingDatasetView {
  exists: boolean;
  manifestPath: string | null;
  datasetVersion: string | null;
  fingerprint: string | null;
  rowCount: number | null;
}

export interface ReviewTrainingPreflightView {
  kind: ReviewTrainingKind;
  canStart: boolean;
  alreadyTrained: boolean;
  duplicateRunId: string | null;
  parentRunId: string | null;
  adapterPath: string | null;
  sftFingerprintRelation: "match" | "mismatch" | null;
  executionMode: ReviewTrainingExecutionMode | null;
  trainingBackend: ReviewTrainingBackend | null;
  blockingIssues: string[];
  dataset: ReviewTrainingDatasetView;
}

export type ReviewTrainingRuntimeArtifactKind =
  | "mlx_adapter"
  | "mlx_fused_model"
  | "legacy_mlx_adapter";

export interface ReviewTrainingDurationsView {
  buildMs: number | null;
  trainMs: number | null;
  totalMs: number | null;
}

export interface ReviewTrainingEvalWinnerCountsView {
  baseline: number;
  candidate: number;
  tie: number;
}

export interface ReviewTrainingEvaluationView {
  state: "idle" | "running" | "succeeded" | "failed";
  bindingKey: ReviewTrainingBindingKey | null;
  benchmarkId: string | null;
  baselineLabel: string | null;
  summaryPath: string | null;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  recommendation: "promote" | "hold" | null;
  winnerCounts: ReviewTrainingEvalWinnerCountsView | null;
  baselineNaturalness: number | null;
  candidateNaturalness: number | null;
  baselinePersonaFit: number | null;
  candidatePersonaFit: number | null;
  baselineAntiMeta: number | null;
  candidateAntiMeta: number | null;
  confidence: number | null;
}

export interface ReviewTrainingDecisionView {
  state: "pending" | "accepted" | "rejected";
  reviewer: string | null;
  notes: string | null;
  decidedAt: string | null;
}

export interface ReviewTrainingPromotionView {
  isPromoted: boolean;
  bindingKey: ReviewTrainingBindingKey | null;
  promotedAt: string | null;
}

export interface ReviewTrainingRunView {
  runId: string;
  kind: ReviewTrainingKind;
  trainingBackend: ReviewTrainingBackend | null;
  state: "running" | "succeeded" | "failed";
  currentStep:
    | "build_dataset"
    | "upload_remote_files"
    | "train_sft"
    | "train_dpo"
    | "wait_remote_training"
    | "derive_runtime"
    | null;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  fingerprint: string | null;
  sourceFingerprint: string | null;
  sourceDatasetVersion: string | null;
  parentRunId: string | null;
  baseModelId: string | null;
  datasetDir: string | null;
  adapterPath: string | null;
  runtimeArtifactPath: string | null;
  runtimeArtifactKind: ReviewTrainingRuntimeArtifactKind | null;
  remoteProvider: string | null;
  remoteJobId: string | null;
  remoteTrainingFileId: string | null;
  remoteValidationFileId: string | null;
  remoteModelName: string | null;
  logPath: string | null;
  durations: ReviewTrainingDurationsView;
  evaluation: ReviewTrainingEvaluationView;
  decision: ReviewTrainingDecisionView;
  promotion: ReviewTrainingPromotionView;
}

export interface ReviewTrainingStatusView {
  activeRun: ReviewTrainingRunView | null;
  latestRun: ReviewTrainingRunView | null;
  sft: ReviewTrainingPreflightView;
  dpo: ReviewTrainingPreflightView;
}
