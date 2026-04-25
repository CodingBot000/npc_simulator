import createClient from "openapi-fetch";
import type { OpenApiPaths } from "@/lib/api-contract";
import type {
  InteractionRequestPayload,
  InteractionResponsePayload,
  ReviewDashboardData,
  ReviewDecisionRequest,
  ReviewFinalizeStatus,
  ReviewPipelineRunRequest,
  ReviewPipelineRunResult,
  ReviewPipelineStatus,
  ReviewTrainingDecisionRequest,
  ReviewTrainingRequest,
  ReviewTrainingRunActionRequest,
  ReviewTrainingStatus,
  SystemInfo,
  WorldSnapshot,
} from "@/lib/api-contract";

function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function getClientApiBaseUrl() {
  return (
    normalizeBaseUrl(window.__NPC_SIMULATOR_CONFIG__?.apiBaseUrl) ??
    normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL) ??
    "http://localhost:8080"
  );
}

export function buildClientApiUrl(pathname: string) {
  const baseUrl = getClientApiBaseUrl();
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function createApiClient() {
  return createClient<OpenApiPaths>({
    baseUrl: getClientApiBaseUrl(),
  });
}

async function readApiErrorMessage(response: Response, fallbackMessage: string) {
  const payload = (await response.clone().json().catch(() => null)) as
    | { message?: string }
    | null;
  return payload?.message ?? fallbackMessage;
}

async function ensureApiResponse<T>(
  request: Promise<{ data?: T; response: Response }>,
  fallbackMessage: string,
) {
  const { data, response } = await request;

  if (!response.ok || data === undefined) {
    throw new Error(await readApiErrorMessage(response, fallbackMessage));
  }

  return data;
}

export function getOpenApiClient() {
  return createApiClient();
}

export function apiGetWorld(options?: {
  signal?: AbortSignal;
  cache?: RequestCache;
}) {
  return ensureApiResponse<WorldSnapshot>(
    createApiClient().GET("/api/world", options),
    "월드 데이터를 불러오지 못했습니다.",
  );
}

export function apiResetWorld() {
  return ensureApiResponse<WorldSnapshot>(
    createApiClient().POST("/api/reset"),
    "상태 초기화에 실패했습니다.",
  );
}

export function apiInteract(body: InteractionRequestPayload) {
  return ensureApiResponse<InteractionResponsePayload>(
    createApiClient().POST("/api/interact", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "상호작용 처리에 실패했습니다.",
  );
}

export function apiGetReviewDashboard(options?: {
  signal?: AbortSignal;
  cache?: RequestCache;
}) {
  return ensureApiResponse<ReviewDashboardData>(
    createApiClient().GET("/api/review", options),
    "검수 데이터를 불러오지 못했습니다.",
  );
}

export function apiUpdateReviewDecision(body: ReviewDecisionRequest) {
  return ensureApiResponse(
    createApiClient().PATCH("/api/review", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "저장하지 못했습니다.",
  );
}

export function apiGetReviewFinalizeStatus(options?: {
  signal?: AbortSignal;
  cache?: RequestCache;
}) {
  return ensureApiResponse<ReviewFinalizeStatus>(
    createApiClient().GET("/api/review/finalize", options),
    "finalize 상태를 불러오지 못했습니다.",
  );
}

export function apiRunReviewFinalize() {
  return ensureApiResponse<ReviewFinalizeStatus>(
    createApiClient().POST("/api/review/finalize"),
    "finalize 실행에 실패했습니다.",
  );
}

export function apiGetReviewTrainingStatus(options?: {
  signal?: AbortSignal;
  cache?: RequestCache;
}) {
  return ensureApiResponse<ReviewTrainingStatus>(
    createApiClient().GET("/api/review/training", options),
    "학습 상태를 불러오지 못했습니다.",
  );
}

export function apiRunReviewTraining(body: ReviewTrainingRequest) {
  return ensureApiResponse<ReviewTrainingStatus>(
    createApiClient().POST("/api/review/training", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "학습 실행에 실패했습니다.",
  );
}

export function apiRunReviewTrainingEvaluation(
  body: ReviewTrainingRunActionRequest,
) {
  return ensureApiResponse<ReviewTrainingStatus>(
    createApiClient().POST("/api/review/training/evaluate", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "Golden-set Evaluation 실행에 실패했습니다.",
  );
}

export function apiUpdateReviewTrainingDecision(
  body: ReviewTrainingDecisionRequest,
) {
  return ensureApiResponse<ReviewTrainingStatus>(
    createApiClient().POST("/api/review/training/decision", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "학습 채택 여부 저장에 실패했습니다.",
  );
}

export function apiPromoteReviewTrainingRun(
  body: ReviewTrainingRunActionRequest,
) {
  return ensureApiResponse<ReviewTrainingStatus>(
    createApiClient().POST("/api/review/training/promote", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "Model Promotion에 실패했습니다.",
  );
}

export function apiGetReviewPipelineStatus(options?: {
  signal?: AbortSignal;
  cache?: RequestCache;
}) {
  return ensureApiResponse<ReviewPipelineStatus>(
    createApiClient().GET("/api/review/pipeline", options),
    "검수 파이프라인 상태를 불러오지 못했습니다.",
  );
}

export function apiRunJudgeReviewQueue(body?: ReviewPipelineRunRequest) {
  return ensureApiResponse<ReviewPipelineRunResult>(
    createApiClient().POST("/api/review/pipeline/judge", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "judge-review 실행에 실패했습니다.",
  );
}

export function apiRunPrepareHumanReview(body?: ReviewPipelineRunRequest) {
  return ensureApiResponse<ReviewPipelineRunResult>(
    createApiClient().POST("/api/review/pipeline/prepare-human-review", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "prepare-human-review 실행에 실패했습니다.",
  );
}

export function apiRunReviewLlmFirstPass(body?: ReviewPipelineRunRequest) {
  return ensureApiResponse<ReviewPipelineRunResult>(
    createApiClient().POST("/api/review/pipeline/llm-first-pass", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    "review llm-first-pass 실행에 실패했습니다.",
  );
}

export function apiGetSystemInfo(options?: {
  signal?: AbortSignal;
  cache?: RequestCache;
}) {
  return ensureApiResponse<SystemInfo>(
    createApiClient().GET("/api/system/info", options),
    "시스템 정보를 불러오지 못했습니다.",
  );
}
