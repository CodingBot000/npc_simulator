import type {
  ReviewFinalizeStatusView,
  ReviewTrainingBackend,
  ReviewTrainingDurationsView,
  ReviewTrainingKind,
  ReviewTrainingPreflightView,
  ReviewTrainingRuntimeArtifactKind,
  ReviewTrainingRunView,
  ReviewTrainingStatusView,
} from "@backend-contracts/review";
import { dbQuery, withDbTransaction } from "@server/db/postgres";
import {
  type TrainingRunRow,
  asObject,
  jsonParam,
} from "@server/db/review-db-core";
import {
  findTrainingRunIdByUid,
  getTrainingRunRowByUid,
  insertTrainingRunRow,
} from "@server/db/review-training-run-core-db";
import {
  buildRunDurations,
  mapTrainingRunSpecRecord,
  mapTrainingRunToView,
  type TrainingRunSpecRecord,
} from "@server/db/review-training-run-mappers";
import { seedLegacyTrainingRuns } from "@server/db/review-training-run-seed-db";

export {
  appendTrainingRunEventInDb,
  appendTrainingRunLogChunkInDb,
  registerTrainingArtifactInDb,
} from "@server/db/review-training-run-artifact-db";
export type { TrainingRunSpecRecord } from "@server/db/review-training-run-mappers";

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
  const current = await getTrainingRunRowByUid(params.runUid);

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

  const row = await getTrainingRunRowByUid(runUid);

  if (!row) {
    return null;
  }

  return mapTrainingRunSpecRecord(row, runUid);
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
  const row = await getTrainingRunRowByUid(params.runUid);

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
  const row = await getTrainingRunRowByUid(params.runUid);

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
