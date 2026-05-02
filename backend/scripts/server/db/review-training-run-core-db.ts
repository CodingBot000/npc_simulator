import type { PoolClient } from "pg";
import { dbQuery } from "@server/db/postgres";
import { jsonParam, type TrainingRunRow } from "@server/db/review-db-core";

export async function insertTrainingRunRow(
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

export async function findTrainingRunIdByUid(
  client: PoolClient,
  runUid: string,
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [runUid],
  );
  return result.rows[0]?.id ?? null;
}

export async function getTrainingRunIdByUid(runUid: string): Promise<number | null> {
  const result = await dbQuery<{ id: number }>(
    "SELECT id FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [runUid],
  );
  return result.rows[0]?.id ?? null;
}

export async function getTrainingRunRowByUid(
  runUid: string,
): Promise<TrainingRunRow | null> {
  const result = await dbQuery<TrainingRunRow>(
    "SELECT * FROM npc_training_run WHERE run_uid = $1 ORDER BY id DESC LIMIT 1",
    [runUid],
  );
  return result.rows[0] ?? null;
}
