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
import { resolveClientApiBaseUrlConfig } from "@/lib/runtime-config";

const WORLD_INSTANCE_HEADER = "x-world-instance-id";
const WORLD_INSTANCE_STORAGE_KEY = "npc-simulator-world-instance-id";
const WORLD_INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const VISITOR_ID_HEADER = "X-NPC-Visitor-Id";
const VISITOR_ID_STORAGE_KEY = "npc-simulator-visitor-id";
const VISITOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export interface VisitorEventPayload {
  eventType: string;
  worldInstanceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VisitorEventResponse {
  visitorId: string;
  owner: boolean;
  eventType: string;
}

export interface OwnerRegistrationResponse {
  visitorId: string;
  owner: boolean;
}

export function getClientApiBaseUrlSource() {
  return resolveClientApiBaseUrlConfig().source;
}

export function getClientApiBaseUrl() {
  return resolveClientApiBaseUrlConfig().apiBaseUrl;
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

function createBrowserWorldInstanceId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  const rawId = uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `browser_${rawId.replace(/[^A-Za-z0-9_-]/gu, "_")}`.slice(0, 128);
}

function createBrowserVisitorId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  const rawId = uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `visitor_${rawId.replace(/[^A-Za-z0-9_-]/gu, "_")}`.slice(0, 128);
}

function getBrowserWorldInstanceId() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(WORLD_INSTANCE_STORAGE_KEY)?.trim();
  if (stored && WORLD_INSTANCE_ID_PATTERN.test(stored)) {
    return stored;
  }

  const nextId = createBrowserWorldInstanceId();
  window.localStorage.setItem(WORLD_INSTANCE_STORAGE_KEY, nextId);
  return nextId;
}

export function getCurrentWorldInstanceId() {
  return getBrowserWorldInstanceId();
}

export function getBrowserVisitorId() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)?.trim();
  if (stored && VISITOR_ID_PATTERN.test(stored)) {
    return stored;
  }

  const nextId = createBrowserVisitorId();
  window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, nextId);
  return nextId;
}

function gameWorldHeaders(headers?: HeadersInit) {
  const instanceId = getBrowserWorldInstanceId();
  const visitorId = getBrowserVisitorId();
  const nextHeaders = new Headers(headers);

  if (instanceId) {
    nextHeaders.set(WORLD_INSTANCE_HEADER, instanceId);
  }

  if (visitorId) {
    nextHeaders.set(VISITOR_ID_HEADER, visitorId);
  }

  return nextHeaders;
}

function visitorHeaders(headers?: HeadersInit) {
  const visitorId = getBrowserVisitorId();
  const nextHeaders = new Headers(headers);

  if (visitorId) {
    nextHeaders.set(VISITOR_ID_HEADER, visitorId);
  }

  return nextHeaders;
}

async function ensureFetchJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
) {
  const payload = (await response.clone().json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok || payload === null) {
    throw new Error(payload?.message ?? fallbackMessage);
  }

  return payload as T;
}

export async function apiRecordVisitorEvent(payload: VisitorEventPayload) {
  const response = await fetch(buildClientApiUrl("/api/visitor/events"), {
    method: "POST",
    headers: visitorHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
    keepalive: true,
  });

  return ensureFetchJsonResponse<VisitorEventResponse>(
    response,
    "방문자 이벤트 기록에 실패했습니다.",
  );
}

export function recordVisitorEvent(payload: VisitorEventPayload) {
  void apiRecordVisitorEvent(payload).catch(() => undefined);
}

export async function apiRegisterOwnerVisitor(token: string) {
  const response = await fetch(buildClientApiUrl("/api/visitor/owner"), {
    method: "POST",
    headers: visitorHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ token }),
  });

  return ensureFetchJsonResponse<OwnerRegistrationResponse>(
    response,
    "owner 등록에 실패했습니다.",
  );
}

function readMessageFromApiError(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

async function readApiErrorMessage(
  error: unknown,
  response: Response,
  fallbackMessage: string,
) {
  const parsedMessage = readMessageFromApiError(error);
  if (parsedMessage) {
    return parsedMessage;
  }

  if (!response.bodyUsed) {
    const payload = (await response.clone().json().catch(() => null)) as
      | { message?: string }
      | null;
    return payload?.message ?? fallbackMessage;
  }

  return fallbackMessage;
}

async function ensureApiResponse<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
  fallbackMessage: string,
) {
  const { data, error, response } = await request;

  if (!response.ok || data === undefined) {
    throw new Error(await readApiErrorMessage(error, response, fallbackMessage));
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
    createApiClient().GET("/api/world", {
      ...options,
      headers: gameWorldHeaders(),
    }),
    "월드 데이터를 불러오지 못했습니다.",
  );
}

export function apiResetWorld() {
  return ensureApiResponse<WorldSnapshot>(
    createApiClient().POST("/api/reset", {
      headers: gameWorldHeaders(),
    }),
    "상태 초기화에 실패했습니다.",
  );
}

export function apiInteract(body: InteractionRequestPayload) {
  return ensureApiResponse<InteractionResponsePayload>(
    createApiClient().POST("/api/interact", {
      body,
      headers: gameWorldHeaders({
        "Content-Type": "application/json",
      }),
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
