import type {
  OpenApiSchema,
  ReviewDashboardData as ApiReviewDashboardData,
  ReviewDecisionRequest as ApiReviewDecisionRequest,
  ReviewFinalizeStatus as ApiReviewFinalizeStatus,
  ReviewMutationResult as ApiReviewMutationResult,
  ReviewPipelineRunRequest as ApiReviewPipelineRunRequest,
  ReviewPipelineRunResult as ApiReviewPipelineRunResult,
  ReviewPipelineStatus as ApiReviewPipelineStatus,
  ReviewTrainingDecisionRequest as ApiReviewTrainingDecisionRequest,
  ReviewTrainingRequest as ApiReviewTrainingRequest,
  ReviewTrainingRunActionRequest as ApiReviewTrainingRunActionRequest,
  ReviewTrainingStatus as ApiReviewTrainingStatus,
} from "@/lib/api-contract";

type Schema = OpenApiSchema;

export type ReviewKind = Schema["ReviewKind"];
export type ReviewSourceMode = Schema["ReviewSourceMode"];
export type ReviewTrainingKind = Schema["ReviewTrainingKind"];
export type ReviewTrainingBackend = Schema["ReviewTrainingBackend"];
export type ReviewTrainingExecutionMode =
  Schema["ReviewTrainingExecutionMode"];
export type ReviewTrainingBindingKey = Schema["ReviewTrainingBindingKey"];

export type SftReviewDecision = Schema["SftReviewDecision"];
export type PairReviewDecision = Schema["PairReviewDecision"];
export type LlmSuggestedDecision = Schema["LlmSuggestedDecision"];

export type ReviewPromptView = Schema["ReviewPromptView"];
export type ReviewSourceView = Schema["ReviewSourceView"];
export type ReviewJudgeView = Schema["ReviewJudgeView"];
export type ReviewCandidateView = Schema["ReviewCandidateView"];
export type ReviewLlmFirstPassView = Schema["ReviewLlmFirstPassView"];
export type SftReviewItemView = Schema["SftReviewItemView"];
export type PairReviewItemView = Schema["PairReviewItemView"];
export type ReviewDatasetView = Schema["ReviewDatasetView"];
export type ReviewShadowInvalidCaseView =
  Schema["ReviewShadowInvalidCaseView"];
export type ReviewShadowInvalidSummaryView =
  Schema["ReviewShadowInvalidSummaryView"];
export type ReviewDashboardData = ApiReviewDashboardData;
export type ReviewMutationResult = ApiReviewMutationResult;
export type ReviewDecisionRequest = ApiReviewDecisionRequest;
export type ReviewFinalizePendingView = Schema["ReviewFinalizePendingView"];
export type ReviewFinalizeDurationsView =
  Schema["ReviewFinalizeDurationsView"];
export type ReviewFinalizeStatusView = ApiReviewFinalizeStatus;
export type ReviewTrainingDatasetView =
  Schema["ReviewTrainingDatasetView"];
export type ReviewTrainingPreflightView =
  Schema["ReviewTrainingPreflightView"];
export type ReviewTrainingRuntimeArtifactKind =
  Schema["ReviewTrainingRuntimeArtifactKind"];
export type ReviewTrainingDurationsView =
  Schema["ReviewTrainingDurationsView"];
export type ReviewTrainingEvalWinnerCountsView =
  Schema["ReviewTrainingEvalWinnerCountsView"];
export type ReviewTrainingEvaluationView =
  Schema["ReviewTrainingEvaluationView"];
export type ReviewTrainingDecisionView =
  Schema["ReviewTrainingDecisionView"];
export type ReviewTrainingPromotionView =
  Schema["ReviewTrainingPromotionView"];
export type ReviewTrainingRunView = Schema["ReviewTrainingRunView"];
export type ReviewTrainingStatusView = ApiReviewTrainingStatus;
export type ReviewTrainingRequest = ApiReviewTrainingRequest;
export type ReviewTrainingRunActionRequest =
  ApiReviewTrainingRunActionRequest;
export type ReviewTrainingDecisionRequest =
  ApiReviewTrainingDecisionRequest;
export type ReviewPipelineStatus = ApiReviewPipelineStatus;
export type ReviewPipelineRunRequest = ApiReviewPipelineRunRequest;
export type ReviewPipelineRunResult = ApiReviewPipelineRunResult;
