import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { dbQuery } from "@server/db/postgres";
import {
  asObject,
  jsonParam,
  pathExists,
} from "@server/db/review-db-core";
import { getTrainingRunIdByUid } from "@server/db/review-training-run-core-db";

export async function appendTrainingRunEventInDb(params: {
  runUid: string;
  level: string;
  eventType: string;
  step: string | null;
  message: string;
  payload?: unknown;
}) {
  const runId = await getTrainingRunIdByUid(params.runUid);

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
  const runId = await getTrainingRunIdByUid(params.runUid);

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
  const runId = await getTrainingRunIdByUid(params.runUid);

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
