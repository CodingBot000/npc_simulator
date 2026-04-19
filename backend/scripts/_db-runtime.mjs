import { Pool } from "pg";

function stripJdbcPrefix(value) {
  return String(value).startsWith("jdbc:") ? String(value).slice("jdbc:".length) : String(value);
}

function buildConnectionConfig() {
  const jdbcUrl =
    process.env.SPRING_DATASOURCE_URL || "jdbc:postgresql://localhost:5432/npc_simulator";
  const parsedUrl = new URL(stripJdbcPrefix(jdbcUrl));

  if (!/^postgres(?:ql)?:$/u.test(parsedUrl.protocol)) {
    throw new Error(`Unsupported datasource protocol: ${parsedUrl.protocol}`);
  }

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 5432,
    database: parsedUrl.pathname.replace(/^\/+/u, "") || "npc_simulator",
    user:
      process.env.SPRING_DATASOURCE_USERNAME ||
      decodeURIComponent(parsedUrl.username) ||
      "npc_simulator",
    password:
      process.env.SPRING_DATASOURCE_PASSWORD ||
      decodeURIComponent(parsedUrl.password) ||
      "npc_simulator",
    max: Number(process.env.NPC_SIMULATOR_DB_POOL_MAX || "4"),
    idleTimeoutMillis: Number(process.env.NPC_SIMULATOR_DB_IDLE_TIMEOUT_MS || "30000"),
    connectionTimeoutMillis: Number(
      process.env.NPC_SIMULATOR_DB_CONNECT_TIMEOUT_MS || "10000",
    ),
  };
}

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool(buildConnectionConfig());
  }

  return pool;
}

export async function dbQuery(text, values = []) {
  return getPool().query(text, values);
}

function asObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export async function loadSftReviewRecordsFromDb() {
  const result = await dbQuery(
    `SELECT
        t.review_uid,
        t.status,
        t.review_required,
        t.current_decision,
        t.current_reviewer,
        t.current_reviewed_at,
        t.current_notes,
        c.row_key,
        c.canonical_row_key,
        c.prompt_bundle_json,
        c.assistant_output_json
      FROM npc_review_task t
      JOIN npc_sft_candidate c
        ON c.id = t.sft_candidate_id
     WHERE t.review_kind = 'sft'
     ORDER BY t.created_at ASC, t.id ASC`,
  );

  return {
    files: ["db:npc_review_task.sft"],
    records: result.rows.map((row) => ({
      reviewId: row.review_uid,
      canonicalRowKey: row.canonical_row_key,
      sourceRowId: row.row_key,
      promptBundle: asObject(row.prompt_bundle_json),
      candidateOutput: asObject(row.assistant_output_json),
      decision: row.current_decision,
      status: row.status,
      reviewRequired: Boolean(row.review_required),
      reviewer: row.current_reviewer,
      reviewedAt:
        row.current_reviewed_at instanceof Date
          ? row.current_reviewed_at.toISOString()
          : row.current_reviewed_at,
      notes: row.current_notes ?? "",
    })),
  };
}

export async function loadPairReviewRecordsFromDb() {
  const result = await dbQuery(
    `SELECT
        t.review_uid,
        t.status,
        t.review_required,
        t.current_decision,
        t.current_reviewer,
        t.current_reviewed_at,
        t.current_notes,
        p.pair_key
      FROM npc_review_task t
      JOIN npc_preference_pair p
        ON p.id = t.preference_pair_id
     WHERE t.review_kind = 'pair'
     ORDER BY t.created_at ASC, t.id ASC`,
  );

  return {
    files: ["db:npc_review_task.pair"],
    records: result.rows.map((row) => ({
      reviewId: row.review_uid,
      pairId: row.pair_key,
      decision: row.current_decision,
      status: row.status,
      reviewRequired: Boolean(row.review_required),
      reviewer: row.current_reviewer,
      reviewedAt:
        row.current_reviewed_at instanceof Date
          ? row.current_reviewed_at.toISOString()
          : row.current_reviewed_at,
      notes: row.current_notes ?? "",
    })),
  };
}

export async function loadSnapshotRowsFromDb({ kind, snapshotId = null, splitName = null }) {
  const snapshotResult = snapshotId
    ? await dbQuery(
        `SELECT *
           FROM npc_dataset_snapshot
          WHERE id = $1
            AND dataset_kind = $2
          ORDER BY id DESC
          LIMIT 1`,
        [snapshotId, kind],
      )
    : await dbQuery(
        `SELECT *
           FROM npc_dataset_snapshot
          WHERE dataset_kind = $1
            AND is_active = TRUE
          ORDER BY generated_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [kind],
      );
  const snapshot = snapshotResult.rows[0];

  if (!snapshot?.id) {
    throw new Error(
      snapshotId
        ? `Snapshot not found: kind=${kind} snapshotId=${snapshotId}`
        : `Active snapshot not found: kind=${kind}`,
    );
  }

  const itemResult = splitName
    ? await dbQuery(
        `SELECT position_index, row_payload_json
           FROM npc_dataset_snapshot_item
          WHERE snapshot_id = $1
            AND split_name = $2
          ORDER BY position_index ASC, id ASC`,
        [snapshot.id, splitName],
      )
    : await dbQuery(
        `SELECT position_index, row_payload_json
           FROM npc_dataset_snapshot_item
          WHERE snapshot_id = $1
          ORDER BY position_index ASC, id ASC`,
        [snapshot.id],
      );

  return {
    snapshotId: Number(snapshot.id),
    datasetVersion: asString(snapshot.dataset_version),
    sourceFingerprint: asString(snapshot.source_fingerprint),
    rows: itemResult.rows.map((row) => asObject(row.row_payload_json)),
    counts: {
      total: itemResult.rows.length,
      rowCount: itemResult.rows.length,
    },
  };
}

export async function closeDbPool() {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

