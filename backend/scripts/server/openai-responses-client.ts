import { getServerEnv } from "@server/config";
import { openAiConfig } from "@server/config/openai";

export type OpenAiStageName =
  | "interaction"
  | "interaction_judge"
  | "final_reply"
  | "eval_judge";

type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type TextVerbosity = "low" | "medium" | "high";
type PromptCacheRetention = "in_memory" | "24h";

type OpenAiResponseUsagePayload = {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
};

export type OpenAiResponsesPayload = {
  error?: { message?: string };
  status?: string;
  incomplete_details?: { reason?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: OpenAiResponseUsagePayload;
};

export type OpenAiJsonSchemaFormat = {
  type: "json_schema";
  name: string;
  schema: unknown;
  strict: true;
};

export type OpenAiStageProfile = {
  stageName: OpenAiStageName;
  reasoningEffort: ReasoningEffort;
  textVerbosity: TextVerbosity;
  maxOutputTokens: number;
  promptCacheKey: string;
  promptCacheRetention: PromptCacheRetention;
};

export type OpenAiUsageLog = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_hit: boolean;
  estimated_cost_usd: number | null;
  model: string;
  stage_name: OpenAiStageName;
  latency_ms: number;
  retry_count: number;
};

export class OpenAiResponseRequestError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, params: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "OpenAiResponseRequestError";
    this.status = params.status ?? null;
    this.retryable = params.retryable ?? false;
  }
}

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsePositiveIntEnv(key: string, defaultValue: number) {
  const rawValue = getServerEnv(key);
  if (!rawValue) {
    return defaultValue;
  }
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseBooleanEnv(key: string, defaultValue: boolean) {
  const rawValue = trimToNull(getServerEnv(key));
  if (!rawValue) {
    return defaultValue;
  }
  const normalized = rawValue.toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  return defaultValue;
}

function parseReasoningEffortEnv(key: string, defaultValue: ReasoningEffort) {
  const rawValue = getServerEnv(key);
  if (
    rawValue === "minimal" ||
    rawValue === "low" ||
    rawValue === "medium" ||
    rawValue === "high"
  ) {
    return rawValue;
  }
  return defaultValue;
}

function parseTextVerbosityEnv(key: string, defaultValue: TextVerbosity) {
  const rawValue = getServerEnv(key);
  if (rawValue === "low" || rawValue === "medium" || rawValue === "high") {
    return rawValue;
  }
  return defaultValue;
}

function parsePromptCacheRetentionEnv(defaultValue: PromptCacheRetention) {
  const rawValue = getServerEnv("OPENAI_PROMPT_CACHE_RETENTION");
  if (rawValue === "in_memory" || rawValue === "24h") {
    return rawValue;
  }
  return defaultValue;
}

function getPromptCachePrefix() {
  return getServerEnv("OPENAI_PROMPT_CACHE_PREFIX") || "npc-simulator:v1";
}

export function getOpenAiStageProfile(stageName: OpenAiStageName): OpenAiStageProfile {
  const cachePrefix = getPromptCachePrefix();
  const cacheRetention = parsePromptCacheRetentionEnv("in_memory");

  switch (stageName) {
    case "interaction":
      return {
        stageName,
        reasoningEffort: parseReasoningEffortEnv("OPENAI_INTERACTION_REASONING_EFFORT", "minimal"),
        textVerbosity: parseTextVerbosityEnv("OPENAI_INTERACTION_TEXT_VERBOSITY", "low"),
        maxOutputTokens: parsePositiveIntEnv(
          "OPENAI_INTERACTION_MAX_OUTPUT_TOKENS",
          parsePositiveIntEnv("INTERACTION_MAX_OUTPUT_TOKENS", 900),
        ),
        promptCacheKey: `${cachePrefix}:interaction`,
        promptCacheRetention: cacheRetention,
      };
    case "interaction_judge":
      return {
        stageName,
        reasoningEffort: parseReasoningEffortEnv("OPENAI_INTERACTION_JUDGE_REASONING_EFFORT", "minimal"),
        textVerbosity: parseTextVerbosityEnv("OPENAI_INTERACTION_JUDGE_TEXT_VERBOSITY", "low"),
        maxOutputTokens: parsePositiveIntEnv(
          "OPENAI_INTERACTION_JUDGE_MAX_OUTPUT_TOKENS",
          parsePositiveIntEnv("INTERACTION_JUDGE_MAX_OUTPUT_TOKENS", 400),
        ),
        promptCacheKey: `${cachePrefix}:judge`,
        promptCacheRetention: cacheRetention,
      };
    case "final_reply":
      return {
        stageName,
        reasoningEffort: parseReasoningEffortEnv("OPENAI_FINAL_REPLY_REASONING_EFFORT", "low"),
        textVerbosity: parseTextVerbosityEnv("OPENAI_FINAL_REPLY_TEXT_VERBOSITY", "medium"),
        maxOutputTokens: parsePositiveIntEnv(
          "OPENAI_FINAL_REPLY_MAX_OUTPUT_TOKENS",
          parsePositiveIntEnv("FINAL_REPLY_MAX_TOKENS", 160),
        ),
        promptCacheKey: `${cachePrefix}:final-reply`,
        promptCacheRetention: cacheRetention,
      };
    case "eval_judge":
      return {
        stageName,
        reasoningEffort: parseReasoningEffortEnv("OPENAI_EVAL_JUDGE_REASONING_EFFORT", "minimal"),
        textVerbosity: parseTextVerbosityEnv("OPENAI_EVAL_JUDGE_TEXT_VERBOSITY", "low"),
        maxOutputTokens: parsePositiveIntEnv("OPENAI_EVAL_JUDGE_MAX_OUTPUT_TOKENS", 1200),
        promptCacheKey: `${cachePrefix}:eval-judge`,
        promptCacheRetention: cacheRetention,
      };
  }
}

function modelSupportsGpt5Controls(model: string) {
  return /^gpt-5(?:[.-]|$)/u.test(model.trim().toLowerCase());
}

function resolvePromptCacheRetention(model: string, profile: OpenAiStageProfile) {
  const normalized = model.trim().toLowerCase();
  if (profile.promptCacheRetention === "in_memory" && /^gpt-5\.5(?:[.-]|$)/u.test(normalized)) {
    return "24h";
  }
  return profile.promptCacheRetention;
}

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /fetch failed|network|timeout|terminated|econnreset|etimedout/iu.test(error.message)
  );
}

function isRetryableOpenAiError(error: unknown) {
  if (error instanceof OpenAiResponseRequestError) {
    return error.retryable;
  }
  return isRetryableNetworkError(error);
}

function getRetryMaxAttempts() {
  return Math.min(parsePositiveIntEnv("OPENAI_RETRY_MAX_ATTEMPTS", 2), 2);
}

function getRetryBaseDelayMs() {
  return parsePositiveIntEnv("OPENAI_RETRY_BASE_DELAY_MS", 500);
}

function getRetryDelayMs(retryIndex: number) {
  const exponentialDelay = getRetryBaseDelayMs() * 2 ** retryIndex;
  const jitter = Math.floor(Math.random() * 150);
  return exponentialDelay + jitter;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse(response: Response) {
  try {
    return (await response.json()) as OpenAiResponsesPayload;
  } catch {
    return {} as OpenAiResponsesPayload;
  }
}

export function extractOpenAiOutputText(payload: OpenAiResponsesPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textChunks =
    payload.output
      ?.flatMap((entry) => entry.content ?? [])
      .filter((entry) => entry.type === "output_text" && typeof entry.text === "string")
      .map((entry) => entry.text!.trim())
      .filter(Boolean) ?? [];

  return textChunks.join("\n").trim();
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function calculateEstimatedCostUsd(params: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}) {
  if (!/^gpt-5-nano(?:[.-]|$)/u.test(params.model.trim().toLowerCase())) {
    return null;
  }

  const billableInputTokens = Math.max(0, params.inputTokens - params.cachedInputTokens);
  const inputCost = (billableInputTokens / 1_000_000) * 0.05;
  const cachedInputCost = (params.cachedInputTokens / 1_000_000) * 0.005;
  const outputCost = (params.outputTokens / 1_000_000) * 0.4;

  return Number((inputCost + cachedInputCost + outputCost).toFixed(10));
}

export function buildOpenAiUsageLog(params: {
  payload: OpenAiResponsesPayload;
  model: string;
  stageName: OpenAiStageName;
  latencyMs: number;
  retryCount: number;
}): OpenAiUsageLog {
  const usage = params.payload.usage ?? {};
  const inputTokens = safeNumber(usage.input_tokens ?? usage.prompt_tokens);
  const cachedInputTokens = safeNumber(
    usage.input_tokens_details?.cached_tokens ??
      usage.prompt_tokens_details?.cached_tokens,
  );
  const outputTokens = safeNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = safeNumber(usage.total_tokens) || inputTokens + outputTokens;

  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cache_hit: cachedInputTokens > 0,
    estimated_cost_usd: calculateEstimatedCostUsd({
      model: params.model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    }),
    model: params.model,
    stage_name: params.stageName,
    latency_ms: params.latencyMs,
    retry_count: params.retryCount,
  };
}

function logOpenAiUsage(usageLog: OpenAiUsageLog) {
  if (!parseBooleanEnv("OPENAI_USAGE_LOG_ENABLED", true)) {
    return;
  }
  console.error("[openai-responses]", JSON.stringify(usageLog));
}

function buildResponseBody(params: {
  model: string;
  profile: OpenAiStageProfile;
  input: unknown;
  textFormat?: OpenAiJsonSchemaFormat;
  maxOutputTokens?: number;
}) {
  const supportsGpt5Controls = modelSupportsGpt5Controls(params.model);
  const text: Record<string, unknown> = {};
  if (supportsGpt5Controls) {
    text.verbosity = params.profile.textVerbosity;
  }
  if (params.textFormat) {
    text.format = params.textFormat;
  }

  const body: Record<string, unknown> = {
    model: params.model,
    input: params.input,
    store: false,
    max_output_tokens: params.maxOutputTokens ?? params.profile.maxOutputTokens,
    prompt_cache_key: params.profile.promptCacheKey,
    prompt_cache_retention: resolvePromptCacheRetention(params.model, params.profile),
  };

  if (supportsGpt5Controls) {
    body.reasoning = {
      effort: params.profile.reasoningEffort,
    };
  }
  if (Object.keys(text).length > 0) {
    body.text = text;
  }

  return body;
}

export async function createOpenAiResponse(params: {
  model: string;
  stageName: OpenAiStageName;
  input: unknown;
  textFormat?: OpenAiJsonSchemaFormat;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<{
  payload: OpenAiResponsesPayload;
  outputText: string;
  model: string;
  usageLog: OpenAiUsageLog;
}> {
  const apiKey = openAiConfig.apiKey;
  if (!apiKey) {
    throw new OpenAiResponseRequestError("OPENAI_API_KEY is required.", {
      retryable: false,
    });
  }

  const profile = getOpenAiStageProfile(params.stageName);
  const body = buildResponseBody({
    model: params.model,
    profile,
    input: params.input,
    textFormat: params.textFormat,
    maxOutputTokens: params.maxOutputTokens,
  });
  const maxRetries = getRetryMaxAttempts();
  const startedAtMs = Date.now();
  let lastError: unknown = null;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: params.timeoutMs ? AbortSignal.timeout(params.timeoutMs) : undefined,
      });

      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new OpenAiResponseRequestError(
          payload.error?.message ||
            `OpenAI Responses request failed with HTTP ${response.status}.`,
          {
            status: response.status,
            retryable: isRetryableStatus(response.status),
          },
        );
      }

      const usageLog = buildOpenAiUsageLog({
        payload,
        model: params.model,
        stageName: params.stageName,
        latencyMs: Date.now() - startedAtMs,
        retryCount: attemptIndex,
      });
      logOpenAiUsage(usageLog);

      return {
        payload,
        outputText: extractOpenAiOutputText(payload),
        model: params.model,
        usageLog,
      };
    } catch (error) {
      lastError = error;
      if (attemptIndex >= maxRetries || !isRetryableOpenAiError(error)) {
        break;
      }
      await wait(getRetryDelayMs(attemptIndex));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new OpenAiResponseRequestError("OpenAI Responses request failed.");
}

export function buildCodexCliModelConfigArgs(stageName: OpenAiStageName, model: string) {
  if (!modelSupportsGpt5Controls(model)) {
    return [];
  }

  const profile = getOpenAiStageProfile(stageName);
  return [
    "-c",
    `model_reasoning_effort=${profile.reasoningEffort}`,
    "-c",
    `model_verbosity=${profile.textVerbosity}`,
  ];
}
