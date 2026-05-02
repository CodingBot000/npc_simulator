import type {
  ReviewTrainingBackend,
  ReviewTrainingBindingKey,
  ReviewTrainingDurationsView,
  ReviewTrainingKind,
  ReviewTrainingRuntimeArtifactKind,
  ReviewTrainingRunView,
} from "@backend-contracts/review";
import {
  type TrainingRunRow,
  asNumber,
  asObject,
  asString,
  isoString,
} from "@server/db/review-db-core";

export interface TrainingRunSpecRecord {
  runId: string;
  kind: ReviewTrainingKind;
  trainingBackend: ReviewTrainingBackend;
  canonicalModelFamily: string | null;
  fingerprint: string;
  sourceFingerprint: string;
  sourceDatasetVersion: string | null;
  parentRunUid: string | null;
  sourceSnapshotId: number | null;
  baseModel: string;
  datasetDir: string;
  adapterPath: string | null;
  runtimeArtifactPath: string | null;
  runtimeArtifactKind: ReviewTrainingRuntimeArtifactKind | null;
  remoteProvider: string | null;
  remoteJobId: string | null;
  remoteTrainingFileId: string | null;
  remoteValidationFileId: string | null;
  remoteModelName: string | null;
  logPath: string;
  trainingResultPath: string | null;
  commands: {
    build: {
      command: string;
      args: string[];
    };
    train: {
      command: string;
      args: string[];
    };
    derive: {
      command: string;
      args: string[];
    } | null;
  };
}

export function buildRunDurations(metricsJson: unknown): ReviewTrainingDurationsView {
  const metrics = asObject(metricsJson);
  const durations = asObject(metrics.durations);

  return {
    buildMs: asNumber(durations.buildMs),
    trainMs: asNumber(durations.trainMs),
    totalMs: asNumber(durations.totalMs),
  };
}

export function mapTrainingRunToView(row: TrainingRunRow): ReviewTrainingRunView {
  const params = asObject(row.params_json);
  const evaluation = asObject(row.eval_summary_json);
  const winnerCounts = asObject(evaluation.winnerCounts);
  const averages = asObject(evaluation.averages);

  return {
    runId: row.run_uid ?? "",
    kind: (row.run_kind as ReviewTrainingKind) ?? "sft",
    trainingBackend:
      (row.training_backend as ReviewTrainingBackend | null) ?? null,
    state: (row.state as ReviewTrainingRunView["state"]) ?? "failed",
    currentStep: (row.current_step as ReviewTrainingRunView["currentStep"]) ?? null,
    message: row.message,
    startedAt: isoString(row.started_at),
    finishedAt: isoString(row.finished_at),
    updatedAt: isoString(row.updated_at),
    fingerprint: row.run_fingerprint,
    sourceFingerprint: row.source_fingerprint,
    sourceDatasetVersion: asString(params.sourceDatasetVersion),
    parentRunId: asString(params.parentRunUid),
    baseModelId: row.base_model,
    datasetDir: row.dataset_work_dir,
    adapterPath: row.output_adapter_path,
    runtimeArtifactPath: row.runtime_artifact_path,
    runtimeArtifactKind:
      (row.runtime_artifact_kind as ReviewTrainingRuntimeArtifactKind | null) ?? null,
    remoteProvider: row.remote_provider,
    remoteJobId: row.remote_job_id,
    remoteTrainingFileId: row.remote_training_file_id,
    remoteValidationFileId: row.remote_validation_file_id,
    remoteModelName: row.remote_model_name,
    logPath: asString(params.logPath),
    durations: buildRunDurations(row.metrics_json),
    evaluation: {
      state:
        (row.eval_state as ReviewTrainingRunView["evaluation"]["state"]) ?? "idle",
      bindingKey:
        (row.eval_binding_key as ReviewTrainingBindingKey | null) ?? null,
      benchmarkId: asString(evaluation.benchmarkId),
      baselineLabel:
        row.eval_baseline_label ?? asString(evaluation.baselineLabel),
      summaryPath: row.eval_summary_path ?? asString(evaluation.summaryPath),
      message: row.eval_message,
      startedAt: isoString(row.eval_started_at),
      finishedAt: isoString(row.eval_finished_at),
      recommendation:
        (asString(evaluation.recommendation) as
          | ReviewTrainingRunView["evaluation"]["recommendation"]
          | null) ?? null,
      winnerCounts:
        Object.keys(winnerCounts).length > 0
          ? {
              baseline: asNumber(winnerCounts.baseline) ?? 0,
              candidate: asNumber(winnerCounts.candidate) ?? 0,
              tie: asNumber(winnerCounts.tie) ?? 0,
            }
          : null,
      baselineNaturalness: asNumber(averages.baselineNaturalness),
      candidateNaturalness: asNumber(averages.candidateNaturalness),
      baselinePersonaFit: asNumber(averages.baselinePersonaFit),
      candidatePersonaFit: asNumber(averages.candidatePersonaFit),
      baselineAntiMeta: asNumber(averages.baselineAntiMeta),
      candidateAntiMeta: asNumber(averages.candidateAntiMeta),
      confidence: asNumber(averages.confidence),
    },
    decision: {
      state:
        (row.review_decision as ReviewTrainingRunView["decision"]["state"]) ??
        "pending",
      reviewer: row.reviewed_by,
      notes: row.review_notes,
      decidedAt: isoString(row.reviewed_at),
    },
    promotion: {
      isPromoted: Boolean(row.promoted_at),
      bindingKey:
        (row.promoted_binding_key as ReviewTrainingBindingKey | null) ?? null,
      promotedAt: isoString(row.promoted_at),
    },
  };
}

export function mapTrainingRunSpecRecord(
  row: TrainingRunRow,
  runUid: string,
): TrainingRunSpecRecord {
  const params = asObject(row.params_json);
  const commands = asObject(params.commands);

  return {
    runId: row.run_uid ?? runUid,
    kind: (row.run_kind as ReviewTrainingKind) ?? "sft",
    trainingBackend:
      (row.training_backend as ReviewTrainingBackend | null) ?? "local_peft",
    canonicalModelFamily: asString(params.canonicalModelFamily),
    fingerprint: row.run_fingerprint ?? "",
    sourceFingerprint: row.source_fingerprint ?? "",
    sourceDatasetVersion: asString(params.sourceDatasetVersion),
    parentRunUid: asString(params.parentRunUid),
    sourceSnapshotId: row.source_snapshot_id,
    baseModel: row.base_model ?? "",
    datasetDir: row.dataset_work_dir ?? "",
    adapterPath: row.output_adapter_path ?? null,
    runtimeArtifactPath: row.runtime_artifact_path ?? null,
    runtimeArtifactKind:
      (row.runtime_artifact_kind as ReviewTrainingRuntimeArtifactKind | null) ?? null,
    remoteProvider: row.remote_provider,
    remoteJobId: row.remote_job_id,
    remoteTrainingFileId: row.remote_training_file_id,
    remoteValidationFileId: row.remote_validation_file_id,
    remoteModelName: row.remote_model_name,
    logPath: asString(params.logPath) ?? "",
    trainingResultPath: asString(params.trainingResultPath),
    commands: {
      build: {
        command: asString(asObject(commands.build).command) ?? "",
        args: Array.isArray(asObject(commands.build).args)
          ? (asObject(commands.build).args as string[])
          : [],
      },
      train: {
        command: asString(asObject(commands.train).command) ?? "",
        args: Array.isArray(asObject(commands.train).args)
          ? (asObject(commands.train).args as string[])
          : [],
      },
      derive:
        Object.keys(asObject(commands.derive)).length > 0
          ? {
              command: asString(asObject(commands.derive).command) ?? "",
              args: Array.isArray(asObject(commands.derive).args)
                ? (asObject(commands.derive).args as string[])
                : [],
            }
          : null,
    },
  };
}
