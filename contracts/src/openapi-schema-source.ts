import type {
  InspectorPayload,
  InteractionRequestPayload,
  InteractionResponsePayload,
  WorldSnapshot as RuntimeWorldSnapshot,
} from "./runtime-contract-types";
import type {
  PairReviewItemView,
  ReviewDashboardData as ReviewDashboardDataView,
  ReviewFinalizeStatusView,
  ReviewKind,
  ReviewSourceMode,
  ReviewTrainingBindingKey,
  ReviewTrainingKind,
  ReviewTrainingStatusView,
  SftReviewItemView,
} from "./review-contract-types";

export type InteractionRequest = InteractionRequestPayload;
export type InteractionResponse = InteractionResponsePayload;
export type WorldSnapshot = RuntimeWorldSnapshot;
export interface InspectorResponse {
  inspector: InspectorPayload | null;
}

export type ReviewDashboardData = ReviewDashboardDataView;
export type ReviewMutationResult = {
  kind: ReviewKind;
  item: SftReviewItemView | PairReviewItemView;
};
export type ReviewFinalizeStatus = ReviewFinalizeStatusView;
export type ReviewTrainingStatus = ReviewTrainingStatusView;

export interface ReviewTrainingRequest {
  kind: ReviewTrainingKind;
}

export interface ReviewTrainingRunActionRequest {
  runId: string;
  bindingKey?: ReviewTrainingBindingKey | null;
}

export interface ReviewTrainingDecisionRequest {
  runId: string;
  decision: "accepted" | "rejected";
  reviewer: string | null;
  notes: string;
}

export type ReviewDecisionRequest =
  | {
      kind: "sft";
      reviewId: string;
      decision: "include" | "exclude" | "escalate" | null;
      reviewer?: string | null;
      notes?: string;
    }
  | {
      kind: "pair";
      reviewId: string;
      decision: "include" | "flip" | "exclude" | "escalate" | null;
      reviewer?: string | null;
      notes?: string;
    };

export interface ReviewPipelineRunRequest {
  sourceMode?: ReviewSourceMode;
  mode?: "heuristic" | "llm" | "hybrid" | null;
  provider?: "codex" | "openai" | null;
  limit?: number | null;
  dryRun?: boolean | null;
  verbose?: boolean | null;
  input?: string | null;
  output?: string | null;
  reviewInput?: string | null;
  pairsInput?: string | null;
  collectorInput?: string | null;
  outputDir?: string | null;
  skipDbSync?: boolean | null;
  sftInput?: string | null;
  pairInput?: string | null;
}

export interface ReviewPipelineRunResult {
  success: boolean;
  command: string;
  summaryPath: string | null;
  stdout: string;
  stderr: string;
}

export interface ReviewPipelineStatus {
  judgeSummaryPath: string | null;
  humanReviewSummaryPath: string | null;
  llmFirstPassSummaryPath: string | null;
}

export interface SystemInfo {
  service: string;
  status: string;
  phase: string;
  pendingMigrations: string[];
  deploymentMode: string;
  database: {
    kind: string;
    configured: boolean;
    detail: string;
  };
  provider: {
    mode: string;
    configured: boolean;
    credentialStatus: string;
    label: string;
    detail: string;
    actionGuide: string;
  };
  finalReply: {
    mode: string;
    backend: string;
    configured: boolean;
    credentialStatus: string;
    label: string;
    detail: string;
    actionGuide: string;
  };
  reviewAccess: {
    readable: boolean;
    writeMode: "local_unrestricted" | "admin_token_required";
    publicWriteEnabled: boolean;
  };
}

export interface ErrorResponse {
  message: string;
}

export type ContractInteractionRequest = InteractionRequestPayload;
export type ContractInteractionResponse = InteractionResponsePayload;
export type ContractWorldSnapshot = RuntimeWorldSnapshot;
export interface ContractInspectorResponse {
  inspector: InspectorPayload | null;
}

export type ContractReviewDashboardData = ReviewDashboardDataView;
export type ContractReviewMutationResult = ReviewMutationResult;
export type ContractReviewFinalizeStatus = ReviewFinalizeStatusView;
export type ContractReviewTrainingStatus = ReviewTrainingStatusView;
export type ContractReviewTrainingRequest = ReviewTrainingRequest;
export type ContractReviewTrainingRunActionRequest =
  ReviewTrainingRunActionRequest;
export type ContractReviewTrainingDecisionRequest =
  ReviewTrainingDecisionRequest;
export type ContractReviewDecisionRequest = ReviewDecisionRequest;
export type ContractReviewPipelineRunRequest = ReviewPipelineRunRequest;
export type ContractReviewPipelineRunResult = ReviewPipelineRunResult;
export type ContractReviewPipelineStatus = ReviewPipelineStatus;
export type ContractSystemInfo = SystemInfo;
export type ContractErrorResponse = ErrorResponse;
