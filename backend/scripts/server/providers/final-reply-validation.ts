import type { InteractionFailureDebugEntry } from "@backend-contracts/api";
import { validateReplyAgainstContract } from "@server/engine/interaction-contract";
import {
  resolveInteractionContract,
  type FinalReplyRewriteSeed,
} from "@server/providers/mlx-reply-prompts";
import {
  containsAnyPattern,
} from "@server/providers/mlx-reply-text-utils";

const TARGET_SUBSTITUTION_PATTERNS = [/그 사람/u, /그녀/u, /저 사람/u] as const;
const TARGET_SUBSTITUTION_REPLACEMENTS = [/그 사람/gu, /그녀/gu, /저 사람/gu] as const;

export function summarizeRewriteRejection(params: {
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

export function buildRewriteFailureDebugEntry(params: {
  summary: string;
  sourceRef: string | null;
  diagnostics?: Record<string, unknown> | null;
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
    diagnostics: params.diagnostics ?? null,
    issues,
    candidateReplyText: params.candidateReplyText ?? null,
  } satisfies InteractionFailureDebugEntry;
}

export function validateRewriteCandidate(params: {
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

export function repairTargetNameSubstitution(params: {
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
