import type { components } from "@contracts/openapi-types";

export type ReviewKind = components["schemas"]["ReviewKind"];
export type ReviewSourceMode = components["schemas"]["ReviewSourceMode"];
export type ReviewTrainingKind = components["schemas"]["ReviewTrainingKind"];
export type ReviewTrainingBackend = components["schemas"]["ReviewTrainingBackend"];
export type ReviewTrainingExecutionMode =
  components["schemas"]["ReviewTrainingExecutionMode"];
export type ReviewTrainingBindingKey =
  components["schemas"]["ReviewTrainingBindingKey"];
export type SftReviewDecision = components["schemas"]["SftReviewDecision"];
export type PairReviewDecision = components["schemas"]["PairReviewDecision"];
export type LlmSuggestedDecision = components["schemas"]["LlmSuggestedDecision"];
export type ReviewPromptView = components["schemas"]["ReviewPromptView"];
export type ReviewSourceView = components["schemas"]["ReviewSourceView"];
export type ReviewJudgeView = components["schemas"]["ReviewJudgeView"];
export type ReviewCandidateView = components["schemas"]["ReviewCandidateView"];
export type ReviewLlmFirstPassView = components["schemas"]["ReviewLlmFirstPassView"];
export type SftReviewItemView = components["schemas"]["SftReviewItemView"];
export type PairReviewItemView = components["schemas"]["PairReviewItemView"];
export type ReviewDatasetView = components["schemas"]["ReviewDatasetView"];
export type ReviewShadowInvalidCaseView =
  components["schemas"]["ReviewShadowInvalidCaseView"];
export type ReviewShadowInvalidSummaryView =
  components["schemas"]["ReviewShadowInvalidSummaryView"];
export type ReviewDashboardData = components["schemas"]["ReviewDashboardData"];
export type ReviewMutationResult = components["schemas"]["ReviewMutationResult"];
export type ReviewFinalizePendingView =
  components["schemas"]["ReviewFinalizePendingView"];
export type ReviewFinalizeDurationsView =
  components["schemas"]["ReviewFinalizeDurationsView"];
export type ReviewFinalizeStatusView =
  components["schemas"]["ReviewFinalizeStatusView"];
export type ReviewTrainingDatasetView =
  components["schemas"]["ReviewTrainingDatasetView"];
export type ReviewTrainingPreflightView =
  components["schemas"]["ReviewTrainingPreflightView"];
export type ReviewTrainingRuntimeArtifactKind =
  components["schemas"]["ReviewTrainingRuntimeArtifactKind"];
export type ReviewTrainingDurationsView =
  components["schemas"]["ReviewTrainingDurationsView"];
export type ReviewTrainingEvalWinnerCountsView =
  components["schemas"]["ReviewTrainingEvalWinnerCountsView"];
export type ReviewTrainingEvaluationView =
  components["schemas"]["ReviewTrainingEvaluationView"];
export type ReviewTrainingDecisionView =
  components["schemas"]["ReviewTrainingDecisionView"];
export type ReviewTrainingPromotionView =
  components["schemas"]["ReviewTrainingPromotionView"];
export type ReviewTrainingRunView = components["schemas"]["ReviewTrainingRunView"];
export type ReviewTrainingStatusView =
  components["schemas"]["ReviewTrainingStatusView"];
