import type {
  InteractionTraceEntry,
  InteractionTraceStage,
  InteractionTraceStatus,
} from "@backend-contracts/api";

export type FinalReplyTraceContext = {
  originMs: number;
  entries: InteractionTraceEntry[];
};

export type PendingFinalReplyTrace = {
  stage: InteractionTraceStage;
  label: string;
  detail?: string | null;
  sourceRef?: string | null;
  diagnostics?: Record<string, unknown> | null;
  startedAtMs: number;
  startedAtAbsoluteMs: number;
};

export function startFinalReplyTraceStage(
  context: FinalReplyTraceContext,
  stage: InteractionTraceStage,
  label: string,
  detail?: string | null,
  sourceRef?: string | null,
  diagnostics?: Record<string, unknown> | null,
): PendingFinalReplyTrace {
  const startedAtAbsoluteMs = Date.now();
  return {
    stage,
    label,
    detail,
    sourceRef,
    diagnostics,
    startedAtMs: Math.max(0, startedAtAbsoluteMs - context.originMs),
    startedAtAbsoluteMs,
  };
}

export function finishFinalReplyTraceStage(
  context: FinalReplyTraceContext,
  pending: PendingFinalReplyTrace,
  status: InteractionTraceStatus,
  detail?: string | null,
  sourceRef?: string | null,
  diagnostics?: Record<string, unknown> | null,
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
    diagnostics: diagnostics ?? pending.diagnostics ?? null,
  });
}
