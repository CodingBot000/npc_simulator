import { spawn } from "node:child_process";
import type { GenerateInteractionInput } from "@backend-provider";
import type {
  InteractionFailureDebugEntry,
  InteractionTraceEntry,
  InteractionTraceStage,
  InteractionTraceStatus,
} from "@backend-contracts/api";
import {
  buildCodexCliChildEnv,
  buildModelExecutionChildEnv,
} from "@backend-support/bootstrap";
import { PROJECT_ROOT, appConfig } from "@server/config";
import {
  createBasetenChatCompletion,
  extractBasetenChatText,
} from "@server/baseten-client";
import { openAiConfig } from "@server/config/openai";
import { validateReplyAgainstContract } from "@server/engine/interaction-contract";
import {
  LOCAL_MLX_BINARY,
  buildOpenAiFallbackReplyConfig,
  hasMlxBinary,
  hasRuntimeArtifact,
  resolveAdapterConfigForNpc,
  type BasetenAdapterConfig,
  type CodexReplyConfig,
  type LocalReplyBackendConfig,
  type OpenAiReplyConfig,
  type ResolvedAdapterConfig,
  type RunpodAdapterConfig,
  type TogetherAdapterConfig,
} from "@server/providers/mlx-reply-config";
import {
  buildPrompt,
  resolveInteractionContract,
  resolveSystemPrompt,
  type FinalReplyRewriteSeed,
  type ScenePromptFormat,
} from "@server/providers/mlx-reply-prompts";
import {
  compactSentence,
  containsAnyPattern,
  extractDelimitedText,
  looksEnglishOnly,
  normalizeInlineText,
  normalizeReplyText,
} from "@server/providers/mlx-reply-text-utils";
import {
  createRunpodVllmRunSync,
  extractRunpodVllmText,
} from "@server/runpod-client";
import {
  createTogetherChatCompletion,
  extractTogetherChatText,
} from "@server/together-client";

type FinalReplyGenerationResult = {
  text: string | null;
  adapterPath: string | null;
  sourceRef: string;
  rejectedReason?: string | null;
  debugFailures?: InteractionFailureDebugEntry[] | null;
  trace?: InteractionTraceEntry[] | null;
};
type InteractionTraceContext = {
  originMs: number;
  entries: InteractionTraceEntry[];
};

type PendingInteractionTrace = {
  stage: InteractionTraceStage;
  label: string;
  detail?: string | null;
  sourceRef?: string | null;
  startedAtMs: number;
  startedAtAbsoluteMs: number;
};

const TARGET_SUBSTITUTION_PATTERNS = [/그 사람/u, /그녀/u, /저 사람/u] as const;
const TARGET_SUBSTITUTION_REPLACEMENTS = [/그 사람/gu, /그녀/gu, /저 사람/gu] as const;
const FINAL_REPLY_REWRITE_TEMPERATURE = 0.2;
const OPENAI_FALLBACK_FROM_BASETEN_400_MARKER = "fallback_from_baseten_400";

async function runMlxGenerate(args: string[]) {
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

async function runTogetherGenerate(params: {
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
  });
  return extractTogetherChatText(response) ?? "";
}

async function runRunpodGenerate(params: {
  endpointId: string;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createRunpodVllmRunSync({
    endpointId: params.endpointId,
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
  });
  return extractRunpodVllmText(response) ?? "";
}

async function runBasetenGenerate(params: {
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
  });
  return extractBasetenChatText(response) ?? "";
}

function summarizeRewriteRejection(params: {
  cleaned: string;
  validationIssues: ReturnType<typeof validateReplyAgainstContract>["issues"];
}) {
  if (!params.cleaned) {
    return "응답이 비어 있습니다.";
  }

  if (/^!+$/u.test(params.cleaned)) {
    return "의미 없는 기호만 나왔습니다.";
  }

  if (params.validationIssues.length > 0) {
    return params.validationIssues.map((issue) => issue.message).join(" / ");
  }

  return "최종 reply 검증을 통과하지 못했습니다.";
}

function buildRewriteFailureDebugEntry(params: {
  summary: string;
  sourceRef: string | null;
  validationIssues?: ReturnType<typeof validateReplyAgainstContract>["issues"];
  candidateReplyText?: string | null;
  kind: InteractionFailureDebugEntry["kind"];
}) {
  const issues =
    params.validationIssues && params.validationIssues.length > 0
      ? params.validationIssues.map((issue) => `${issue.code}: ${issue.message}`)
      : undefined;

  return {
    stage: "reply_rewrite",
    kind: params.kind,
    summary: params.summary,
    sourceRef: params.sourceRef,
    issues,
    candidateReplyText: params.candidateReplyText ?? null,
  } satisfies InteractionFailureDebugEntry;
}

function validateRewriteCandidate(params: {
  cleaned: string;
  contract: ReturnType<typeof resolveInteractionContract>;
  npcName: string;
  rewriteSeed?: FinalReplyRewriteSeed | null;
}) {
  const baseValidation = validateReplyAgainstContract({
    replyText: params.cleaned,
    contract: params.contract,
    npcName: params.npcName,
  });

  const issues = [...baseValidation.issues];
  return {
    ok: issues.length === 0,
    issues,
  };
}

function repairTargetNameSubstitution(params: {
  cleaned: string;
  contract: ReturnType<typeof resolveInteractionContract>;
  rewriteSeed?: FinalReplyRewriteSeed | null;
}) {
  const targetLabel = params.contract.targetNpcLabel?.trim();
  const draftReplyText = params.rewriteSeed?.draftReplyText ?? "";

  if (!targetLabel || !draftReplyText.includes(targetLabel)) {
    return {
      cleaned: params.cleaned,
      applied: false,
    };
  }

  if (
    params.cleaned.includes(targetLabel) ||
    !containsAnyPattern(params.cleaned, TARGET_SUBSTITUTION_PATTERNS)
  ) {
    return {
      cleaned: params.cleaned,
      applied: false,
    };
  }

  let repaired = params.cleaned;
  for (const pattern of TARGET_SUBSTITUTION_REPLACEMENTS) {
    repaired = repaired.replace(pattern, targetLabel);
  }

  return {
    cleaned: repaired,
    applied: repaired !== params.cleaned,
  };
}

function isBaseten400RequestError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Baseten inference request failed (400)")
  );
}

function startInteractionTraceStage(
  context: InteractionTraceContext,
  stage: InteractionTraceStage,
  label: string,
  detail?: string | null,
  sourceRef?: string | null,
): PendingInteractionTrace {
  const startedAtAbsoluteMs = Date.now();
  return {
    stage,
    label,
    detail,
    sourceRef,
    startedAtMs: Math.max(0, startedAtAbsoluteMs - context.originMs),
    startedAtAbsoluteMs,
  };
}

function finishInteractionTraceStage(
  context: InteractionTraceContext,
  pending: PendingInteractionTrace,
  status: InteractionTraceStatus,
  detail?: string | null,
  sourceRef?: string | null,
) {
  const finishedAtAbsoluteMs = Date.now();
  const finishedAtMs = Math.max(0, finishedAtAbsoluteMs - context.originMs);
  context.entries.push({
    stage: pending.stage,
    label: pending.label,
    status,
    startedAtMs: pending.startedAtMs,
    finishedAtMs,
    durationMs: Math.max(0, finishedAtAbsoluteMs - pending.startedAtAbsoluteMs),
    detail: detail ?? pending.detail ?? null,
    sourceRef: sourceRef ?? pending.sourceRef ?? null,
  });
}

interface OpenAiTextResponsePayload {
  error?: { message?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

function extractOpenAiOutputText(payload: OpenAiTextResponsePayload) {
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

async function runCodexGenerate(params: {
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

async function runOpenAiGenerate(params: {
  models: string[];
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}): Promise<{ text: string; model: string }> {
  const apiKey = openAiConfig.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when FINAL_REPLY_BACKEND=openai_api.");
  }

  let lastError: Error | null = null;

  for (const model of params.models) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
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
          max_output_tokens: appConfig.finalReply.maxTokens,
        }),
      });

      const payload = (await response.json()) as OpenAiTextResponsePayload;
      if (!response.ok) {
        throw new Error(payload.error?.message || `OpenAI response request failed for model=${model}.`);
      }

      const outputText = extractOpenAiOutputText(payload);
      if (outputText) {
        return { text: outputText, model };
      }

      lastError = new Error(`OpenAI final reply output was empty for model=${model}.`);
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("OpenAI final reply generation failed.");
    }
  }

  throw lastError ?? new Error("OpenAI final reply generation failed.");
}

export async function maybeGenerateFinalReply(
  input: GenerateInteractionInput,
  rewriteSeed?: FinalReplyRewriteSeed | null,
  options?: { traceOriginMs?: number },
): Promise<FinalReplyGenerationResult | null> {
  const mode = appConfig.finalReply.mode;
  if (mode === "off" || appConfig.finalReply.backend === "off") {
    return null;
  }

  const playerText = input.request.text || input.normalizedInput.promptSummary;
  if (looksEnglishOnly(playerText)) {
    return null;
  }

  const adapterConfig = await resolveAdapterConfigForNpc(input.npc.persona.id);
  if (!adapterConfig) {
    if (mode === "on") {
      throw new Error(
        `FINAL_REPLY_BACKEND=${appConfig.finalReply.backend} is configured but no runnable target is available.`,
      );
    }
    return null;
  }

  const debugFailures: InteractionFailureDebugEntry[] = [];
  const traceContext: InteractionTraceContext = {
    originMs: options?.traceOriginMs ?? Date.now(),
    entries: [],
  };

  async function runCandidatePrompt(
    candidatePrompt: string,
    config: ResolvedAdapterConfig = adapterConfig,
  ): Promise<{ text: string; sourceRef: string; adapterPath: string | null } | null> {
    let sourceRef: string = config.backend;
    let adapterPath: string | null = null;

    if (config.backend === "codex") {
      sourceRef = "codex";
      const generated = await runCodexGenerate({
        models: config.models,
        npcId: input.npc.persona.id,
        promptFormat: config.promptFormat,
        prompt: candidatePrompt,
      });
      return {
        text: generated.text,
        sourceRef: `codex:${generated.model}`,
        adapterPath,
      };
    }

    if (config.backend === "openai_api") {
      sourceRef = "openai";
      const generated = await runOpenAiGenerate({
        models: config.models,
        npcId: input.npc.persona.id,
        promptFormat: config.promptFormat,
        prompt: candidatePrompt,
      });
      return {
        text: generated.text,
        sourceRef: `openai:${generated.model}`,
        adapterPath,
      };
    }

    if (config.backend === "together") {
      sourceRef = `together:${config.model}`;
      return {
        text: await runTogetherGenerate({
          model: config.model,
          npcId: input.npc.persona.id,
          promptFormat: config.promptFormat,
          prompt: candidatePrompt,
        }),
        sourceRef,
        adapterPath,
      };
    }

    if (config.backend === "runpod") {
      sourceRef = `runpod:${config.endpointId}:${config.model}`;
      return {
        text: await runRunpodGenerate({
          endpointId: config.endpointId,
          model: config.model,
          npcId: input.npc.persona.id,
          promptFormat: config.promptFormat,
          prompt: candidatePrompt,
        }),
        sourceRef,
        adapterPath,
      };
    }

    if (config.backend === "baseten") {
      sourceRef = `baseten:${config.modelId}:${config.model}`;
      return {
        text: await runBasetenGenerate({
          modelId: config.modelId,
          modelUrl: config.modelUrl,
          model: config.model,
          npcId: input.npc.persona.id,
          promptFormat: config.promptFormat,
          prompt: candidatePrompt,
        }),
        sourceRef,
        adapterPath,
      };
    }

    const binaryAvailable = await hasMlxBinary();
    if (!binaryAvailable) {
      if (mode === "on") {
        throw new Error(`MLX binary not found: ${LOCAL_MLX_BINARY}`);
      }
      return null;
    }

    adapterPath = config.path;
    const adapterAvailable = await hasRuntimeArtifact(
      adapterPath,
      config.runtimeKind,
    );
    if (!adapterAvailable) {
      if (mode === "on") {
        throw new Error(`Runtime artifact not found: ${adapterPath}`);
      }
      return null;
    }

    sourceRef = `local:${config.mlxModel ?? appConfig.localReply.family}`;
    return {
      text: await runMlxGenerate(
        config.runtimeKind === "mlx_fused_model"
          ? [
              "--model",
              adapterPath,
              "--system-prompt",
              resolveSystemPrompt(input.npc.persona.id, config.promptFormat),
              "--prompt",
              candidatePrompt,
              "--max-tokens",
              String(appConfig.finalReply.maxTokens),
            ]
          : [
              "--model",
              config.mlxModel ?? appConfig.localReply.mlxModel,
              "--adapter-path",
              adapterPath,
              "--system-prompt",
              resolveSystemPrompt(input.npc.persona.id, config.promptFormat),
              "--prompt",
              candidatePrompt,
              "--max-tokens",
              String(appConfig.finalReply.maxTokens),
            ],
      ),
      sourceRef,
      adapterPath,
    };
  }

  const prompt = buildPrompt(input, adapterConfig.promptFormat, rewriteSeed);
  let generated;
  const requestTrace = startInteractionTraceStage(
    traceContext,
    "reply_rewrite_request",
    "final reply rewrite 요청",
    null,
    adapterConfig.backend,
  );
  try {
    generated = await runCandidatePrompt(prompt);
    if (!generated) {
      finishInteractionTraceStage(
        traceContext,
        requestTrace,
        "skipped",
        "rewrite 대상이 없어 건너뛰었습니다.",
        adapterConfig.backend,
      );
      return null;
    }
    finishInteractionTraceStage(
      traceContext,
      requestTrace,
      "ok",
      "rewrite 후보를 생성했습니다.",
      generated.sourceRef,
    );
  } catch (error) {
    const openAiFallbackConfig =
      adapterConfig.backend === "baseten" && isBaseten400RequestError(error)
        ? buildOpenAiFallbackReplyConfig()
        : null;
    const rejectionReason =
      error instanceof Error && error.message.trim()
        ? `rewrite 요청 실패: ${error.message.trim()}`
        : "rewrite 요청에 실패했습니다.";
    finishInteractionTraceStage(
      traceContext,
      requestTrace,
      "failed",
      rejectionReason,
      adapterConfig.backend,
    );
    if (openAiFallbackConfig) {
      debugFailures.push(
        buildRewriteFailureDebugEntry({
          summary: rejectionReason,
          sourceRef: adapterConfig.backend,
          kind: "request_error",
        }),
      );
      const openAiFallbackTrace = startInteractionTraceStage(
        traceContext,
        "reply_rewrite_retry_request",
        "Baseten 400 -> OpenAI fallback",
        null,
        "openai",
      );
      try {
        const fallbackGenerated = await runCandidatePrompt(prompt, openAiFallbackConfig);
        if (!fallbackGenerated) {
          throw new Error("OpenAI fallback did not return a rewrite candidate.");
        }
        generated = {
          ...fallbackGenerated,
          sourceRef: `${fallbackGenerated.sourceRef}:${OPENAI_FALLBACK_FROM_BASETEN_400_MARKER}`,
        };
        finishInteractionTraceStage(
          traceContext,
          openAiFallbackTrace,
          "ok",
          "Baseten 400으로 OpenAI fallback을 사용했습니다.",
          generated.sourceRef,
        );
      } catch (fallbackError) {
        const fallbackRejectionReason =
          fallbackError instanceof Error && fallbackError.message.trim()
            ? `OpenAI fallback 요청 실패: ${fallbackError.message.trim()}`
            : "OpenAI fallback 요청에 실패했습니다.";
        finishInteractionTraceStage(
          traceContext,
          openAiFallbackTrace,
          "failed",
          fallbackRejectionReason,
          "openai",
        );
        debugFailures.push(
          buildRewriteFailureDebugEntry({
            summary: fallbackRejectionReason,
            sourceRef: "openai",
            kind: "request_error",
          }),
        );
        return {
          text: null,
          adapterPath: null,
          sourceRef: adapterConfig.backend,
          rejectedReason: rejectionReason,
          debugFailures,
          trace: traceContext.entries,
        };
      }
    } else {
      debugFailures.push(
        buildRewriteFailureDebugEntry({
          summary: rejectionReason,
          sourceRef: adapterConfig.backend,
          kind: "request_error",
        }),
      );
      return {
        text: null,
        adapterPath: null,
        sourceRef: adapterConfig.backend,
        rejectedReason: rejectionReason,
        debugFailures,
        trace: traceContext.entries,
      };
    }
  }

  let { text, sourceRef, adapterPath } = generated;
  let normalized = text.trim();
  let cleaned = normalizeReplyText(normalized);
  const contract = resolveInteractionContract(input);
  const repairedCandidate = repairTargetNameSubstitution({
    cleaned,
    contract,
    rewriteSeed,
  });
  cleaned = repairedCandidate.cleaned;
  const validationTrace = startInteractionTraceStage(
    traceContext,
    "reply_rewrite_validation",
    "final reply rewrite 검증",
    null,
    sourceRef,
  );
  let validation = validateRewriteCandidate({
    cleaned,
    contract,
    npcName: input.npc.persona.name,
    rewriteSeed,
  });
  finishInteractionTraceStage(
    traceContext,
    validationTrace,
    validation.ok && cleaned && !/^!+$/u.test(cleaned) ? "ok" : "failed",
    validation.ok && cleaned && !/^!+$/u.test(cleaned)
      ? repairedCandidate.applied
        ? "초기 rewrite 후보를 채택할 수 있습니다. 타깃 이름 대명사 치환을 자동 보정했습니다."
        : "초기 rewrite 후보를 채택할 수 있습니다."
      : summarizeRewriteRejection({
          cleaned,
          validationIssues: validation.issues,
        }),
    sourceRef,
  );

  if (
    !cleaned ||
    /^!+$/u.test(cleaned) ||
    !validation.ok
  ) {
    if (debugFailures.length === 0) {
      debugFailures.push(
        buildRewriteFailureDebugEntry({
          summary: summarizeRewriteRejection({
            cleaned,
            validationIssues: validation.issues,
          }),
          sourceRef,
          validationIssues: validation.issues,
          candidateReplyText: cleaned || normalized,
          kind: "validation_error",
        }),
      );
    }
    return {
      text: null,
      adapterPath,
      sourceRef,
      rejectedReason: summarizeRewriteRejection({
        cleaned,
        validationIssues: validation.issues,
      }),
      debugFailures,
      trace: traceContext.entries,
    };
  }

  return {
    text: cleaned,
    adapterPath,
    sourceRef,
    debugFailures: debugFailures.length > 0 ? debugFailures : null,
    trace: traceContext.entries,
  };
}

export const maybeGenerateReplyWithLocalAdapter = maybeGenerateFinalReply;
