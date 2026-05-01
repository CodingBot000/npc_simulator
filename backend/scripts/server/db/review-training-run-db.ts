import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type {
  ReviewFinalizeStatusView,
  ReviewTrainingBackend,
  ReviewTrainingBindingKey,
  ReviewTrainingDurationsView,
  ReviewTrainingKind,
  ReviewTrainingPreflightView,
  ReviewTrainingRuntimeArtifactKind,
  ReviewTrainingRunView,
  ReviewTrainingStatusView,
} from "@backend-contracts/review";
import { dbQuery, withDbTransaction } from "@server/db/postgres";
import {
  LEGACY_TRAIN_RUNS_DIR,
  type RawRecord,
  type TrainingRunRow,
  asNumber,
  asObject,
  asString,
  isoString,
  jsonParam,
  pathExists,
  readJsonFile,
} from "@server/db/review-db-core";
import { ensureSnapshotsSeededFromFiles } from "@server/db/review-snapshot-db";

let trainingSeedPromise: Promise<void> | null = null;

async function insertTrainingRunRow(
  client: PoolClient,
  row: Partial<TrainingRunRow> & {
    run_uid: string;
    run_kind: string;
  },
) {
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO npc_training_run (
        run_uid,
        run_kind,
        state,
        current_step,
        message,
        source_snapshot_id,
        parent_run_id,
        base_model,
        training_backend,
        output_adapter_path,
        output_adapter_version,
        runtime_artifact_path,
        runtime_artifact_kind,
        remote_provider,
        remote_job_id,
        remote_training_file_id,
        remote_validation_file_id,
        remote_model_name,
        dataset_work_dir,
        params_json,
        metrics_json,
        run_fingerprint,
        source_fingerprint,
        requested_by,
        requested_from,
        started_at,
        finished_at,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,$27,
        COALESCE($28, CURRENT_TIMESTAMP),
        COALESCE($29, CURRENT_TIMESTAMP)
      )
      RETURNING id`,
    [
      row.run_uid,
      row.run_kind,
      row.state ?? null,
      row.current_step ?? null,
      row.message ?? null,
      row.source_snapshot_id ?? null,
      row.parent_run_id ?? null,
      row.base_model ?? null,
      row.training_backend ?? null,
      row.output_adapter_path ?? null,
      row.output_adapter_version ?? null,
      row.runtime_artifact_path ?? null,
      row.runtime_artifact_kind ?? null,
      row.remote_provider ?? null,
      row.remote_job_id ?? null,
      row.remote_training_file_id ?? null,
      row.remote_validation_file_id ?? null,
      row.remote_model_name ?? null,
      row.dataset_work_dir ?? null,
      jsonParam(row.params_json ?? null),
      jsonParam(row.metrics_json ?? null),
      row.run_fingerprint ?? null,
      row.source_fingerprint ?? null,
      row.requested_by ?? null,
      row.requested_from ?? null,
      row.started_at ?? null,
      row.finished_at ?? null,
      row.created_at ?? null,
      row.updated_at ?? null,
    ],
  );
  return inserted.rows[0].id;
}

async function findTrainingRunIdByUid(
  client: PoolClient,
  runUid: string,
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [runUid],
  );
  return result.rows[0]?.id ?? null;
}

async function seedLegacyTrainingRuns() {
  if (trainingSeedPromise) {
    return trainingSeedPromise;
  }

  trainingSeedPromise = (async () => {
    if (!(await pathExists(LEGACY_TRAIN_RUNS_DIR))) {
      return;
    }

    const entries = await fs.readdir(LEGACY_TRAIN_RUNS_DIR, { withFileTypes: true });
    const runDirs = entries.filter((entry) => entry.isDirectory());

    if (!runDirs.length) {
      return;
    }

    await ensureSnapshotsSeededFromFiles();

    await withDbTransaction(async (client) => {
      for (const entry of runDirs) {
        const runDir = path.join(LEGACY_TRAIN_RUNS_DIR, entry.name);
        const spec = await readJsonFile<RawRecord>(path.join(runDir, "spec.json"));
        const status = await readJsonFile<RawRecord>(path.join(runDir, "status.json"));

        if (!spec || !status) {
          continue;
        }

        const runUid = asString(spec.runId) ?? null;
        if (!runUid) {
          continue;
        }

        const existingId = await findTrainingRunIdByUid(client, runUid);
        if (existingId) {
          continue;
        }

        await insertTrainingRunRow(client, {
          run_uid: runUid,
          run_kind: asString(spec.kind) ?? "sft",
          state: asString(status.state) ?? "failed",
          current_step: asString(status.currentStep),
          message: asString(status.message),
          source_snapshot_id: null,
          parent_run_id: null,
          base_model: asString(spec.baseModel),
          training_backend: "local_peft",
          output_adapter_path: asString(status.adapterPath) ?? asString(spec.adapterPath),
          runtime_artifact_path:
            asString(status.runtimeArtifactPath) ??
            asString(status.adapterPath) ??
            asString(spec.adapterPath),
          runtime_artifact_kind:
            asString(status.runtimeArtifactKind) ?? "legacy_mlx_adapter",
          remote_provider: null,
          remote_job_id: null,
          remote_training_file_id: null,
          remote_validation_file_id: null,
          remote_model_name: null,
          dataset_work_dir: asString(status.datasetDir) ?? asString(spec.datasetDir),
          params_json: {
            sourceDatasetVersion: asString(spec.sourceDatasetVersion),
            parentRunUid: asString(spec.parentRunId),
            fingerprint: asString(spec.fingerprint),
            sourceFingerprint: asString(spec.sourceFingerprint),
            logPath: asString(status.logPath) ?? asString(spec.logPath),
            commands: asObject(spec.commands),
          },
          metrics_json: {
            durations: asObject(status.durations),
          },
          run_fingerprint: asString(spec.fingerprint),
          source_fingerprint: asString(spec.sourceFingerprint),
          requested_from: "legacy_file_seed",
          started_at: asString(status.startedAt),
          finished_at: asString(status.finishedAt),
          created_at: asString(spec.createdAt),
          updated_at: asString(status.updatedAt) ?? asString(spec.createdAt),
        });
      }
    });
  })();

  try {
    await trainingSeedPromise;
  } finally {
    trainingSeedPromise = null;
  }
}

function buildRunDurations(metricsJson: unknown): ReviewTrainingDurationsView {
  const metrics = asObject(metricsJson);
  const durations = asObject(metrics.durations);

  return {
    buildMs: asNumber(durations.buildMs),
    trainMs: asNumber(durations.trainMs),
    totalMs: asNumber(durations.totalMs),
  };
}

function mapTrainingRunToView(row: TrainingRunRow): ReviewTrainingRunView {
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

export async function listTrainingRunsFromDb(
  kinds: string[] = ["sft", "dpo"],
): Promise<TrainingRunRow[]> {
  await seedLegacyTrainingRuns();
  const result = await dbQuery<TrainingRunRow>(
    `SELECT *
       FROM npc_training_run
      WHERE run_kind = ANY($1::text[])
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC`,
    [kinds],
  );
  return result.rows;
}

export async function getTrainingRunViewsFromDb(): Promise<ReviewTrainingRunView[]> {
  const rows = await listTrainingRunsFromDb(["sft", "dpo"]);
  return rows.map((row) => mapTrainingRunToView(row));
}

export async function getLatestFinalizeRunFromDb(): Promise<TrainingRunRow | null> {
  const result = await dbQuery<TrainingRunRow>(
    `SELECT *
       FROM npc_training_run
      WHERE run_kind = 'finalize'
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export async function createFinalizeRunInDb() {
  return withDbTransaction(async (client) => {
    const runUid = `${new Date().toISOString().replace(/[:.]/g, "-")}_finalize`;
    const runId = await insertTrainingRunRow(client, {
      run_uid: runUid,
      run_kind: "finalize",
      state: "running",
      current_step: "finalize_sft",
      message: "SFT finalize 실행 중",
      params_json: {},
      metrics_json: {
        durations: {
          sftMs: null,
          preferenceMs: null,
          totalMs: null,
        },
        outputs: {
          sft: null,
          preference: null,
        },
      },
      requested_from: "review_finalize",
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { runId, runUid };
  });
}

export async function updateFinalizeRunInDb(params: {
  runUid: string;
  state: "running" | "succeeded" | "failed";
  currentStep: ReviewFinalizeStatusView["currentStep"];
  message: string | null;
  finishedAt?: string | null;
  durations?: {
    sftMs: number | null;
    preferenceMs: number | null;
    totalMs: number | null;
  };
  outputs?: {
    sft: string | null;
    preference: string | null;
  };
}) {
  const result = await dbQuery<TrainingRunRow>(
    "SELECT * FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [params.runUid],
  );
  const current = result.rows[0];

  if (!current) {
    throw new Error(`finalize run not found: ${params.runUid}`);
  }

  const metrics = {
    ...asObject(current.metrics_json),
    durations: params.durations ?? asObject(asObject(current.metrics_json).durations),
    outputs: params.outputs ?? asObject(asObject(current.metrics_json).outputs),
  };

  await dbQuery(
    `UPDATE npc_training_run
        SET state = $2,
            current_step = $3,
            message = $4,
            metrics_json = $5,
            finished_at = $6,
            updated_at = CURRENT_TIMESTAMP
      WHERE run_uid = $1`,
    [
      params.runUid,
      params.state,
      params.currentStep,
      params.message,
      jsonParam(metrics),
      params.finishedAt ?? current.finished_at ?? null,
    ],
  );
}

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

export async function createTrainingRunInDb(params: {
  runUid: string;
  kind: ReviewTrainingKind;
  trainingBackend: ReviewTrainingBackend;
  canonicalModelFamily: string | null;
  state: "running";
  currentStep: ReviewTrainingRunView["currentStep"];
  message: string;
  sourceSnapshotId: number | null;
  sourceFingerprint: string;
  sourceDatasetVersion: string | null;
  parentRunUid: string | null;
  baseModel: string;
  datasetDir: string;
  adapterPath: string | null;
  runtimeArtifactPath: string | null;
  runtimeArtifactKind: ReviewTrainingRuntimeArtifactKind | null;
  remoteProvider?: string | null;
  remoteJobId?: string | null;
  remoteTrainingFileId?: string | null;
  remoteValidationFileId?: string | null;
  remoteModelName?: string | null;
  logPath: string;
  trainingResultPath?: string | null;
  fingerprint: string;
  commands: TrainingRunSpecRecord["commands"];
}) {
  return withDbTransaction(async (client) => {
    const parentRunId = params.parentRunUid
      ? await findTrainingRunIdByUid(client, params.parentRunUid)
      : null;
    await insertTrainingRunRow(client, {
      run_uid: params.runUid,
      run_kind: params.kind,
      state: params.state,
      current_step: params.currentStep,
      message: params.message,
      source_snapshot_id: params.sourceSnapshotId,
      parent_run_id: parentRunId,
      base_model: params.baseModel,
      training_backend: params.trainingBackend,
      output_adapter_path: params.adapterPath,
      runtime_artifact_path: params.runtimeArtifactPath,
      runtime_artifact_kind: params.runtimeArtifactKind,
      remote_provider: params.remoteProvider ?? null,
      remote_job_id: params.remoteJobId ?? null,
      remote_training_file_id: params.remoteTrainingFileId ?? null,
      remote_validation_file_id: params.remoteValidationFileId ?? null,
      remote_model_name: params.remoteModelName ?? null,
      dataset_work_dir: params.datasetDir,
      params_json: {
        canonicalModelFamily: params.canonicalModelFamily,
        sourceDatasetVersion: params.sourceDatasetVersion,
        parentRunUid: params.parentRunUid,
        logPath: params.logPath,
        trainingResultPath: params.trainingResultPath ?? null,
        commands: params.commands,
      },
      metrics_json: {
        durations: {
          buildMs: null,
          trainMs: null,
          totalMs: null,
        },
      },
      run_fingerprint: params.fingerprint,
      source_fingerprint: params.sourceFingerprint,
      requested_from: "review_training",
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return params.runUid;
  });
}

export async function getTrainingRunSpecFromDb(
  runUid: string,
): Promise<TrainingRunSpecRecord | null> {
  await seedLegacyTrainingRuns();

  const result = await dbQuery<TrainingRunRow>(
    "SELECT * FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [runUid],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

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

export async function updateTrainingRunStateInDb(params: {
  runUid: string;
  state: "running" | "succeeded" | "failed";
  currentStep: ReviewTrainingRunView["currentStep"];
  message: string | null;
  durations?: ReviewTrainingDurationsView;
  finishedAt?: string | null;
  trainingBackend?: ReviewTrainingBackend | null;
  adapterPath?: string | null;
  adapterVersion?: string | null;
  runtimeArtifactPath?: string | null;
  runtimeArtifactKind?: ReviewTrainingRuntimeArtifactKind | null;
  remoteProvider?: string | null;
  remoteJobId?: string | null;
  remoteTrainingFileId?: string | null;
  remoteValidationFileId?: string | null;
  remoteModelName?: string | null;
}) {
  const result = await dbQuery<TrainingRunRow>(
    "SELECT * FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [params.runUid],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error(`training run not found: ${params.runUid}`);
  }

  const nextDurations = params.durations ?? buildRunDurations(row.metrics_json);
  await dbQuery(
    `UPDATE npc_training_run
        SET state = $2,
            current_step = $3,
            message = $4,
            training_backend = COALESCE($5, training_backend),
            output_adapter_path = COALESCE($6, output_adapter_path),
            output_adapter_version = COALESCE($7, output_adapter_version),
            runtime_artifact_path = COALESCE($8, runtime_artifact_path),
            runtime_artifact_kind = COALESCE($9, runtime_artifact_kind),
            remote_provider = COALESCE($10, remote_provider),
            remote_job_id = COALESCE($11, remote_job_id),
            remote_training_file_id = COALESCE($12, remote_training_file_id),
            remote_validation_file_id = COALESCE($13, remote_validation_file_id),
            remote_model_name = COALESCE($14, remote_model_name),
            metrics_json = $15,
            finished_at = $16,
            updated_at = CURRENT_TIMESTAMP
      WHERE run_uid = $1`,
    [
      params.runUid,
      params.state,
      params.currentStep,
      params.message,
      params.trainingBackend ?? null,
      params.adapterPath ?? null,
      params.adapterVersion ?? null,
      params.runtimeArtifactPath ?? null,
      params.runtimeArtifactKind ?? null,
      params.remoteProvider ?? null,
      params.remoteJobId ?? null,
      params.remoteTrainingFileId ?? null,
      params.remoteValidationFileId ?? null,
      params.remoteModelName ?? null,
      jsonParam({
        durations: nextDurations,
      }),
      params.finishedAt ?? row.finished_at ?? null,
    ],
  );
}

export async function updateTrainingRunRemoteDeploymentInDb(params: {
  runUid: string;
  remoteProvider: string;
  remoteModelName: string;
  message?: string | null;
  deployment?: unknown;
}) {
  const result = await dbQuery<TrainingRunRow>(
    "SELECT * FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [params.runUid],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error(`training run not found: ${params.runUid}`);
  }

  const existingParams = asObject(row.params_json);
  const nextRemoteDeployment = {
    ...asObject(existingParams.remoteDeployment),
    ...asObject(params.deployment),
  };

  await dbQuery(
    `UPDATE npc_training_run
        SET remote_provider = $2,
            remote_model_name = $3,
            message = COALESCE($4, message),
            params_json = $5,
            updated_at = CURRENT_TIMESTAMP
      WHERE run_uid = $1`,
    [
      params.runUid,
      params.remoteProvider,
      params.remoteModelName,
      params.message ?? null,
      jsonParam({
        ...existingParams,
        remoteDeployment: nextRemoteDeployment,
      }),
    ],
  );
}

export async function appendTrainingRunEventInDb(params: {
  runUid: string;
  level: string;
  eventType: string;
  step: string | null;
  message: string;
  payload?: unknown;
}) {
  const runResult = await dbQuery<TrainingRunRow>(
    "SELECT id FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [params.runUid],
  );
  const runId = runResult.rows[0]?.id;

  if (!runId) {
    return;
  }

  const seqResult = await dbQuery<{ next_seq: string }>(
    "SELECT COALESCE(MAX(seq_no), 0)::text AS next_seq FROM npc_training_run_event WHERE training_run_id = $1",
    [runId],
  );
  const nextSeq = Number(seqResult.rows[0]?.next_seq ?? "0") + 1;

  await dbQuery(
    `INSERT INTO npc_training_run_event (
        training_run_id,
        seq_no,
        level,
        event_type,
        step,
        message,
        payload_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      runId,
      nextSeq,
      params.level,
      params.eventType,
      params.step,
      params.message,
      jsonParam(params.payload ?? null),
    ],
  );
}

export async function appendTrainingRunLogChunkInDb(params: {
  runUid: string;
  streamName: string;
  chunkIndex: number;
  chunkText: string;
}) {
  const runResult = await dbQuery<TrainingRunRow>(
    "SELECT id FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [params.runUid],
  );
  const runId = runResult.rows[0]?.id;

  if (!runId) {
    return;
  }

  await dbQuery(
    `INSERT INTO npc_training_run_log_chunk (
        training_run_id,
        stream_name,
        chunk_index,
        chunk_text
      ) VALUES ($1,$2,$3,$4)`,
    [runId, params.streamName, params.chunkIndex, params.chunkText],
  );
}

export async function registerTrainingArtifactInDb(params: {
  runUid: string;
  artifactKind: string;
  filePath: string;
  metadata?: unknown;
}) {
  const runResult = await dbQuery<TrainingRunRow>(
    "SELECT id FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [params.runUid],
  );
  const runId = runResult.rows[0]?.id;

  if (!runId) {
    return;
  }

  let fileSizeBytes: number | null = null;
  let sha256: string | null = null;
  let pathType: "file" | "directory" | "missing" = "missing";

  if (await pathExists(params.filePath)) {
    const stats = await fs.stat(params.filePath);
    pathType = stats.isDirectory() ? "directory" : "file";
    fileSizeBytes = stats.isFile() ? stats.size : null;
    if (stats.isFile()) {
      sha256 = createHash("sha256")
        .update(await fs.readFile(params.filePath))
        .digest("hex");
    }
  }

  await dbQuery(
    `INSERT INTO npc_training_run_artifact (
        training_run_id,
        artifact_kind,
        file_path,
        file_size_bytes,
        sha256,
        metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      runId,
      params.artifactKind,
      params.filePath,
      fileSizeBytes,
      sha256,
      jsonParam({
        pathType,
        ...(asObject(params.metadata) ?? {}),
      }),
    ],
  );
}

export async function getTrainingStatusFromDb(params: {
  sftPreflight: ReviewTrainingPreflightView;
  dpoPreflight: ReviewTrainingPreflightView;
}): Promise<ReviewTrainingStatusView> {
  const rows = await listTrainingRunsFromDb(["sft", "dpo"]);
  const views = rows.map((row) => mapTrainingRunToView(row));
  const activeRun = views.find((row) => row.state === "running") ?? null;
  const latestRun = views[0] ?? null;

  return {
    activeRun,
    latestRun,
    sft: params.sftPreflight,
    dpo: params.dpoPreflight,
  };
}

export async function getLatestSuccessfulTrainingRun(
  kind: ReviewTrainingKind,
): Promise<TrainingRunRow | null> {
  await seedLegacyTrainingRuns();
  const result = await dbQuery<TrainingRunRow>(
    `SELECT *
       FROM npc_training_run
      WHERE run_kind = $1
        AND state = 'succeeded'
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1`,
    [kind],
  );
  return result.rows[0] ?? null;
}

export async function getTrainingRunByFingerprint(params: {
  kind: ReviewTrainingKind;
  fingerprint: string;
}): Promise<TrainingRunRow | null> {
  await seedLegacyTrainingRuns();
  const result = await dbQuery<TrainingRunRow>(
    `SELECT *
       FROM npc_training_run
      WHERE run_kind = $1
        AND run_fingerprint = $2
        AND state IN ('running', 'succeeded')
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1`,
    [params.kind, params.fingerprint],
  );
  return result.rows[0] ?? null;
}
