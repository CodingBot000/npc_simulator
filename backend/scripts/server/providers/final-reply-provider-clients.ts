import { spawn } from "node:child_process";
import {
  buildCodexCliChildEnv,
  buildModelExecutionChildEnv,
} from "@backend-support/bootstrap";
import { PROJECT_ROOT, appConfig } from "@server/config";
import {
  createBasetenChatCompletion,
  extractBasetenChatText,
} from "@server/baseten-client";
import {
  buildCodexCliModelConfigArgs,
  createOpenAiResponse,
} from "@server/openai-responses-client";
import { LOCAL_MLX_BINARY } from "@server/providers/mlx-reply-config";
import {
  resolveSystemPrompt,
  type ScenePromptFormat,
} from "@server/providers/mlx-reply-prompts";
import { extractDelimitedText } from "@server/providers/mlx-reply-text-utils";
import {
  createRunpodLoadBalancerChatCompletion,
  createRunpodVllmRunSync,
  extractOpenAiCompatibleChatText,
  extractRunpodVllmText,
  getRunpodLoadBalancerPing,
  listRunpodLoadBalancerModels,
  RunpodApiRequestError,
  type RunpodEndpointMode,
} from "@server/runpod-client";
import {
  createTogetherChatCompletion,
  extractTogetherChatText,
} from "@server/together-client";

const FINAL_REPLY_REWRITE_TEMPERATURE = 0.2;
const OPENAI_FINAL_REPLY_MIN_OUTPUT_TOKENS = 400;
const RUNPOD_LOAD_BALANCER_RETRY_DELAY_MS = 5_000;
const RUNPOD_LOAD_BALANCER_READY_CHECK_TIMEOUT_MS = 5_000;
const RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS = 5_000;
const RUNPOD_LOAD_BALANCER_RETRY_ATTEMPT_TIMEOUT_MS = 45_000;
const RUNPOD_LOAD_BALANCER_RETRYABLE_MESSAGES = [
  "Internal Server Error",
  "Runpod API request failed (500)",
  "Runpod load balancer is not ready",
  "All connection attempts failed",
  "fetch failed",
] as const;

type RunpodFinalReplyAttemptStatus = "ok" | "failed" | "timeout" | "not_ready";
export type RunpodFinalReplyDecision =
  | "accepted"
  | "failed_no_retry"
  | "retry_once"
  | "fallback_to_openai"
  | "fallback_to_base_reply";

export type FinalReplyProviderDiagnostics = Record<string, unknown>;

type RunpodFinalReplyAttemptDiagnostics = {
  attempt: number;
  timeoutMs: number;
  durationMs: number;
  status: RunpodFinalReplyAttemptStatus;
  httpStatus?: number | null;
  errorMessage?: string | null;
};

type RunpodFinalReplyReadinessDiagnostics = {
  timeoutMs: number;
  durationMs: number;
  status: "ok" | "not_ready" | "failed" | "timeout";
  httpStatus?: number | null;
  errorMessage?: string | null;
};

type RunpodFinalReplyStatusCheckStepDiagnostics = {
  timeoutMs: number;
  durationMs: number;
  status: "ok" | "not_ready" | "failed" | "timeout";
  httpStatus?: number | null;
  errorMessage?: string | null;
  responseTextPreview?: string | null;
  modelCount?: number | null;
  requestedModelFound?: boolean | null;
  modelIds?: string[];
};

type RunpodFinalReplyPostFailureStatusCheckDiagnostics = {
  trigger: "rewrite_failure";
  timeoutMs: number;
  durationMs: number;
  ping: RunpodFinalReplyStatusCheckStepDiagnostics;
  models: RunpodFinalReplyStatusCheckStepDiagnostics;
  verdict: string;
};

type RunpodFinalReplyDiagnostics = {
  provider: "runpod";
  endpointMode: RunpodEndpointMode;
  endpointId: string;
  model: string;
  maxTokens: number;
  promptChars: number;
  systemMessageChars: number;
  userMessageChars: number;
  requestTimeoutMs: number;
  retryReadyCheckTimeoutMs: number;
  retryAttemptTimeoutMs: number;
  attemptCount: number;
  attempts: RunpodFinalReplyAttemptDiagnostics[];
  readinessCheck?: RunpodFinalReplyReadinessDiagnostics | null;
  postFailureStatusCheck?: RunpodFinalReplyPostFailureStatusCheckDiagnostics | null;
  decision: RunpodFinalReplyDecision;
};

export class FinalReplyProviderRequestError extends Error {
  readonly diagnostics: FinalReplyProviderDiagnostics;

  constructor(message: string, diagnostics: FinalReplyProviderDiagnostics) {
    super(message);
    this.name = "FinalReplyProviderRequestError";
    this.diagnostics = diagnostics;
  }
}

export function extractFinalReplyProviderDiagnostics(error: unknown) {
  return error instanceof FinalReplyProviderRequestError
    ? error.diagnostics
    : null;
}

export function withFinalReplyProviderDecision(
  diagnostics: FinalReplyProviderDiagnostics | null,
  decision: RunpodFinalReplyDecision,
): FinalReplyProviderDiagnostics | null {
  if (!diagnostics) {
    return null;
  }
  return {
    ...diagnostics,
    decision,
  };
}

export async function runMlxGenerate(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(LOCAL_MLX_BINARY, args, {
      cwd: PROJECT_ROOT,
      env: buildModelExecutionChildEnv(PROJECT_ROOT),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("mlx_lm.generate timed out after 120000ms."));
    }, 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "mlx_lm.generate failed."));
        return;
      }
      resolve(extractDelimitedText(stdout || stderr));
    });
  });
}

export async function runTogetherGenerate(params: {
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createTogetherChatCompletion({
    model: params.model,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
    timeoutMs: appConfig.finalReply.timeoutMs,
  });
  return extractTogetherChatText(response) ?? "";
}

export async function runRunpodGenerate(params: {
  endpointId: string;
  endpointMode: RunpodEndpointMode;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const messages = [
    {
      role: "system" as const,
      content: resolveSystemPrompt(params.npcId, params.promptFormat),
    },
    {
      role: "user" as const,
      content: params.prompt,
    },
  ];

  if (params.endpointMode === "load_balancer_vllm") {
    const result = await runRunpodLoadBalancerChatCompletionWithPolicy({
      endpointId: params.endpointId,
      model: params.model,
      messages,
      systemMessageChars: messages[0]?.content.length ?? 0,
      userMessageChars: params.prompt.length,
    });
    return {
      text: extractOpenAiCompatibleChatText(result.response) ?? "",
      diagnostics: result.diagnostics,
    };
  }

  const startedAt = Date.now();
  const diagnostics = buildRunpodFinalReplyDiagnostics({
    endpointId: params.endpointId,
    endpointMode: params.endpointMode,
    model: params.model,
    systemMessageChars: messages[0]?.content.length ?? 0,
    userMessageChars: params.prompt.length,
  });
  const response = await createRunpodVllmRunSync({
    endpointId: params.endpointId,
    messages,
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
    timeoutMs: appConfig.finalReply.timeoutMs,
  });
  diagnostics.attempts.push({
    attempt: 1,
    timeoutMs: appConfig.finalReply.timeoutMs,
    durationMs: Date.now() - startedAt,
    status: "ok",
  });
  diagnostics.attemptCount = diagnostics.attempts.length;
  diagnostics.decision = "accepted";
  return {
    text: extractRunpodVllmText(response) ?? "",
    diagnostics,
  };
}

async function runRunpodLoadBalancerChatCompletionWithPolicy(params: {
  endpointId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  systemMessageChars: number;
  userMessageChars: number;
}) {
  const startedAt = Date.now();
  const deadline = startedAt + appConfig.finalReply.timeoutMs;
  const diagnostics = buildRunpodFinalReplyDiagnostics({
    endpointId: params.endpointId,
    endpointMode: "load_balancer_vllm",
    model: params.model,
    systemMessageChars: params.systemMessageChars,
    userMessageChars: params.userMessageChars,
  });

  const firstTimeoutMs = getRunpodLoadBalancerAttemptTimeout({
    deadline,
    capMs: diagnostics.requestTimeoutMs,
  });

  try {
    const response = await executeRunpodLoadBalancerChatCompletionAttempt({
      attempt: 1,
      timeoutMs: firstTimeoutMs,
      diagnostics,
      endpointId: params.endpointId,
      model: params.model,
      messages: params.messages,
    });
    diagnostics.decision = "accepted";
    diagnostics.attemptCount = diagnostics.attempts.length;
    return { response, diagnostics };
  } catch (error) {
    const firstError = toError(error);
    diagnostics.attemptCount = diagnostics.attempts.length;
    if (
      !isRetryableRunpodLoadBalancerError(firstError) ||
      getRemainingTimeoutMs(deadline) <= 1_000
    ) {
      diagnostics.decision = "failed_no_retry";
      await throwRunpodLoadBalancerErrorWithStatusCheck({
        error: firstError,
        diagnostics,
        endpointId: params.endpointId,
        model: params.model,
      });
    }
  }

  diagnostics.decision = "retry_once";
  const readyCheckStartedAt = Date.now();
  const readyCheckTimeoutMs = Math.min(
    RUNPOD_LOAD_BALANCER_READY_CHECK_TIMEOUT_MS,
    Math.max(1_000, getRemainingTimeoutMs(deadline)),
  );
  try {
    await waitForRunpodLoadBalancerReady({
      endpointId: params.endpointId,
      deadline: Date.now() + readyCheckTimeoutMs,
    });
    diagnostics.readinessCheck = {
      timeoutMs: readyCheckTimeoutMs,
      durationMs: Date.now() - readyCheckStartedAt,
      status: "ok",
    };
  } catch (error) {
    const readyError = toError(error);
    diagnostics.readinessCheck = {
      timeoutMs: readyCheckTimeoutMs,
      durationMs: Date.now() - readyCheckStartedAt,
      status: getRunpodLoadBalancerFailureStatus(readyError) === "timeout"
        ? "timeout"
        : "not_ready",
      httpStatus: getRunpodErrorHttpStatus(readyError),
      errorMessage: readyError.message,
    };
    diagnostics.attemptCount = diagnostics.attempts.length;
    diagnostics.decision = "failed_no_retry";
    await throwRunpodLoadBalancerErrorWithStatusCheck({
      error: readyError,
      diagnostics,
      endpointId: params.endpointId,
      model: params.model,
    });
  }

  const retryTimeoutMs = getRunpodLoadBalancerAttemptTimeout({
    deadline,
    capMs: Math.min(
      diagnostics.requestTimeoutMs,
      RUNPOD_LOAD_BALANCER_RETRY_ATTEMPT_TIMEOUT_MS,
    ),
  });

  try {
    const response = await executeRunpodLoadBalancerChatCompletionAttempt({
      attempt: 2,
      timeoutMs: retryTimeoutMs,
      diagnostics,
      endpointId: params.endpointId,
      model: params.model,
      messages: params.messages,
    });
    diagnostics.decision = "accepted";
    diagnostics.attemptCount = diagnostics.attempts.length;
    return { response, diagnostics };
  } catch (error) {
    const retryError = toError(error);
    diagnostics.attemptCount = diagnostics.attempts.length;
    diagnostics.decision = "failed_no_retry";
    await throwRunpodLoadBalancerErrorWithStatusCheck({
      error: retryError,
      diagnostics,
      endpointId: params.endpointId,
      model: params.model,
    });
  }
}

function buildRunpodFinalReplyDiagnostics(params: {
  endpointId: string;
  endpointMode: RunpodEndpointMode;
  model: string;
  systemMessageChars: number;
  userMessageChars: number;
}): RunpodFinalReplyDiagnostics {
  const requestTimeoutMs = Math.min(
    appConfig.finalReply.runpodRequestTimeoutMs,
    appConfig.finalReply.timeoutMs,
  );
  return {
    provider: "runpod",
    endpointMode: params.endpointMode,
    endpointId: maskEndpointId(params.endpointId),
    model: params.model,
    maxTokens: appConfig.finalReply.maxTokens,
    promptChars: params.userMessageChars,
    systemMessageChars: params.systemMessageChars,
    userMessageChars: params.userMessageChars,
    requestTimeoutMs,
    retryReadyCheckTimeoutMs: RUNPOD_LOAD_BALANCER_READY_CHECK_TIMEOUT_MS,
    retryAttemptTimeoutMs: Math.min(
      requestTimeoutMs,
      RUNPOD_LOAD_BALANCER_RETRY_ATTEMPT_TIMEOUT_MS,
    ),
    attemptCount: 0,
    attempts: [],
    readinessCheck: null,
    postFailureStatusCheck: null,
    decision: "failed_no_retry",
  };
}

async function throwRunpodLoadBalancerErrorWithStatusCheck(params: {
  error: Error;
  diagnostics: RunpodFinalReplyDiagnostics;
  endpointId: string;
  model: string;
}): Promise<never> {
  params.diagnostics.postFailureStatusCheck ??=
    await collectRunpodLoadBalancerPostFailureStatusCheck({
      endpointId: params.endpointId,
      model: params.model,
    });
  throw new FinalReplyProviderRequestError(params.error.message, params.diagnostics);
}

async function collectRunpodLoadBalancerPostFailureStatusCheck(params: {
  endpointId: string;
  model: string;
}): Promise<RunpodFinalReplyPostFailureStatusCheckDiagnostics> {
  const startedAt = Date.now();
  const [ping, models] = await Promise.all([
    checkRunpodLoadBalancerPing(params.endpointId),
    checkRunpodLoadBalancerModels(params.endpointId, params.model),
  ]);

  return {
    trigger: "rewrite_failure",
    timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
    durationMs: Date.now() - startedAt,
    ping,
    models,
    verdict: resolveRunpodPostFailureVerdict({ ping, models }),
  };
}

async function checkRunpodLoadBalancerPing(
  endpointId: string,
): Promise<RunpodFinalReplyStatusCheckStepDiagnostics> {
  const startedAt = Date.now();
  try {
    const ping = await getRunpodLoadBalancerPing(endpointId, {
      timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
    });
    const ready = isRunpodLoadBalancerReadyPing(ping);
    return {
      timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      status: ready ? "ok" : ping.ok ? "not_ready" : "failed",
      httpStatus: ping.status,
      responseTextPreview: ping.text ? ping.text.slice(0, 160) : null,
    };
  } catch (error) {
    const normalizedError = toError(error);
    return {
      timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      status: getRunpodLoadBalancerFailureStatus(normalizedError),
      httpStatus: getRunpodErrorHttpStatus(normalizedError),
      errorMessage: normalizedError.message,
    };
  }
}

async function checkRunpodLoadBalancerModels(
  endpointId: string,
  requestedModel: string,
): Promise<RunpodFinalReplyStatusCheckStepDiagnostics> {
  const startedAt = Date.now();
  try {
    const response = await listRunpodLoadBalancerModels(endpointId, {
      timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
    });
    const modelIds =
      response.data
        ?.map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
        .filter(Boolean) ?? [];
    return {
      timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      status: "ok",
      httpStatus: 200,
      modelCount: modelIds.length,
      requestedModelFound: modelIds.includes(requestedModel),
      modelIds: modelIds.slice(0, 8),
    };
  } catch (error) {
    const normalizedError = toError(error);
    return {
      timeoutMs: RUNPOD_POST_FAILURE_STATUS_CHECK_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      status: getRunpodLoadBalancerFailureStatus(normalizedError),
      httpStatus: getRunpodErrorHttpStatus(normalizedError),
      errorMessage: normalizedError.message,
    };
  }
}

function resolveRunpodPostFailureVerdict(params: {
  ping: RunpodFinalReplyStatusCheckStepDiagnostics;
  models: RunpodFinalReplyStatusCheckStepDiagnostics;
}) {
  if (params.ping.status === "timeout" || params.ping.status === "failed") {
    return "RunPod load balancer 또는 worker health 응답 문제가 감지되었습니다.";
  }
  if (params.ping.status === "not_ready") {
    return "RunPod worker가 아직 ready 상태가 아닙니다.";
  }
  if (params.models.status === "timeout" || params.models.status === "failed") {
    return "RunPod worker는 응답하지만 vLLM OpenAI router 응답 문제가 감지되었습니다.";
  }
  if (params.models.requestedModelFound === false) {
    return "vLLM router는 응답하지만 요청한 served model이 model list에 없습니다.";
  }
  return "RunPod worker와 vLLM router는 응답합니다. generation 요청 지연 또는 모델 처리 지연 가능성이 큽니다.";
}

async function executeRunpodLoadBalancerChatCompletionAttempt(params: {
  attempt: number;
  timeoutMs: number;
  diagnostics: RunpodFinalReplyDiagnostics;
  endpointId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) {
  const attemptStartedAt = Date.now();
  try {
    const response = await createRunpodLoadBalancerChatCompletion({
      endpointId: params.endpointId,
      model: params.model,
      messages: params.messages,
      maxTokens: appConfig.finalReply.maxTokens,
      temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
      timeoutMs: params.timeoutMs,
    });
    params.diagnostics.attempts.push({
      attempt: params.attempt,
      timeoutMs: params.timeoutMs,
      durationMs: Date.now() - attemptStartedAt,
      status: "ok",
    });
    params.diagnostics.attemptCount = params.diagnostics.attempts.length;
    return response;
  } catch (error) {
    const normalizedError = toError(error);
    params.diagnostics.attempts.push({
      attempt: params.attempt,
      timeoutMs: params.timeoutMs,
      durationMs: Date.now() - attemptStartedAt,
      status: getRunpodLoadBalancerFailureStatus(normalizedError),
      httpStatus: getRunpodErrorHttpStatus(normalizedError),
      errorMessage: normalizedError.message,
    });
    params.diagnostics.attemptCount = params.diagnostics.attempts.length;
    throw normalizedError;
  }
}

function getRunpodLoadBalancerAttemptTimeout(params: {
  deadline: number;
  capMs: number;
}) {
  return Math.max(1_000, Math.min(params.capMs, getRemainingTimeoutMs(params.deadline)));
}

function getRemainingTimeoutMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

function maskEndpointId(endpointId: string) {
  const trimmed = endpointId.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-6)}`;
}

async function waitForRunpodLoadBalancerReady(params: {
  endpointId: string;
  deadline: number;
}) {
  let lastPing: Awaited<ReturnType<typeof getRunpodLoadBalancerPing>> | null = null;
  let lastError: Error | null = null;

  while (Date.now() < params.deadline) {
    try {
      lastPing = await getRunpodLoadBalancerPing(params.endpointId, {
        timeoutMs: Math.min(5_000, Math.max(1_000, params.deadline - Date.now())),
      });
      if (isRunpodLoadBalancerReadyPing(lastPing)) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    const retryDelayMs = Math.min(
      RUNPOD_LOAD_BALANCER_RETRY_DELAY_MS,
      Math.max(0, params.deadline - Date.now()),
    );
    if (retryDelayMs <= 0) {
      break;
    }
    await sleep(retryDelayMs);
  }

  const status = lastPing ? `last ping status=${lastPing.status}` : "no ping response";
  const text = lastPing?.text ? `; last ping body=${lastPing.text.slice(0, 120)}` : "";
  const error = lastError ? `; last error=${lastError.message}` : "";
  throw new Error(`Runpod load balancer is not ready: ${status}${text}${error}`);
}

function isRunpodLoadBalancerReadyPing(
  ping: Awaited<ReturnType<typeof getRunpodLoadBalancerPing>>,
) {
  if (!ping.ok) {
    return false;
  }

  const text = ping.text.trim();
  if (!text) {
    return false;
  }
  if (text === "ready") {
    return true;
  }

  try {
    const payload = JSON.parse(text) as { status?: unknown };
    return payload.status === "ok";
  } catch {
    return text.toLowerCase().includes("ok");
  }
}

function isRetryableRunpodLoadBalancerError(error: Error) {
  if (isRunpodAbortOrTimeoutError(error)) {
    return false;
  }
  if (error instanceof RunpodApiRequestError && error.status === 500) {
    return true;
  }
  return RUNPOD_LOAD_BALANCER_RETRYABLE_MESSAGES.some((message) =>
    error.message.includes(message),
  );
}

function getRunpodLoadBalancerFailureStatus(
  error: Error,
): RunpodFinalReplyAttemptStatus {
  if (isRunpodAbortOrTimeoutError(error)) {
    return "timeout";
  }
  if (error.message.includes("Runpod load balancer is not ready")) {
    return "not_ready";
  }
  return "failed";
}

function getRunpodErrorHttpStatus(error: Error) {
  if (error instanceof RunpodApiRequestError) {
    return error.status;
  }
  const statusMatch = error.message.match(/\((\d{3})\)/u);
  if (!statusMatch?.[1]) {
    return null;
  }
  const status = Number(statusMatch[1]);
  return Number.isFinite(status) ? status : null;
}

function isRunpodAbortOrTimeoutError(error: Error) {
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name.includes("abort") ||
    name.includes("timeout") ||
    message.includes("the operation was aborted") ||
    message.includes("this operation was aborted") ||
    message.includes("operation was aborted") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBasetenGenerate(params: {
  modelId: string;
  modelUrl: string | null;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createBasetenChatCompletion({
    modelId: params.modelId,
    modelUrl: params.modelUrl,
    model: params.model,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
    timeoutMs: appConfig.finalReply.timeoutMs,
  });
  return extractBasetenChatText(response) ?? "";
}

export async function runCodexGenerate(params: {
  models: string[];
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}): Promise<{ text: string; model: string }> {
  let lastError: Error | null = null;

  for (const model of params.models) {
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          "codex",
          [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--dangerously-bypass-approvals-and-sandbox",
            "-C",
            PROJECT_ROOT,
            "-m",
            model,
            ...buildCodexCliModelConfigArgs("final_reply", model),
            "-",
          ],
          {
            cwd: PROJECT_ROOT,
            env: buildCodexCliChildEnv(PROJECT_ROOT),
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`codex exec timed out after 120000ms for model=${model}`));
        }, 120000);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(
              new Error(
                stderr.trim() || stdout.trim() || `codex exec failed for model=${model}.`,
              ),
            );
            return;
          }
          resolve(stdout.trim());
        });

        child.stdin.write(
          `${resolveSystemPrompt(params.npcId, params.promptFormat)}\n\n${params.prompt}`,
        );
        child.stdin.end();
      });

      if (text) {
        return { text, model };
      }

      lastError = new Error(`codex reply output was empty for model=${model}.`);
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Codex final reply generation failed.");
    }
  }

  throw lastError ?? new Error("Codex final reply generation failed.");
}

export async function runOpenAiGenerate(params: {
  models: string[];
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}): Promise<{ text: string; model: string }> {
  let lastError: Error | null = null;

  for (const model of params.models) {
    try {
      const generated = await createOpenAiResponse({
        stageName: "final_reply",
        model,
        input: [
          {
            role: "system",
            content: resolveSystemPrompt(params.npcId, params.promptFormat),
          },
          {
            role: "user",
            content: params.prompt,
          },
        ],
        maxOutputTokens: Math.max(
          appConfig.finalReply.maxTokens,
          OPENAI_FINAL_REPLY_MIN_OUTPUT_TOKENS,
        ),
        timeoutMs: appConfig.finalReply.timeoutMs,
      });

      if (generated.outputText) {
        return { text: generated.outputText, model };
      }

      lastError = new Error(
        [
          `OpenAI final reply output was empty for model=${model}.`,
          generated.payload.status ? `status=${generated.payload.status}` : null,
          generated.payload.incomplete_details?.reason
            ? `reason=${generated.payload.incomplete_details.reason}`
            : null,
        ].filter(Boolean).join(" "),
      );
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("OpenAI final reply generation failed.");
    }
  }

  throw lastError ?? new Error("OpenAI final reply generation failed.");
}

export function isBaseten400RequestError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Baseten inference request failed (400)")
  );
}
