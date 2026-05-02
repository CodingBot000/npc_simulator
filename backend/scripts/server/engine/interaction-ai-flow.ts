import type {
  InteractionFailureDebugEntry,
  InteractionJudgeResult,
  InteractionTraceEntry,
  LlmInteractionResult,
} from "@backend-contracts/api";
import type {
  GenerateInteractionInput,
  LlmProvider,
} from "@backend-provider";
import { normalizeLlmInteractionResult } from "@server/engine/action-selection";
import { buildFallbackInteractionResult } from "@server/engine/fallback-interaction";
import type { InteractionContract } from "@server/engine/interaction-contract";
import {
  validateReplyAgainstContract,
  validateStructuredResultAgainstContract,
} from "@server/engine/interaction-contract";
import { sanitizeReplyText } from "@server/engine/interaction-reply-sanitizer";
import {
  finishInteractionTraceStage,
  recordInteractionTraceStage,
  startInteractionTraceStage,
} from "@server/engine/interaction-trace";
import { maybeJudgeInteractionReply } from "@server/judge/interaction-judge";
import { maybeGenerateFinalReply } from "@server/providers/mlx-reply-adapter";
import type { maybeGenerateShadowComparison } from "@server/providers/shadow-compare";

type ShadowComparisonResult = Awaited<ReturnType<typeof maybeGenerateShadowComparison>>;

export async function generateValidatedInteraction(params: {
  provider: LlmProvider;
  generationInput: GenerateInteractionInput;
  interactionContract: InteractionContract;
  npcName: string;
  turnStartedAtMs: number;
  interactionTraceEntries: InteractionTraceEntry[];
}): Promise<{
  llmResult: LlmInteractionResult;
  fallbackUsed: boolean;
  failureDebugEntries: InteractionFailureDebugEntry[];
}> {
  let fallbackUsed = false;
  const failureDebugEntries: InteractionFailureDebugEntry[] = [];
  let llmResult: LlmInteractionResult;

  const providerTrace = startInteractionTraceStage(
    params.turnStartedAtMs,
    "interaction_provider",
    "기본 interaction 생성",
    null,
    params.provider.mode,
  );
  try {
    llmResult = normalizeLlmInteractionResult(
      await params.provider.generateInteraction(params.generationInput),
    );
    finishInteractionTraceStage(
      params.interactionTraceEntries,
      params.turnStartedAtMs,
      providerTrace,
      "ok",
      `mode=${params.provider.mode}`,
      params.provider.mode,
    );
  } catch (error) {
    fallbackUsed = true;
    const providerErrorMessage =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "기본 interaction 생성 요청이 실패했습니다.";
    finishInteractionTraceStage(
      params.interactionTraceEntries,
      params.turnStartedAtMs,
      providerTrace,
      "failed",
      providerErrorMessage,
      params.provider.mode,
    );
    console.warn(
      "[llm-provider] falling back to deterministic interaction:",
      error instanceof Error ? error.message : String(error),
    );
    failureDebugEntries.push({
      stage: "interaction_provider",
      kind: "provider_error",
      summary: providerErrorMessage,
      sourceRef: params.provider.mode,
    });
    const fallbackTrace = startInteractionTraceStage(
      params.turnStartedAtMs,
      "interaction_fallback",
      "deterministic fallback",
      null,
      "deterministic",
    );
    llmResult = normalizeLlmInteractionResult(
      buildFallbackInteractionResult(params.generationInput),
    );
    finishInteractionTraceStage(
      params.interactionTraceEntries,
      params.turnStartedAtMs,
      fallbackTrace,
      "fallback",
      "provider 오류로 deterministic fallback을 사용했습니다.",
      "deterministic",
    );
  }

  if (!fallbackUsed) {
    const validationTrace = startInteractionTraceStage(
      params.turnStartedAtMs,
      "interaction_validation",
      "기본 interaction 검증",
      null,
      params.provider.mode,
    );
    const structuredValidation = validateStructuredResultAgainstContract({
      result: llmResult,
      contract: params.interactionContract,
    });
    const replyValidation = validateReplyAgainstContract({
      replyText: sanitizeReplyText(llmResult.reply.text),
      contract: params.interactionContract,
      npcName: params.npcName,
    });

    if (!structuredValidation.ok || !replyValidation.ok) {
      fallbackUsed = true;
      const validationIssues = [
        ...structuredValidation.issues,
        ...replyValidation.issues,
      ];
      finishInteractionTraceStage(
        params.interactionTraceEntries,
        params.turnStartedAtMs,
        validationTrace,
        "failed",
        validationIssues.map((issue) => issue.code).join(", "),
        params.provider.mode,
      );
      console.warn(
        "[llm-provider] contract validation failed, using deterministic fallback:",
        validationIssues
          .map((issue) => issue.code)
          .join(", "),
      );
      failureDebugEntries.push({
        stage: "interaction_validation",
        kind: "contract_validation",
        summary: "기본 interaction 결과가 계약 검증을 통과하지 못했습니다.",
        sourceRef: params.provider.mode,
        issues: validationIssues.map((issue) => `${issue.code}: ${issue.message}`),
        candidateReplyText: sanitizeReplyText(llmResult.reply.text),
        candidateSelectedActionType: llmResult.selectedAction.type,
        candidateSelectedActionReason: llmResult.selectedAction.reason,
        candidateTargetNpcId: llmResult.structuredImpact.targetNpcId,
        candidateImpactTags: llmResult.structuredImpact.impactTags,
      });
      const fallbackTrace = startInteractionTraceStage(
        params.turnStartedAtMs,
        "interaction_fallback",
        "deterministic fallback",
        null,
        "deterministic",
      );
      llmResult = normalizeLlmInteractionResult(
        buildFallbackInteractionResult(params.generationInput),
      );
      finishInteractionTraceStage(
        params.interactionTraceEntries,
        params.turnStartedAtMs,
        fallbackTrace,
        "fallback",
        "계약 검증 실패로 deterministic fallback을 사용했습니다.",
        "deterministic",
      );
    } else {
      finishInteractionTraceStage(
        params.interactionTraceEntries,
        params.turnStartedAtMs,
        validationTrace,
        "ok",
        `selectedAction=${llmResult.selectedAction.type}`,
        params.provider.mode,
      );
    }
  } else {
    recordInteractionTraceStage(
      params.interactionTraceEntries,
      params.turnStartedAtMs,
      "interaction_validation",
      "기본 interaction 검증",
      "skipped",
      "fallback interaction이라 별도 검증을 건너뛰었습니다.",
      params.provider.mode,
    );
  }

  return {
    llmResult,
    fallbackUsed,
    failureDebugEntries,
  };
}

export async function rewriteFinalReplyWithTrace(params: {
  generationInput: GenerateInteractionInput;
  llmResult: LlmInteractionResult;
  turnStartedAtMs: number;
  interactionTraceEntries: InteractionTraceEntry[];
  failureDebugEntries: InteractionFailureDebugEntry[];
}): Promise<{
  llmResult: LlmInteractionResult;
  replyRewriteSource: string | null;
  replyRewriteReason: string | null;
}> {
  let llmResult = params.llmResult;
  let replyRewriteSource: string | null = null;
  let replyRewriteReason: string | null = null;

  try {
    const rewrittenReply = await maybeGenerateFinalReply(params.generationInput, {
      draftReplyText: llmResult.reply.text,
      selectedActionType: llmResult.selectedAction.type,
      selectedActionReason: llmResult.selectedAction.reason,
    }, {
      traceOriginMs: params.turnStartedAtMs,
    });
    if (rewrittenReply?.trace?.length) {
      params.interactionTraceEntries.push(...rewrittenReply.trace);
    } else {
      recordInteractionTraceStage(
        params.interactionTraceEntries,
        params.turnStartedAtMs,
        "reply_rewrite_request",
        "final reply rewrite 요청",
        "skipped",
        "rewrite를 실행하지 않았습니다.",
        "final_reply",
      );
    }
    if (rewrittenReply?.debugFailures?.length) {
      params.failureDebugEntries.push(...rewrittenReply.debugFailures);
    }
    if (rewrittenReply?.text) {
      replyRewriteSource = rewrittenReply.sourceRef ?? rewrittenReply.adapterPath ?? null;
      replyRewriteReason = null;
      llmResult = {
        ...llmResult,
        reply: {
          text: rewrittenReply.text,
          rewriteSource: replyRewriteSource,
          rewriteReason: null,
        },
      };
    } else if (rewrittenReply?.sourceRef) {
      replyRewriteSource = rewrittenReply.sourceRef;
      replyRewriteReason = rewrittenReply.rejectedReason ?? "최종 reply 검증을 통과하지 못했습니다.";
    }
  } catch (error) {
    console.warn(
      "[mlx-reply-adapter] failed to rewrite reply:",
      error instanceof Error ? error.message : String(error),
    );
    params.failureDebugEntries.push({
      stage: "reply_rewrite",
      kind: "request_error",
      summary:
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "최종 reply rewrite 요청이 실패했습니다.",
      sourceRef: replyRewriteSource ?? "final_reply",
    });
    recordInteractionTraceStage(
      params.interactionTraceEntries,
      params.turnStartedAtMs,
      "reply_rewrite_request",
      "final reply rewrite 요청",
      "failed",
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "최종 reply rewrite 요청이 실패했습니다.",
      replyRewriteSource ?? "final_reply",
    );
  }

  return {
    llmResult: {
      ...llmResult,
      reply: {
        text: sanitizeReplyText(llmResult.reply.text),
        rewriteSource: replyRewriteSource,
        rewriteReason: replyRewriteReason,
      },
    },
    replyRewriteSource,
    replyRewriteReason,
  };
}

export async function judgeInteractionReplyWithTrace(params: {
  interactionContract: InteractionContract;
  replyText: string;
  turnStartedAtMs: number;
  interactionTraceEntries: InteractionTraceEntry[];
}): Promise<InteractionJudgeResult> {
  const judgeTrace = startInteractionTraceStage(
    params.turnStartedAtMs,
    "reply_judge_request",
    "semantic Judge 판정",
    null,
    "openai:judge",
  );
  const replyJudge = await maybeJudgeInteractionReply({
    contract: params.interactionContract,
    replyText: params.replyText,
  });
  finishInteractionTraceStage(
    params.interactionTraceEntries,
    params.turnStartedAtMs,
    judgeTrace,
    replyJudge.status === "failed"
      ? "failed"
      : replyJudge.status === "skipped"
        ? "skipped"
        : "ok",
    [
      `status=${replyJudge.status}`,
      replyJudge.confidence !== null ? `confidence=${replyJudge.confidence}` : null,
      replyJudge.reason,
      replyJudge.error,
    ].filter(Boolean).join(" | "),
    replyJudge.sourceRef ?? "openai:judge",
  );
  recordInteractionTraceStage(
    params.interactionTraceEntries,
    params.turnStartedAtMs,
    "reply_judge_result",
    "semantic Judge 결과",
    replyJudge.status === "failed"
      ? "failed"
      : replyJudge.status === "skipped"
        ? "skipped"
        : "ok",
    [
      `aligned=${replyJudge.aligned}`,
      `targetMaintained=${replyJudge.targetMaintained}`,
      `fatalMismatch=${replyJudge.fatalMismatch}`,
      replyJudge.durationMs !== null ? `duration=${replyJudge.durationMs}ms` : null,
    ].filter(Boolean).join(" | "),
    replyJudge.sourceRef ?? "openai:judge",
  );

  return replyJudge;
}

export async function resolveShadowComparisonWithTrace(params: {
  shadowComparisonPromise: Promise<ShadowComparisonResult>;
  turnStartedAtMs: number;
  interactionTraceEntries: InteractionTraceEntry[];
}): Promise<ShadowComparisonResult> {
  const shadowWaitTrace = startInteractionTraceStage(
    params.turnStartedAtMs,
    "shadow_compare_wait",
    "shadow compare 대기",
  );
  const shadowComparison = await params.shadowComparisonPromise;
  const sanitizedShadowComparison =
    shadowComparison?.result
      ? {
          ...shadowComparison,
          result: {
            ...shadowComparison.result,
            reply: {
              text: sanitizeReplyText(shadowComparison.result.reply.text),
            },
          },
        }
      : shadowComparison;
  finishInteractionTraceStage(
    params.interactionTraceEntries,
    params.turnStartedAtMs,
    shadowWaitTrace,
    shadowComparison ? "ok" : "skipped",
    shadowComparison
      ? `status=${shadowComparison.status}, duration=${shadowComparison.durationMs ?? 0}ms`
      : "shadow compare가 비활성화되어 있습니다.",
    shadowComparison?.sourceRef ?? null,
  );

  return sanitizedShadowComparison;
}
