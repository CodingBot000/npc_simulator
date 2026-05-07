import { getScriptEnv } from "./_script-runtime.mjs";

const DEFAULT_CACHE_PREFIX = "npc-simulator:v1";
const DEFAULT_RETRY_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsePositiveIntEnv(key, projectRoot, defaultValue) {
  const rawValue = getScriptEnv(key, projectRoot);
  if (!rawValue) {
    return defaultValue;
  }
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseBooleanEnv(key, projectRoot, defaultValue) {
  const rawValue = trimToNull(getScriptEnv(key, projectRoot));
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

function parseReasoningEffortEnv(key, projectRoot, defaultValue) {
  const rawValue = getScriptEnv(key, projectRoot);
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

function parseTextVerbosityEnv(key, projectRoot, defaultValue) {
  const rawValue = getScriptEnv(key, projectRoot);
  if (rawValue === "low" || rawValue === "medium" || rawValue === "high") {
    return rawValue;
  }
  return defaultValue;
}

function parsePromptCacheRetentionEnv(projectRoot) {
  const rawValue = getScriptEnv("OPENAI_PROMPT_CACHE_RETENTION", projectRoot);
  return rawValue === "24h" || rawValue === "in_memory" ? rawValue : "in_memory";
}

function getPromptCachePrefix(projectRoot) {
  return getScriptEnv("OPENAI_PROMPT_CACHE_PREFIX", projectRoot) || DEFAULT_CACHE_PREFIX;
}

export function getOpenAiStageProfile(stageName, projectRoot) {
  const cachePrefix = getPromptCachePrefix(projectRoot);
  const promptCacheRetention = parsePromptCacheRetentionEnv(projectRoot);

  if (stageName === "eval_judge") {
    return {
      stageName,
      reasoningEffort: parseReasoningEffortEnv(
        "OPENAI_EVAL_JUDGE_REASONING_EFFORT",
        projectRoot,
        "minimal",
      ),
      textVerbosity: parseTextVerbosityEnv(
        "OPENAI_EVAL_JUDGE_TEXT_VERBOSITY",
        projectRoot,
        "low",
      ),
      maxOutputTokens: parsePositiveIntEnv(
        "OPENAI_EVAL_JUDGE_MAX_OUTPUT_TOKENS",
        projectRoot,
        1200,
      ),
      promptCacheKey: `${cachePrefix}:eval-judge`,
      promptCacheRetention,
    };
  }

  return {
    stageName,
    reasoningEffort: parseReasoningEffortEnv(
      "OPENAI_INTERACTION_JUDGE_REASONING_EFFORT",
      projectRoot,
      "minimal",
    ),
    textVerbosity: parseTextVerbosityEnv(
      "OPENAI_INTERACTION_JUDGE_TEXT_VERBOSITY",
      projectRoot,
      "low",
    ),
    maxOutputTokens: parsePositiveIntEnv(
      "OPENAI_INTERACTION_JUDGE_MAX_OUTPUT_TOKENS",
      projectRoot,
      900,
    ),
    promptCacheKey: `${cachePrefix}:judge`,
    promptCacheRetention,
  };
}

function modelSupportsGpt5Controls(model) {
  return /^gpt-5(?:[.-]|$)/u.test(String(model ?? "").trim().toLowerCase());
}

function resolvePromptCacheRetention(model, profile) {
  const normalized = String(model ?? "").trim().toLowerCase();
  if (profile.promptCacheRetention === "in_memory" && /^gpt-5\.5(?:[.-]|$)/u.test(normalized)) {
    return "24h";
  }
  return profile.promptCacheRetention;
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableNetworkError(error) {
  return (
    error instanceof Error &&
    (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /fetch failed|network|timeout|terminated|econnreset|etimedout/iu.test(error.message)
    )
  );
}

function isRetryableOpenAiError(error) {
  return error?.retryable === true || isRetryableNetworkError(error);
}

function getRetryMaxAttempts(projectRoot) {
  return Math.min(
    parsePositiveIntEnv(
      "OPENAI_RETRY_MAX_ATTEMPTS",
      projectRoot,
      DEFAULT_RETRY_MAX_ATTEMPTS,
    ),
    2,
  );
}

function getRetryDelayMs(projectRoot, retryIndex) {
  const baseDelayMs = parsePositiveIntEnv(
    "OPENAI_RETRY_BASE_DELAY_MS",
    projectRoot,
    DEFAULT_RETRY_BASE_DELAY_MS,
  );
  return baseDelayMs * 2 ** retryIndex + Math.floor(Math.random() * 150);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function extractOpenAiOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textChunks =
    payload?.output
      ?.flatMap((entry) => entry.content ?? [])
      .filter((entry) => entry.type === "output_text" && typeof entry.text === "string")
      .map((entry) => entry.text.trim())
      .filter(Boolean) ?? [];

  return textChunks.join("\n").trim();
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function calculateEstimatedCostUsd({ model, inputTokens, cachedInputTokens, outputTokens }) {
  if (!/^gpt-5-nano(?:[.-]|$)/u.test(String(model ?? "").trim().toLowerCase())) {
    return null;
  }

  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const inputCost = (billableInputTokens / 1_000_000) * 0.05;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * 0.005;
  const outputCost = (outputTokens / 1_000_000) * 0.4;
  return Number((inputCost + cachedInputCost + outputCost).toFixed(10));
}

function buildUsageLog({ payload, model, stageName, latencyMs, retryCount }) {
  const usage = payload?.usage ?? {};
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
      model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    }),
    model,
    stage_name: stageName,
    latency_ms: latencyMs,
    retry_count: retryCount,
  };
}

function logUsage(projectRoot, usageLog) {
  if (!parseBooleanEnv("OPENAI_USAGE_LOG_ENABLED", projectRoot, true)) {
    return;
  }
  console.info("[openai-responses]", JSON.stringify(usageLog));
}

function buildBody({ model, input, textFormat, profile, maxOutputTokens }) {
  const supportsGpt5Controls = modelSupportsGpt5Controls(model);
  const text = {};
  if (supportsGpt5Controls) {
    text.verbosity = profile.textVerbosity;
  }
  if (textFormat) {
    text.format = textFormat;
  }

  const body = {
    model,
    input,
    store: false,
    max_output_tokens: maxOutputTokens ?? profile.maxOutputTokens,
    prompt_cache_key: profile.promptCacheKey,
    prompt_cache_retention: resolvePromptCacheRetention(model, profile),
  };

  if (supportsGpt5Controls) {
    body.reasoning = {
      effort: profile.reasoningEffort,
    };
  }
  if (Object.keys(text).length > 0) {
    body.text = text;
  }

  return body;
}

export async function createOpenAiResponse({
  projectRoot,
  apiKey,
  model,
  stageName,
  input,
  textFormat,
  maxOutputTokens,
  timeoutMs,
}) {
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is required.");
    error.retryable = false;
    throw error;
  }

  const profile = getOpenAiStageProfile(stageName, projectRoot);
  const body = buildBody({ model, input, textFormat, profile, maxOutputTokens });
  const maxRetries = getRetryMaxAttempts(projectRoot);
  const startedAtMs = Date.now();
  let lastError = null;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        const error = new Error(
          payload?.error?.message ||
            `OpenAI Responses request failed with HTTP ${response.status}.`,
        );
        error.status = response.status;
        error.retryable = isRetryableStatus(response.status);
        throw error;
      }

      const usageLog = buildUsageLog({
        payload,
        model,
        stageName,
        latencyMs: Date.now() - startedAtMs,
        retryCount: attemptIndex,
      });
      logUsage(projectRoot, usageLog);

      return {
        payload,
        outputText: extractOpenAiOutputText(payload),
        model,
        usageLog,
      };
    } catch (error) {
      lastError = error;
      if (attemptIndex >= maxRetries || !isRetryableOpenAiError(error)) {
        break;
      }
      await wait(getRetryDelayMs(projectRoot, attemptIndex));
    }
  }

  throw lastError ?? new Error("OpenAI Responses request failed.");
}

export function buildCodexCliModelConfigArgs(stageName, projectRoot, model) {
  if (!modelSupportsGpt5Controls(model)) {
    return [];
  }
  const profile = getOpenAiStageProfile(stageName, projectRoot);
  return [
    "-c",
    `model_reasoning_effort=${profile.reasoningEffort}`,
    "-c",
    `model_verbosity=${profile.textVerbosity}`,
  ];
}
