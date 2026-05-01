import type { PoolClient } from "pg";
import { dbQuery, withDbTransaction } from "@server/db/postgres";
import {
  PREFERENCE_MANIFEST_PATH,
  PREFERENCE_PAIRS_PATH,
  SFT_DEV_PATH,
  SFT_MANIFEST_PATH,
  SFT_TRAIN_PATH,
  type RawRecord,
  type SnapshotRow,
  asObject,
  asString,
  findCandidateIdByRowKey,
  findPairIdByKey,
  fingerprintFiles,
  hashValue,
  isoString,
  jsonParam,
  pathExists,
  readJsonFile,
  readJsonlFile,
} from "@server/db/review-db-core";

let snapshotSeedPromise: Promise<void> | null = null;

async function resolveSnapshotItemCandidateId(
  client: PoolClient,
  rowPayload: RawRecord,
): Promise<number | null> {
  const rowId =
    asString(rowPayload.rowId) ??
    asString(asObject(rowPayload).pairId) ??
    null;

  if (!rowId) {
    return null;
  }

  return findCandidateIdByRowKey(client, rowId);
}

async function upsertSnapshotFromFiles(
  client: PoolClient,
  params: {
    kind: "sft" | "preference";
    manifestPath: string;
    dataPaths: string[];
  },
) {
  if (
    !(await pathExists(params.manifestPath)) ||
    (await Promise.all(params.dataPaths.map((entry) => pathExists(entry)))).some(
      (exists) => !exists,
    )
  ) {
    return null;
  }

  const manifest = (await readJsonFile<RawRecord>(params.manifestPath)) ?? {};
  const datasets = await Promise.all(params.dataPaths.map((entry) => readJsonlFile(entry)));
  const sourceFingerprint = await fingerprintFiles(params.dataPaths);
  const snapshotFingerprint = hashValue({
    kind: params.kind,
    manifest,
    sourceFingerprint,
  });
  const existingResult = await client.query<SnapshotRow>(
    `SELECT *
       FROM npc_dataset_snapshot
      WHERE dataset_kind = $1
        AND snapshot_fingerprint = $2
      ORDER BY id DESC
      LIMIT 1`,
    [params.kind, snapshotFingerprint],
  );
  const outputUri = params.manifestPath;
  const generatedAt =
    asString(manifest.generatedAt) ?? new Date().toISOString();
  let snapshotId = existingResult.rows[0]?.id ?? null;

  await client.query(
    "UPDATE npc_dataset_snapshot SET is_active = FALSE WHERE dataset_kind = $1",
    [params.kind],
  );

  if (!snapshotId) {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO npc_dataset_snapshot (
          snapshot_uid,
          dataset_kind,
          dataset_version,
          snapshot_fingerprint,
          source_fingerprint,
          manifest_json,
          summary_json,
          output_uri,
          is_active,
          generated_by,
          generated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10)
        RETURNING id`,
      [
        `${params.kind}-${generatedAt.replace(/[:.]/g, "-")}`,
        params.kind,
        asString(manifest.datasetVersion) ?? `${params.kind}-${generatedAt.slice(0, 10)}`,
        snapshotFingerprint,
        sourceFingerprint,
        jsonParam(manifest),
        jsonParam(manifest),
        outputUri,
        "file_sync",
        generatedAt,
      ],
    );
    snapshotId = inserted.rows[0].id;
  } else {
    await client.query(
      `UPDATE npc_dataset_snapshot
          SET dataset_version = $2,
              source_fingerprint = $3,
              manifest_json = $4,
              summary_json = $5,
              output_uri = $6,
              is_active = TRUE,
              generated_at = $7
        WHERE id = $1`,
      [
        snapshotId,
        asString(manifest.datasetVersion) ?? `${params.kind}-${generatedAt.slice(0, 10)}`,
        sourceFingerprint,
        jsonParam(manifest),
        jsonParam(manifest),
        outputUri,
        generatedAt,
      ],
    );
  }

  await client.query("DELETE FROM npc_dataset_snapshot_item WHERE snapshot_id = $1", [
    snapshotId,
  ]);

  let positionIndex = 0;
  for (const [datasetIndex, rows] of datasets.entries()) {
    const itemKind =
      params.kind === "sft"
        ? datasetIndex === 0
          ? "sft_train"
          : "sft_dev"
        : "preference_pair";
    const splitName =
      params.kind === "sft" ? (datasetIndex === 0 ? "train" : "dev") : null;

    for (const row of rows) {
      positionIndex += 1;
      const sftCandidateId =
        params.kind === "sft"
          ? await resolveSnapshotItemCandidateId(client, row)
          : null;
      const preferencePairId =
        params.kind === "preference"
          ? await findPairIdByKey(client, asString(row.pairId) ?? "")
          : null;

      await client.query(
        `INSERT INTO npc_dataset_snapshot_item (
            snapshot_id,
            item_kind,
            split_name,
            position_index,
            sft_candidate_id,
            preference_pair_id,
            inclusion_reason,
            row_fingerprint,
            row_payload_json
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          snapshotId,
          itemKind,
          splitName,
          positionIndex,
          sftCandidateId,
          preferencePairId,
          null,
          hashValue(row),
          jsonParam(row),
        ],
      );
    }
  }

  return {
    snapshotId,
    datasetVersion: asString(manifest.datasetVersion) ?? null,
    fingerprint: sourceFingerprint,
    manifestPath: params.manifestPath,
    rowCount: positionIndex,
  };
}

export async function ensureSnapshotsSeededFromFiles() {
  if (snapshotSeedPromise) {
    return snapshotSeedPromise;
  }

  snapshotSeedPromise = (async () => {
    await withDbTransaction(async (client) => {
      await upsertSnapshotFromFiles(client, {
        kind: "sft",
        manifestPath: SFT_MANIFEST_PATH,
        dataPaths: [SFT_TRAIN_PATH, SFT_DEV_PATH],
      });
      await upsertSnapshotFromFiles(client, {
        kind: "preference",
        manifestPath: PREFERENCE_MANIFEST_PATH,
        dataPaths: [PREFERENCE_PAIRS_PATH],
      });
    });
  })();

  try {
    await snapshotSeedPromise;
  } finally {
    snapshotSeedPromise = null;
  }
}

export async function syncSnapshotsFromFilesToDb() {
  await ensureSnapshotsSeededFromFiles();
}

export async function getActiveSnapshotSummary(kind: "sft" | "preference") {
  await ensureSnapshotsSeededFromFiles();

  const snapshotResult = await dbQuery<SnapshotRow>(
    `SELECT *
       FROM npc_dataset_snapshot
      WHERE dataset_kind = $1
        AND is_active = TRUE
      ORDER BY generated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [kind],
  );
  const snapshot = snapshotResult.rows[0];

  if (!snapshot) {
    return null;
  }

  const countResult = await dbQuery<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM npc_dataset_snapshot_item WHERE snapshot_id = $1",
    [snapshot.id],
  );
  const manifest = asObject(snapshot.manifest_json);

  return {
    snapshotId: snapshot.id,
    datasetVersion: snapshot.dataset_version,
    fingerprint: snapshot.source_fingerprint,
    manifestPath:
      snapshot.output_uri ??
      asString(asObject(manifest.outputFiles).manifest) ??
      null,
    rowCount: Number(countResult.rows[0]?.count ?? "0"),
    generatedAt: isoString(snapshot.generated_at),
  };
}
