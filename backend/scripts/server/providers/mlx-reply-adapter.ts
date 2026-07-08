import type { GenerateInteractionInput } from "@backend-provider";
import type {
  InteractionFailureDebugEntry,
  InteractionTraceEntry,
} from "@backend-contracts/api";
import { appConfig } from "@server/config";
import {
  extractFinalReplyProviderDiagnostics,
  generateFinalReplyCandidate,
  isBaseten400RequestError,
  OPENAI_FALLBACK_FROM_BASETEN_400_MARKER,
  OPENAI_FALLBACK_FROM_RUNPOD_ERROR_MARKER,
  withFinalReplyProviderDecision,
} from "@server/providers/final-reply-generation";
import {
  finishFinalReplyTraceStage as finishInteractionTraceStage,
  startFinalReplyTraceStage as startInteractionTraceStage,
  type FinalReplyTraceContext as InteractionTraceContext,
} from "@server/providers/final-reply-trace";
import {
  buildRewriteFailureDebugEntry,
  repairTargetNameSubstitution,
  summarizeRewriteRejection,
  validateRewriteCandidate,
} from "@server/providers/final-reply-validation";
import {
  buildOpenAiFallbackReplyConfig,
  resolveAdapterConfigForNpc,
  type ResolvedAdapterConfig,
} from "@server/providers/mlx-reply-config";
import {
  buildPrompt,
  resolveInteractionContract,
  type FinalReplyRewriteSeed,
} from "@server/providers/mlx-reply-prompts";
import {
  looksEnglishOnly,
  normalizeReplyText,
} from "@server/providers/mlx-reply-text-utils";

type FinalReplyGenerationResult = {
  text: string | null;
  adapterPath: string | null;
  sourceRef: string;
  rejectedReason?: string | null;
  debugFailures?: InteractionFailureDebugEntry[] | null;
  trace?: InteractionTraceEntry[] | null;
};
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
    generated = await generateFinalReplyCandidate({
      input,
      candidatePrompt: prompt,
      config: adapterConfig,
      mode,
    });
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
      generated.diagnostics ?? null,
    );
  } catch (error) {
    const openAiFallback = resolveOpenAiRequestFallback(adapterConfig, error);
    const requestDiagnostics = withFinalReplyProviderDecision(
      extractFinalReplyProviderDiagnostics(error),
      openAiFallback ? "fallback_to_openai" : "fallback_to_base_reply",
    );
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
      requestDiagnostics,
    );
    if (openAiFallback) {
      debugFailures.push(
        buildRewriteFailureDebugEntry({
          summary: rejectionReason,
          sourceRef: adapterConfig.backend,
          diagnostics: requestDiagnostics,
          kind: "request_error",
        }),
      );
      const openAiFallbackTrace = startInteractionTraceStage(
        traceContext,
        "reply_rewrite_retry_request",
        openAiFallback.traceLabel,
        null,
        "openai",
      );
      try {
        const fallbackGenerated = await generateFinalReplyCandidate({
          input,
          candidatePrompt: prompt,
          config: openAiFallback.config,
          mode,
        });
        if (!fallbackGenerated) {
          throw new Error("OpenAI fallback did not return a rewrite candidate.");
        }
        generated = {
          ...fallbackGenerated,
          sourceRef: `${fallbackGenerated.sourceRef}:${openAiFallback.sourceMarker}`,
        };
        finishInteractionTraceStage(
          traceContext,
          openAiFallbackTrace,
          "ok",
          openAiFallback.successDetail,
          generated.sourceRef,
          generated.diagnostics ?? null,
        );
      } catch (fallbackError) {
        const fallbackDiagnostics = withFinalReplyProviderDecision(
          extractFinalReplyProviderDiagnostics(fallbackError),
          "fallback_to_base_reply",
        );
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
          fallbackDiagnostics,
        );
        debugFailures.push(
          buildRewriteFailureDebugEntry({
            summary: fallbackRejectionReason,
            sourceRef: "openai",
            diagnostics: fallbackDiagnostics,
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
          diagnostics: requestDiagnostics,
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

function resolveOpenAiRequestFallback(
  adapterConfig: ResolvedAdapterConfig,
  error: unknown,
) {
  const config = buildOpenAiFallbackReplyConfig();
  if (!config) {
    return null;
  }

  if (adapterConfig.backend === "runpod") {
    return {
      config,
      sourceMarker: OPENAI_FALLBACK_FROM_RUNPOD_ERROR_MARKER,
      traceLabel: "RunPod 응답에러 -> OpenAI API fallback",
      successDetail: "RunPod 응답에러로 OpenAI API fallback(gpt-5-nano)을 사용했습니다.",
    } as const;
  }

  if (adapterConfig.backend === "baseten" && isBaseten400RequestError(error)) {
    return {
      config,
      sourceMarker: OPENAI_FALLBACK_FROM_BASETEN_400_MARKER,
      traceLabel: "Baseten 400 -> OpenAI fallback",
      successDetail: "Baseten 400으로 OpenAI fallback을 사용했습니다.",
    } as const;
  }

  return null;
}
