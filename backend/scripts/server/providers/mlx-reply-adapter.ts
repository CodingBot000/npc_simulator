import type { GenerateInteractionInput } from "@backend-provider";
import type {
  InteractionFailureDebugEntry,
  InteractionTraceEntry,
} from "@backend-contracts/api";
import { appConfig } from "@server/config";
import {
  generateFinalReplyCandidate,
  isBaseten400RequestError,
  OPENAI_FALLBACK_FROM_BASETEN_400_MARKER,
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
        const fallbackGenerated = await generateFinalReplyCandidate({
          input,
          candidatePrompt: prompt,
          config: openAiFallbackConfig,
          mode,
        });
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
