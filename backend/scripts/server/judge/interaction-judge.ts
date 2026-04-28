import type {
  InteractionJudgeResult,
} from "@backend-contracts/api";
import { appConfig } from "@server/config";
import { openAiConfig } from "@server/config/openai";
import type { InteractionContract } from "@server/engine/interaction-contract";
import { PLAYER_ACTION_SPECS } from "@server/engine/interaction-action-spec";

type RawRecord = Record<string, unknown>;

type OpenAiJudgeResponsePayload = {
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
};

type ParsedJudgePayload = {
  aligned?: unknown;
  targetMaintained?: unknown;
  fatalMismatch?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

const JUDGE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "aligned",
    "targetMaintained",
    "fatalMismatch",
    "confidence",
    "reason",
  ],
  properties: {
    aligned: {
      type: "boolean",
      description: "Whether the reply broadly preserves the selected action intent.",
    },
    targetMaintained: {
      type: "boolean",
      description: "Whether the required target is not clearly lost or replaced.",
    },
    fatalMismatch: {
      type: "boolean",
      description: "Whether the reply is clearly about a different action or target.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Classifier confidence from 0 to 1.",
    },
    reason: {
      type: "string",
      maxLength: 80,
      description: "One short Korean sentence explaining the decision.",
    },
  },
} as const;

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeInlineText(text: string) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function extractOpenAiOutputText(payload: OpenAiJudgeResponsePayload) {
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

function shouldRetryWithoutOptionalParams(message: string) {
  return /unsupported|unknown|unrecognized|not supported|temperature/iu.test(message);
}

function buildSkippedResult(params: {
  reason: string;
  durationMs: number | null;
}): InteractionJudgeResult {
  return {
    status: "skipped",
    sourceRef: null,
    model: null,
    aligned: null,
    targetMaintained: null,
    fatalMismatch: null,
    confidence: null,
    reason: params.reason,
    durationMs: params.durationMs,
    error: null,
  };
}

function buildFailedResult(params: {
  model: string;
  error: string;
  durationMs: number;
}): InteractionJudgeResult {
  return {
    status: "failed",
    sourceRef: `openai:${params.model}:judge`,
    model: params.model,
    aligned: null,
    targetMaintained: null,
    fatalMismatch: null,
    confidence: null,
    reason: null,
    durationMs: params.durationMs,
    error: params.error,
  };
}

function buildSystemPrompt() {
  return [
    "Fast Korean dialogue classifier.",
    "Return strict JSON only. Do not rewrite.",
    "Judge meaning, not exact keywords.",
  ].join("\n");
}

function buildUserPrompt(params: {
  contract: InteractionContract;
  replyText: string;
}) {
  const action = params.contract.action;
  const spec = action ? PLAYER_ACTION_SPECS[action] : null;
  const targetLabel = params.contract.targetNpcLabel ?? "none";

  return JSON.stringify(
    {
      task: "Does reply preserve action intent and target?",
      a: spec
        ? {
            id: spec.id,
            label: spec.label,
            desc: spec.description,
            intent: spec.canonicalIntent,
            targetPolicy: spec.targetPolicy,
            frame:
              params.contract.mode === "combined"
                ? spec.combinedBias(params.contract.targetNpcLabel)
                : spec.actionOnlyFrame(params.contract.targetNpcLabel),
          }
        : null,
      mode: params.contract.mode,
      target: {
        id: params.contract.targetNpcId,
        label: targetLabel,
      },
      move: params.contract.canonicalPlayerMove,
      player: params.contract.normalizedPlayerText,
      reply: params.replyText,
      rules: "No keyword matching. fatalMismatch only if clearly different action/target. reason <= 60 Korean chars.",
    },
  );
}

function parseJudgePayload(rawText: string): Omit<InteractionJudgeResult, "status" | "sourceRef" | "model" | "durationMs" | "error"> {
  const parsed = JSON.parse(rawText) as ParsedJudgePayload;
  const aligned = parsed.aligned === true;
  const targetMaintained = parsed.targetMaintained === true;
  const fatalMismatch = parsed.fatalMismatch === true;
  const numericConfidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : 0;
  const confidence = Math.max(0, Math.min(1, numericConfidence));
  const reason = trimToNull(typeof parsed.reason === "string" ? parsed.reason : null);

  return {
    aligned,
    targetMaintained,
    fatalMismatch,
    confidence,
    reason,
  };
}

async function requestJudge(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  includeTemperature: boolean;
}) {
  const apiKey = openAiConfig.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for interaction Judge.");
  }

  const body: RawRecord = {
    model: params.model,
    input: [
      {
        role: "system",
        content: params.systemPrompt,
      },
      {
        role: "user",
        content: params.userPrompt,
      },
    ],
    max_output_tokens: appConfig.interactionJudge.maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: "interaction_judge",
        schema: JUDGE_RESPONSE_SCHEMA,
        strict: true,
      },
    },
  };

  if (params.includeTemperature) {
    body.temperature = 0;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(appConfig.interactionJudge.timeoutMs),
  });

  const payload = (await response.json()) as OpenAiJudgeResponsePayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI Judge request failed.");
  }

  const outputText = extractOpenAiOutputText(payload);
  if (payload.status === "incomplete") {
    throw new Error(
      `OpenAI Judge incomplete: ${payload.incomplete_details?.reason ?? "unknown"}.`,
    );
  }
  if (!outputText) {
    throw new Error("OpenAI Judge did not include parseable output text.");
  }

  return outputText;
}

export async function maybeJudgeInteractionReply(params: {
  contract: InteractionContract;
  replyText: string;
}): Promise<InteractionJudgeResult> {
  const startedAtMs = Date.now();
  const model = appConfig.interactionJudge.model;

  if (appConfig.interactionJudge.mode === "off") {
    return buildSkippedResult({
      reason: "interaction Judge가 비활성화되어 있습니다.",
      durationMs: 0,
    });
  }

  if (!openAiConfig.apiKey) {
    return buildSkippedResult({
      reason: "OPENAI_API_KEY가 없어 interaction Judge를 건너뜁니다.",
      durationMs: 0,
    });
  }

  if (!params.contract.action) {
    return buildSkippedResult({
      reason: "선택 액션이 없는 free_text라 interaction Judge를 건너뜁니다.",
      durationMs: 0,
    });
  }

  const replyText = normalizeInlineText(params.replyText);
  if (!replyText) {
    return buildSkippedResult({
      reason: "Judge 대상 reply가 비어 있습니다.",
      durationMs: 0,
    });
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    contract: params.contract,
    replyText,
  });
  const attempts = [
    { includeTemperature: true },
    { includeTemperature: false },
  ];
  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const outputText = await requestJudge({
        model,
        systemPrompt,
        userPrompt,
        includeTemperature: attempt.includeTemperature,
      });
      const parsed = parseJudgePayload(outputText);
      const durationMs = Date.now() - startedAtMs;
      const aligned = parsed.aligned === true;
      const targetMaintained = parsed.targetMaintained === true;
      const fatalMismatch = parsed.fatalMismatch === true;

      return {
        status:
          aligned && targetMaintained && !fatalMismatch ? "aligned" : "misaligned",
        sourceRef: `openai:${model}:judge`,
        model,
        aligned,
        targetMaintained,
        fatalMismatch,
        confidence: parsed.confidence,
        reason: parsed.reason,
        durationMs,
        error: null,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("OpenAI Judge failed with an unknown error.");
      if (!shouldRetryWithoutOptionalParams(lastError.message)) {
        break;
      }
    }
  }

  return buildFailedResult({
    model,
    error: lastError?.message ?? "OpenAI Judge failed without an error message.",
    durationMs: Date.now() - startedAtMs,
  });
}
