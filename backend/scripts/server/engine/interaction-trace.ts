import type {
  InteractionTraceEntry,
  InteractionTraceStage,
  InteractionTraceStatus,
} from "@backend-contracts/api";

export type PendingInteractionTrace = {
  stage: InteractionTraceStage;
  label: string;
  detail?: string | null;
  sourceRef?: string | null;
  startedAtMs: number;
  startedAtAbsoluteMs: number;
};

export function startInteractionTraceStage(
  originMs: number,
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
    startedAtMs: Math.max(0, startedAtAbsoluteMs - originMs),
    startedAtAbsoluteMs,
  };
}

export function finishInteractionTraceStage(
  entries: InteractionTraceEntry[],
  originMs: number,
  pending: PendingInteractionTrace,
  status: InteractionTraceStatus,
  detail?: string | null,
  sourceRef?: string | null,
) {
  const finishedAtAbsoluteMs = Date.now();
  const finishedAtMs = Math.max(0, finishedAtAbsoluteMs - originMs);
  entries.push({
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

export function recordInteractionTraceStage(
  entries: InteractionTraceEntry[],
  originMs: number,
  stage: InteractionTraceStage,
  label: string,
  status: InteractionTraceStatus,
  detail?: string | null,
  sourceRef?: string | null,
) {
  const atAbsoluteMs = Date.now();
  const atMs = Math.max(0, atAbsoluteMs - originMs);
  entries.push({
    stage,
    label,
    status,
    startedAtMs: atMs,
    finishedAtMs: atMs,
    durationMs: 0,
    detail: detail ?? null,
    sourceRef: sourceRef ?? null,
  });
}
