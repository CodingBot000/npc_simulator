import type { ReactNode } from "react";
import type {
  ReviewTrainingRunView,
  ReviewTrainingStatusView,
} from "@/lib/review-types";
import {
  formatDuration,
  formatTimestamp,
} from "./review-formatters";

function basenameFromPath(path: string | null) {
  if (!path) {
    return "-";
  }

  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function describeTrainingRunOrigin(run: ReviewTrainingRunView) {
  if (run.trainingBackend === "together_serverless_lora") {
    return "Together serverless LoRA run";
  }

  if (run.trainingBackend === "smoke") {
    return "smoke run";
  }

  if (
    run.runId.startsWith("real-eval-import-") ||
    run.message?.toLowerCase().includes("imported")
  ) {
    return "검증용 import run";
  }

  if (run.kind === "dpo") {
    return "후속 DPO run";
  }

  return "실학습 run";
}

function describeTrainingRunStage(run: ReviewTrainingRunView) {
  if (run.promotion.isPromoted) {
    return "Model Promotion 완료";
  }

  if (run.decision.state === "accepted") {
    return "채택 완료";
  }

  if (run.decision.state === "rejected") {
    return "반려 완료";
  }

  if (run.evaluation.state === "succeeded") {
    return "Golden-set Evaluation 완료";
  }

  if (run.evaluation.state === "running") {
    return "Golden-set Evaluation 실행 중";
  }

  if (run.state === "running") {
    return "학습 실행 중";
  }

  if (run.state === "failed") {
    return "실패";
  }

  if (run.state === "succeeded") {
    return "학습 완료";
  }

  return "상태 미확인";
}

export function dpoExecutionModeLabel(mode: ReviewTrainingStatusView["dpo"]["executionMode"]) {
  switch (mode) {
    case "needs_new_sft":
      return "새 SFT Base 필요";
    case "reuse_existing_sft":
      return "기존 성공 SFT Base 재사용";
    case "unsupported":
      return "현재 미지원";
    case "together_serverless_lora":
      return "Together serverless LoRA";
    case "local_peft":
      return "로컬 PEFT";
    case "smoke":
      return "smoke";
    default:
      return "판단 불가";
  }
}

export function dpoFingerprintRelationLabel(
  relation: ReviewTrainingStatusView["dpo"]["sftFingerprintRelation"],
) {
  switch (relation) {
    case "match":
      return "finalized SFT fingerprint 일치";
    case "mismatch":
      return "finalized SFT fingerprint 불일치";
    default:
      return "finalized SFT fingerprint 확인 불가";
  }
}

export function TrainingRunDetailCard({
  eyebrow,
  run,
  emptyMessage,
  messageOverride,
  note,
  action,
}: {
  eyebrow: string;
  run: ReviewTrainingRunView | null;
  emptyMessage: ReactNode;
  messageOverride?: string | null;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-foreground/80">{eyebrow}</p>
          {run ? (
            <>
              <p className="text-lg font-semibold text-foreground">
                {run.kind.toUpperCase()} · {describeTrainingRunOrigin(run)} ·{" "}
                {describeTrainingRunStage(run)}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                dataset {run.sourceDatasetVersion ?? "-"} · canonical{" "}
                {run.remoteModelName
                  ? run.remoteModelName
                  : basenameFromPath(run.adapterPath)}{" "}
                · runtime{" "}
                {run.remoteModelName
                  ? run.remoteModelName
                  : basenameFromPath(run.runtimeArtifactPath)}
              </p>
              <p className="mt-2 break-all font-mono text-[11px] text-[var(--ink-muted)]">
                runId {run.runId}
              </p>
            </>
          ) : (
            <div className="text-sm leading-7 text-[var(--ink-muted)]">{emptyMessage}</div>
          )}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {note ? (
        <div className="mt-4 rounded-2xl border border-[rgba(209,111,76,0.24)] bg-[rgba(209,111,76,0.1)] px-4 py-3 text-sm leading-7 text-[var(--accent)]">
          {note}
        </div>
      ) : null}

      {run ? (
        <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
          <p>runId: {run.runId}</p>
          <p>kind: {run.kind}</p>
          <p>training backend: {run.trainingBackend ?? "-"}</p>
          <p>state: {run.state}</p>
          <p>step: {run.currentStep ?? "-"}</p>
          <p>message: {messageOverride ?? run.message ?? "-"}</p>
          <p>dataset dir: {run.datasetDir ?? "-"}</p>
          <p>adapter: {run.adapterPath ?? "-"}</p>
          <p>log: {run.logPath ?? "-"}</p>
          <p>startedAt: {formatTimestamp(run.startedAt ?? null)}</p>
          <p>finishedAt: {formatTimestamp(run.finishedAt ?? null)}</p>
          <p>updatedAt: {formatTimestamp(run.updatedAt ?? null)}</p>
          <p>source dataset version: {run.sourceDatasetVersion ?? "-"}</p>
          <p>base model: {run.baseModelId ?? "-"}</p>
          <p>fingerprint: {run.fingerprint ?? "-"}</p>
          <p>source fingerprint: {run.sourceFingerprint ?? "-"}</p>
          <p>parent run: {run.parentRunId ?? "-"}</p>
          <p>runtime artifact: {run.runtimeArtifactPath ?? "-"}</p>
          <p>runtime kind: {run.runtimeArtifactKind ?? "-"}</p>
          <p>remote provider: {run.remoteProvider ?? "-"}</p>
          <p>remote job: {run.remoteJobId ?? "-"}</p>
          <p>remote training file: {run.remoteTrainingFileId ?? "-"}</p>
          <p>remote validation file: {run.remoteValidationFileId ?? "-"}</p>
          <p>remote model: {run.remoteModelName ?? "-"}</p>
          <p>
            소요: build {formatDuration(run.durations.buildMs ?? null)} / train{" "}
            {formatDuration(run.durations.trainMs ?? null)} / 전체{" "}
            {formatDuration(run.durations.totalMs ?? null)}
          </p>
          <p>
            eval: {run.evaluation.state ?? "idle"} / slot {run.evaluation.bindingKey ?? "-"}
          </p>
          <p>eval benchmark: {run.evaluation.benchmarkId ?? "-"}</p>
          <p>eval baseline: {run.evaluation.baselineLabel ?? "-"}</p>
          <p>
            eval message: {run.evaluation.message ?? run.evaluation.recommendation ?? "-"}
          </p>
          <p>eval summary: {run.evaluation.summaryPath ?? "-"}</p>
          <p>
            eval startedAt: {formatTimestamp(run.evaluation.startedAt ?? null)} / finishedAt{" "}
            {formatTimestamp(run.evaluation.finishedAt ?? null)}
          </p>
          <p>
            winner: baseline {run.evaluation.winnerCounts?.baseline ?? "-"} / candidate{" "}
            {run.evaluation.winnerCounts?.candidate ?? "-"} / tie{" "}
            {run.evaluation.winnerCounts?.tie ?? "-"}
          </p>
          <p>
            score: N {run.evaluation.baselineNaturalness ?? "-"} →{" "}
            {run.evaluation.candidateNaturalness ?? "-"} / P{" "}
            {run.evaluation.baselinePersonaFit ?? "-"} →{" "}
            {run.evaluation.candidatePersonaFit ?? "-"} / A{" "}
            {run.evaluation.baselineAntiMeta ?? "-"} →{" "}
            {run.evaluation.candidateAntiMeta ?? "-"}
          </p>
          <p>eval confidence: {run.evaluation.confidence ?? "-"}</p>
          <p>
            decision: {run.decision.state ?? "pending"} / reviewer {run.decision.reviewer ?? "-"}
          </p>
          <p>decision notes: {run.decision.notes ?? "-"}</p>
          <p>decidedAt: {formatTimestamp(run.decision.decidedAt ?? null)}</p>
          <p>
            model promotion:{" "}
            {run.promotion.isPromoted
              ? `${run.promotion.bindingKey ?? "-"} @ ${formatTimestamp(
                  run.promotion.promotedAt ?? null,
                )}`
              : "미적용"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
