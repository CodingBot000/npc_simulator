import fs from "node:fs/promises";
import path from "node:path";
import { withDbTransaction } from "@server/db/postgres";
import {
  LEGACY_TRAIN_RUNS_DIR,
  type RawRecord,
  asObject,
  asString,
  pathExists,
  readJsonFile,
} from "@server/db/review-db-core";
import {
  findTrainingRunIdByUid,
  insertTrainingRunRow,
} from "@server/db/review-training-run-core-db";
import { ensureSnapshotsSeededFromFiles } from "@server/db/review-snapshot-db";

let trainingSeedPromise: Promise<void> | null = null;

export async function seedLegacyTrainingRuns() {
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
