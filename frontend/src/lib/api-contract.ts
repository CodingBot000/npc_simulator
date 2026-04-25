import type { operations, paths } from "@contracts/openapi-types";

type JsonBody<T> = T extends {
  requestBody: { content: { "application/json": infer Content } };
}
  ? Content
  : never;

type JsonSuccess<T> = T extends {
  responses: { 200: { content: { "application/json": infer Content } } };
}
  ? Content
  : never;

export type OpenApiPaths = paths;

export type WorldSnapshot = JsonSuccess<operations["getWorld"]>;
export type InteractionRequestPayload = JsonBody<operations["interact"]>;
export type InteractionResponsePayload = JsonSuccess<operations["interact"]>;
export type InspectorResponse = JsonSuccess<operations["getInspector"]>;

export type ReviewDashboardData = JsonSuccess<operations["getReviewDashboard"]>;
export type ReviewDecisionRequest = JsonBody<operations["patchReviewDecision"]>;
export type ReviewMutationResult = JsonSuccess<operations["patchReviewDecision"]>;
export type ReviewFinalizeStatus = JsonSuccess<operations["getReviewFinalizeStatus"]>;
export type ReviewTrainingStatus = JsonSuccess<operations["getReviewTrainingStatus"]>;
export type ReviewTrainingRequest = JsonBody<operations["runReviewTraining"]>;
export type ReviewTrainingRunActionRequest = JsonBody<
  operations["runReviewTrainingEvaluation"]
>;
export type ReviewTrainingDecisionRequest = JsonBody<
  operations["updateReviewTrainingDecision"]
>;
export type ReviewPipelineStatus = JsonSuccess<operations["getReviewPipelineStatus"]>;
export type ReviewPipelineRunRequest = JsonBody<operations["runJudgeReviewQueue"]>;
export type ReviewPipelineRunResult = JsonSuccess<operations["runJudgeReviewQueue"]>;
export type SystemInfo = JsonSuccess<operations["getSystemInfo"]>;
