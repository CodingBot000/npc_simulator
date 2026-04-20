import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type {
  PairReviewDecision,
  PairReviewItemView,
  ReviewFinalizeStatusView,
  ReviewKind,
  ReviewTrainingBackend,
  ReviewTrainingBindingKey,
  ReviewTrainingDurationsView,
  ReviewTrainingKind,
  ReviewTrainingPreflightView,
  ReviewTrainingRuntimeArtifactKind,
  ReviewTrainingRunView,
  ReviewTrainingStatusView,
  SftReviewDecision,
  SftReviewItemView,
} from "@/lib/review-types";
import { DATA_DIR, PROJECT_ROOT } from "@server/config";
import { dbQuery, withDbTransaction } from "@server/db/postgres";

type RawRecord = Record<string, unknown>;

const REVIEW_DIR = path.join(DATA_DIR, "review", "live");
const REVIEW_FILES = {
  sft: {
    json: path.join(REVIEW_DIR, "human_review_sft_queue.json"),
    jsonl: path.join(REVIEW_DIR, "human_review_sft_queue.jsonl"),
  },
  pair: {
    json: path.join(REVIEW_DIR, "human_review_pair_queue.json"),
    jsonl: path.join(REVIEW_DIR, "human_review_pair_queue.jsonl"),
  },
} as const;

const LLM_FIRST_PASS_FILES = {
  sft: {
    json: path.join(REVIEW_DIR, "llm_first_pass_sft_queue.json"),
    jsonl: path.join(REVIEW_DIR, "llm_first_pass_sft_queue.jsonl"),
  },
  pair: {
    json: path.join(REVIEW_DIR, "llm_first_pass_pair_queue.json"),
    jsonl: path.join(REVIEW_DIR, "llm_first_pass_pair_queue.jsonl"),
  },
} as const;

const PIPELINE_FILES = {
  judgedSft: path.join(DATA_DIR, "evals", "judged", "judged-review-live.jsonl"),
  judgedPairs: path.join(
    DATA_DIR,
    "evals",
    "preference",
    "candidate_pairs_live_gap1.jsonl",
  ),
} as const;

const SFT_MANIFEST_PATH = path.join(DATA_DIR, "train", "sft", "live", "manifest.json");
const SFT_TRAIN_PATH = path.join(DATA_DIR, "train", "sft", "live", "final_sft_train.jsonl");
const SFT_DEV_PATH = path.join(DATA_DIR, "train", "sft", "live", "final_sft_dev.jsonl");
const PREFERENCE_MANIFEST_PATH = path.join(
  DATA_DIR,
  "train",
  "preference",
  "live",
  "manifest.json",
);
const PREFERENCE_PAIRS_PATH = path.join(
  DATA_DIR,
  "train",
  "preference",
  "live",
  "final_preference_pairs.jsonl",
);
const LEGACY_TRAIN_RUNS_DIR = path.join(DATA_DIR, "train", "runs");

let reviewSeedPromise: Promise<void> | null = null;
let trainingSeedPromise: Promise<void> | null = null;
let snapshotSeedPromise: Promise<void> | null = null;

interface CandidateRow {
  id: number;
  row_key: string | null;
  canonical_row_key: string | null;
  episode_id: number | null;
  episode_turn_id: number | null;
  source_kind: string | null;
  instruction_text: string | null;
  prompt_bundle_json: unknown;
  assistant_output_json: unknown;
  metadata_json: unknown;
  rubric_hints_json: unknown;
  filter_result_json: unknown;
  judge_result_json: unknown;
  weighted_judge_score: number | string | null;
  judge_confidence: number | string | null;
  strategy_label: string | null;
  scenario_id: string | null;
  npc_id: string | null;
  target_npc_id: string | null;
  input_mode: string | null;
  deterministic_fallback_used: boolean | null;
  source_export_path: string | null;
  source_label: string | null;
  created_at: Date | string | null;
}

interface PairRow {
  id: number;
  pair_key: string | null;
  pair_fingerprint: string | null;
  grouping_strategy: string | null;
  grouping_key: string | null;
  prompt_bundle_json: unknown;
  chosen_candidate_id: number | null;
  rejected_candidate_id: number | null;
  pair_reason_json: unknown;
  weighted_gap: number | string | null;
  pair_confidence: number | string | null;
  preference_strength: number | string | null;
  judge_result_json: unknown;
  pair_decision: string | null;
  created_at: Date | string | null;
}

interface ReviewTaskRow {
  id: number;
  review_uid: string | null;
  review_kind: string | null;
  sft_candidate_id: number | null;
  preference_pair_id: number | null;
  bucket: string | null;
  priority: string | null;
  status: string | null;
  review_required: boolean | null;
  queue_reason: string | null;
  selection_reasons_json: unknown;
  selection_metrics_json: unknown;
  llm_first_pass_json: unknown;
  checklist_json: unknown;
  current_decision: string | null;
  current_reviewer: string | null;
  current_reviewed_at: Date | string | null;
  current_notes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface SnapshotRow {
  id: number;
  snapshot_uid: string | null;
  dataset_kind: string | null;
  dataset_version: string | null;
  snapshot_fingerprint: string | null;
  source_fingerprint: string | null;
  manifest_json: unknown;
  summary_json: unknown;
  output_uri: string | null;
  is_active: boolean | null;
  generated_by: string | null;
  generated_at: Date | string | null;
  created_at: Date | string | null;
}

interface TrainingRunRow {
  id: number;
  run_uid: string | null;
  run_kind: string | null;
  state: string | null;
  current_step: string | null;
  message: string | null;
  source_snapshot_id: number | null;
  parent_run_id: number | null;
  base_model: string | null;
  training_backend: string | null;
  output_adapter_path: string | null;
  output_adapter_version: string | null;
  runtime_artifact_path: string | null;
  runtime_artifact_kind: string | null;
  remote_provider: string | null;
  remote_job_id: string | null;
  remote_training_file_id: string | null;
  remote_validation_file_id: string | null;
  remote_model_name: string | null;
  dataset_work_dir: string | null;
  params_json: unknown;
  metrics_json: unknown;
  run_fingerprint: string | null;
  source_fingerprint: string | null;
  eval_state: string | null;
  eval_message: string | null;
  eval_binding_key: string | null;
  eval_baseline_label: string | null;
  eval_summary_path: string | null;
  eval_summary_json: unknown;
  eval_started_at: Date | string | null;
  eval_finished_at: Date | string | null;
  review_decision: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  promoted_binding_key: string | null;
  promoted_at: Date | string | null;
  requested_by: string | null;
  requested_from: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

function asObject(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isoString(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return null;
}

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function jsonParam(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function fallbackKey(prefix: string, value: unknown) {
  return `${prefix}:${hashValue(value).slice(0, 16)}`;
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonArrayFile(filePath: string): Promise<RawRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is RawRecord =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonlFile(filePath: string): Promise<RawRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (entry): entry is RawRecord =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readPrimaryJsonOrJsonl(
  paths: { json?: string | null; jsonl?: string | null },
): Promise<RawRecord[]> {
  if (paths.json) {
    const jsonRecords = await readJsonArrayFile(paths.json);
    if (jsonRecords.length > 0 || (await pathExists(paths.json))) {
      return jsonRecords;
    }
  }

  if (paths.jsonl) {
    return readJsonlFile(paths.jsonl);
  }

  return [];
}

async function writeReviewQueueFile(kind: ReviewKind, items: RawRecord[]) {
  const { json, jsonl } = REVIEW_FILES[kind];
  await fs.mkdir(path.dirname(json), { recursive: true });
  await fs.writeFile(json, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  const payload = items.map((entry) => JSON.stringify(entry)).join("\n");
  await fs.writeFile(jsonl, payload ? `${payload}\n` : "", "utf8");
}

async function fingerprintFiles(filePaths: string[]) {
  const hash = createHash("sha256");

  for (const filePath of filePaths) {
    hash.update(filePath);
    hash.update("\n");
    hash.update(await fs.readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function getCount(tableName: string) {
  const result = await dbQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count ?? "0");
}

async function findCandidateIdByRowKey(
  client: PoolClient,
  rowKey: string,
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_sft_candidate WHERE row_key = $1 ORDER BY id DESC LIMIT 1",
    [rowKey],
  );
  return result.rows[0]?.id ?? null;
}

async function findPairIdByKey(client: PoolClient, pairKey: string): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_preference_pair WHERE pair_key = $1 ORDER BY id DESC LIMIT 1",
    [pairKey],
  );
  return result.rows[0]?.id ?? null;
}

async function findReviewTaskId(
  client: PoolClient,
  reviewUid: string,
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_review_task WHERE review_uid = $1 ORDER BY id DESC LIMIT 1",
    [reviewUid],
  );
  return result.rows[0]?.id ?? null;
}

function buildSourcePayloadFromSftRaw(raw: RawRecord) {
  return {
    source: asObject(raw.source),
    sourceRowId: asString(raw.sourceRowId),
    qualityChecklist: asObject(raw.qualityChecklist),
  };
}

function buildPromptBundleSummary(promptBundle: RawRecord) {
  return {
    scenarioId: asString(promptBundle.scenarioId),
    npcId: asString(promptBundle.npcId),
    targetNpcId: asString(promptBundle.targetNpcId),
    inputMode: asString(promptBundle.inputMode),
  };
}

async function upsertSftCandidateFromReviewRaw(client: PoolClient, raw: RawRecord) {
  const promptBundle = asObject(raw.promptBundle);
  const candidateOutput = asObject(raw.candidateOutput);
  const judge = asObject(raw.judge);
  const source = asObject(raw.source);
  const metadataPayload = buildSourcePayloadFromSftRaw(raw);
  const rowKey =
    asString(raw.sourceRowId) ??
    asString(raw.rowId) ??
    asString(candidateOutput.rowId) ??
    fallbackKey("sft-row", {
      promptBundle,
      candidateOutput,
      source,
    });
  const existingId = await findCandidateIdByRowKey(client, rowKey);
  const summary = buildPromptBundleSummary(promptBundle);
  const values = [
    rowKey,
    asString(raw.canonicalRowKey),
    "review_queue",
    "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화와 구조화된 추론 JSON을 생성한다.",
    jsonParam(promptBundle),
    jsonParam(candidateOutput),
    jsonParam(metadataPayload),
    jsonParam(null),
    jsonParam(asObject(raw.filter)),
    jsonParam(judge),
    asNumber(raw.weightedJudgeScore),
    asNumber(judge.confidence),
    asString(source.strategyLabel),
    summary.scenarioId,
    summary.npcId,
    summary.targetNpcId,
    summary.inputMode,
    null,
    asString(source.exportPath),
    asString(source.sourceLabel),
  ];

  if (existingId) {
    await client.query(
      `UPDATE npc_sft_candidate
          SET canonical_row_key = $1,
              source_kind = $2,
              instruction_text = $3,
              prompt_bundle_json = $4,
              assistant_output_json = $5,
              metadata_json = $6,
              rubric_hints_json = $7,
              filter_result_json = $8,
              judge_result_json = $9,
              weighted_judge_score = $10,
              judge_confidence = $11,
              strategy_label = $12,
              scenario_id = $13,
              npc_id = $14,
              target_npc_id = $15,
              input_mode = $16,
              deterministic_fallback_used = $17,
              source_export_path = $18,
              source_label = $19
        WHERE id = $20`,
      [...values.slice(1), existingId],
    );
    return existingId;
  }

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO npc_sft_candidate (
        row_key,
        canonical_row_key,
        source_kind,
        instruction_text,
        prompt_bundle_json,
        assistant_output_json,
        metadata_json,
        rubric_hints_json,
        filter_result_json,
        judge_result_json,
        weighted_judge_score,
        judge_confidence,
        strategy_label,
        scenario_id,
        npc_id,
        target_npc_id,
        input_mode,
        deterministic_fallback_used,
        source_export_path,
        source_label
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
      RETURNING id`,
    values,
  );
  return inserted.rows[0].id;
}

function buildPairCandidateMetadata(rawCandidate: RawRecord) {
  return {
    source: asObject(rawCandidate.source),
    verdict: asString(rawCandidate.verdict),
    llmError: asString(rawCandidate.llmError),
    scores: asObject(rawCandidate.scores),
  };
}

async function upsertSftCandidateFromPairCandidateRaw(
  client: PoolClient,
  rawCandidate: RawRecord,
  promptBundle: RawRecord,
) {
  const candidateOutput = asObject(rawCandidate.candidateOutput);
  const rowKey =
    asString(rawCandidate.rowId) ??
    asString(candidateOutput.rowId) ??
    fallbackKey("pair-candidate", { rawCandidate, promptBundle });
  const existingId = await findCandidateIdByRowKey(client, rowKey);
  const summary = buildPromptBundleSummary(promptBundle);
  const values = [
    rowKey,
    null,
    "pair_candidate",
    "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화와 구조화된 추론 JSON을 생성한다.",
    jsonParam(promptBundle),
    jsonParam(candidateOutput),
    jsonParam(buildPairCandidateMetadata(rawCandidate)),
    jsonParam(null),
    jsonParam(null),
    jsonParam(null),
    asNumber(asObject(rawCandidate.scores).weightedScore),
    asNumber(asObject(rawCandidate.scores).confidence),
    null,
    summary.scenarioId,
    summary.npcId,
    summary.targetNpcId,
    summary.inputMode,
    null,
    null,
    asString(asObject(rawCandidate.source).label),
  ];

  if (existingId) {
    await client.query(
      `UPDATE npc_sft_candidate
          SET canonical_row_key = $1,
              source_kind = $2,
              instruction_text = $3,
              prompt_bundle_json = $4,
              assistant_output_json = $5,
              metadata_json = $6,
              rubric_hints_json = $7,
              filter_result_json = $8,
              judge_result_json = $9,
              weighted_judge_score = $10,
              judge_confidence = $11,
              strategy_label = $12,
              scenario_id = $13,
              npc_id = $14,
              target_npc_id = $15,
              input_mode = $16,
              deterministic_fallback_used = $17,
              source_export_path = $18,
              source_label = $19
        WHERE id = $20`,
      [...values.slice(1), existingId],
    );
    return existingId;
  }

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO npc_sft_candidate (
        row_key,
        canonical_row_key,
        source_kind,
        instruction_text,
        prompt_bundle_json,
        assistant_output_json,
        metadata_json,
        rubric_hints_json,
        filter_result_json,
        judge_result_json,
        weighted_judge_score,
        judge_confidence,
        strategy_label,
        scenario_id,
        npc_id,
        target_npc_id,
        input_mode,
        deterministic_fallback_used,
        source_export_path,
        source_label
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
      RETURNING id`,
    values,
  );
  return inserted.rows[0].id;
}

async function upsertPairFromReviewRaw(client: PoolClient, raw: RawRecord) {
  const candidatePair = asObject(raw.candidatePair);
  const promptBundle = asObject(candidatePair.promptBundle);
  const chosenRaw = asObject(candidatePair.chosenCandidate);
  const rejectedRaw = asObject(candidatePair.rejectedCandidate);
  const chosenCandidateId = await upsertSftCandidateFromPairCandidateRaw(
    client,
    chosenRaw,
    promptBundle,
  );
  const rejectedCandidateId = await upsertSftCandidateFromPairCandidateRaw(
    client,
    rejectedRaw,
    promptBundle,
  );
  const pairKey =
    asString(raw.pairId) ??
    asString(candidatePair.pairId) ??
    fallbackKey("pair", candidatePair);
  const existingId = await findPairIdByKey(client, pairKey);
  const grouping = asObject(candidatePair.grouping);
  const values = [
    pairKey,
    hashValue({
      pairKey,
      chosen: chosenRaw,
      rejected: rejectedRaw,
    }),
    asString(grouping.strategy),
    asString(grouping.key),
    jsonParam(promptBundle),
    chosenCandidateId,
    rejectedCandidateId,
    jsonParam(candidatePair.pairReason ?? null),
    asNumber(candidatePair.weightedGap),
    asNumber(candidatePair.pairConfidence),
    asNumber(candidatePair.preferenceStrength),
    jsonParam(asObject(candidatePair.judge)),
    asString(candidatePair.pairDecision) ?? asString(candidatePair.status),
  ];

  if (existingId) {
    await client.query(
      `UPDATE npc_preference_pair
          SET pair_fingerprint = $1,
              grouping_strategy = $2,
              grouping_key = $3,
              prompt_bundle_json = $4,
              chosen_candidate_id = $5,
              rejected_candidate_id = $6,
              pair_reason_json = $7,
              weighted_gap = $8,
              pair_confidence = $9,
              preference_strength = $10,
              judge_result_json = $11,
              pair_decision = $12
        WHERE id = $13`,
      [...values.slice(1), existingId],
    );
    return existingId;
  }

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO npc_preference_pair (
        pair_key,
        pair_fingerprint,
        grouping_strategy,
        grouping_key,
        prompt_bundle_json,
        chosen_candidate_id,
        rejected_candidate_id,
        pair_reason_json,
        weighted_gap,
        pair_confidence,
        preference_strength,
        judge_result_json,
        pair_decision
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      RETURNING id`,
    values,
  );
  return inserted.rows[0].id;
}

async function ensureReviewTaskFromRaw(
  client: PoolClient,
  kind: ReviewKind,
  raw: RawRecord,
) {
  const reviewUid =
    asString(raw.reviewId) ??
    fallbackKey(`review-${kind}`, raw);
  const reviewTaskId = await findReviewTaskId(client, reviewUid);
  const targetId =
    kind === "sft"
      ? await upsertSftCandidateFromReviewRaw(client, raw)
      : await upsertPairFromReviewRaw(client, raw);
  const values = [
    reviewUid,
    kind,
    kind === "sft" ? targetId : null,
    kind === "pair" ? targetId : null,
    asString(raw.bucket),
    asString(raw.priority),
    asString(raw.status) ?? (asString(raw.decision) ? "reviewed" : "pending"),
    asBoolean(raw.reviewRequired) ?? true,
    asString(raw.queueReason),
    jsonParam(raw.selectionReasons ?? null),
    jsonParam(asObject(raw.selectionMetrics)),
    jsonParam(asObject(raw.llmFirstPass)),
    jsonParam(asObject(raw.qualityChecklist)),
    asString(raw.decision),
    asString(raw.reviewer),
    asString(raw.reviewedAt),
    asString(raw.notes) ?? "",
  ];

  if (reviewTaskId) {
    await client.query(
      `UPDATE npc_review_task
          SET review_kind = $1,
              sft_candidate_id = $2,
              preference_pair_id = $3,
              bucket = $4,
              priority = $5,
              status = $6,
              review_required = $7,
              queue_reason = $8,
              selection_reasons_json = $9,
              selection_metrics_json = $10,
              llm_first_pass_json = $11,
              checklist_json = $12,
              current_decision = $13,
              current_reviewer = $14,
              current_reviewed_at = $15,
              current_notes = $16,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $17`,
      [...values.slice(1), reviewTaskId],
    );
    return reviewTaskId;
  }

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO npc_review_task (
        review_uid,
        review_kind,
        sft_candidate_id,
        preference_pair_id,
        bucket,
        priority,
        status,
        review_required,
        queue_reason,
        selection_reasons_json,
        selection_metrics_json,
        llm_first_pass_json,
        checklist_json,
        current_decision,
        current_reviewer,
        current_reviewed_at,
        current_notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING id`,
    values,
  );

  const taskId = inserted.rows[0].id;
  if (asString(raw.decision)) {
    await client.query(
      `INSERT INTO npc_review_decision_event (
          review_task_id,
          decision,
          status_after,
          reviewer,
          notes,
          checklist_json,
          decided_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          taskId,
          asString(raw.decision),
          asString(raw.status) ?? "reviewed",
          asString(raw.reviewer),
          asString(raw.notes) ?? "",
          jsonParam(asObject(raw.qualityChecklist)),
          asString(raw.reviewedAt) ?? new Date().toISOString(),
        ],
      );
  }
  return taskId;
}

async function updateReviewTaskLlmFirstPassFromRaw(
  client: PoolClient,
  kind: ReviewKind,
  raw: RawRecord,
) {
  const reviewUid = asString(raw.reviewId);
  const llmFirstPass = asObject(raw.llmFirstPass);

  if (!reviewUid || !Object.keys(llmFirstPass).length) {
    return;
  }

  await client.query(
    `UPDATE npc_review_task
        SET llm_first_pass_json = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE review_uid = $2
        AND review_kind = $3`,
    [jsonParam(llmFirstPass), reviewUid, kind],
  );
}

async function seedReviewTasksFromFiles() {
  if (reviewSeedPromise) {
    return reviewSeedPromise;
  }

  reviewSeedPromise = (async () => {
    if ((await getCount("npc_review_task")) > 0) {
      return;
    }

    const [sftItems, pairItems] = await Promise.all([
      readJsonArrayFile(REVIEW_FILES.sft.json),
      readJsonArrayFile(REVIEW_FILES.pair.json),
    ]);

    if (!sftItems.length && !pairItems.length) {
      return;
    }

    await withDbTransaction(async (client) => {
      for (const item of sftItems) {
        await ensureReviewTaskFromRaw(client, "sft", item);
      }
      for (const item of pairItems) {
        await ensureReviewTaskFromRaw(client, "pair", item);
      }
    });
  })();

  try {
    await reviewSeedPromise;
  } finally {
    reviewSeedPromise = null;
  }
}

export async function syncReviewQueueFromFilesToDb(params?: {
  sftJsonPath?: string | null;
  pairJsonPath?: string | null;
  sftJsonlPath?: string | null;
  pairJsonlPath?: string | null;
}) {
  const [sftItems, pairItems] = await Promise.all([
    readPrimaryJsonOrJsonl({
      json: params?.sftJsonPath ?? REVIEW_FILES.sft.json,
      jsonl: params?.sftJsonlPath ?? REVIEW_FILES.sft.jsonl,
    }),
    readPrimaryJsonOrJsonl({
      json: params?.pairJsonPath ?? REVIEW_FILES.pair.json,
      jsonl: params?.pairJsonlPath ?? REVIEW_FILES.pair.jsonl,
    }),
  ]);

  if (!sftItems.length && !pairItems.length) {
    return;
  }

  await withDbTransaction(async (client) => {
    for (const item of sftItems) {
      await ensureReviewTaskFromRaw(client, "sft", item);
    }
    for (const item of pairItems) {
      await ensureReviewTaskFromRaw(client, "pair", item);
    }
  });
}

export async function syncReviewLlmFirstPassFromFilesToDb(params?: {
  sftJsonPath?: string | null;
  pairJsonPath?: string | null;
  sftJsonlPath?: string | null;
  pairJsonlPath?: string | null;
}) {
  const [sftItems, pairItems] = await Promise.all([
    readPrimaryJsonOrJsonl({
      json: params?.sftJsonPath ?? LLM_FIRST_PASS_FILES.sft.json,
      jsonl: params?.sftJsonlPath ?? LLM_FIRST_PASS_FILES.sft.jsonl,
    }),
    readPrimaryJsonOrJsonl({
      json: params?.pairJsonPath ?? LLM_FIRST_PASS_FILES.pair.json,
      jsonl: params?.pairJsonlPath ?? LLM_FIRST_PASS_FILES.pair.jsonl,
    }),
  ]);

  if (!sftItems.length && !pairItems.length) {
    return;
  }

  await withDbTransaction(async (client) => {
    for (const item of sftItems) {
      await updateReviewTaskLlmFirstPassFromRaw(client, "sft", item);
    }
    for (const item of pairItems) {
      await updateReviewTaskLlmFirstPassFromRaw(client, "pair", item);
    }
  });
}

function buildSftRawFromRows(task: ReviewTaskRow, candidate: CandidateRow): RawRecord {
  const metadata = asObject(candidate.metadata_json);
  const promptBundle = asObject(candidate.prompt_bundle_json);
  const source = asObject(metadata.source);

  return {
    reviewId: task.review_uid ?? `sft:${candidate.row_key ?? candidate.id}`,
    reviewType: "sft_row",
    bucket: task.bucket,
    priority: task.priority,
    status: task.status ?? (task.current_decision ? "reviewed" : "pending"),
    decision: task.current_decision,
    reviewer: task.current_reviewer,
    reviewedAt: isoString(task.current_reviewed_at),
    notes: task.current_notes ?? "",
    reviewRequired: task.review_required ?? true,
    selectionReasons: task.selection_reasons_json ?? [],
    selectionMetrics: task.selection_metrics_json ?? {},
    sourceRowId: asString(metadata.sourceRowId) ?? candidate.row_key ?? null,
    canonicalRowKey: candidate.canonical_row_key,
    queueReason: task.queue_reason,
    source: {
      episodeId: asString(source.episodeId) ?? asString(promptBundle.episodeId),
      scenarioId: asString(source.scenarioId) ?? asString(promptBundle.scenarioId),
      turnIndex: asNumber(source.turnIndex) ?? asNumber(promptBundle.turnIndex),
      npcId: asString(source.npcId) ?? asString(promptBundle.npcId),
      targetNpcId:
        asString(source.targetNpcId) ?? asString(promptBundle.targetNpcId),
      strategyLabel:
        asString(source.strategyLabel) ?? candidate.strategy_label ?? null,
      exportPath:
        asString(source.exportPath) ?? candidate.source_export_path ?? null,
      sourceLabel:
        asString(source.sourceLabel) ?? candidate.source_label ?? null,
    },
    filter: candidate.filter_result_json ?? null,
    judge: candidate.judge_result_json ?? null,
    weightedJudgeScore: asNumber(candidate.weighted_judge_score),
    qualityChecklist:
      task.checklist_json ?? metadata.qualityChecklist ?? null,
    promptBundle: candidate.prompt_bundle_json ?? {},
    candidateOutput: candidate.assistant_output_json ?? {},
    llmFirstPass: task.llm_first_pass_json ?? null,
  };
}

function buildPairCandidateSummary(candidate: CandidateRow): RawRecord {
  const metadata = asObject(candidate.metadata_json);

  return {
    rowId: candidate.row_key,
    source: metadata.source ?? null,
    verdict: metadata.verdict ?? null,
    llmError: metadata.llmError ?? null,
    scores: metadata.scores ?? null,
    candidateOutput: candidate.assistant_output_json ?? {},
  };
}

function buildPairRawFromRows(
  task: ReviewTaskRow,
  pair: PairRow,
  chosen: CandidateRow,
  rejected: CandidateRow,
): RawRecord {
  const promptBundle = asObject(pair.prompt_bundle_json);

  return {
    reviewId: task.review_uid ?? `pair:${pair.pair_key ?? pair.id}`,
    reviewType: "preference_pair",
    status: task.status ?? (task.current_decision ? "reviewed" : "pending"),
    decision: task.current_decision,
    reviewer: task.current_reviewer,
    reviewedAt: isoString(task.current_reviewed_at),
    notes: task.current_notes ?? "",
    reviewRequired: task.review_required ?? true,
    selectionReasons: task.selection_reasons_json ?? [],
    selectionMetrics: task.selection_metrics_json ?? {},
    pairId: pair.pair_key,
    priority: task.priority,
    queueReason: task.queue_reason,
    qualityChecklist: task.checklist_json ?? null,
    candidatePair: {
      pairId: pair.pair_key,
      grouping: {
        strategy: pair.grouping_strategy,
        key: pair.grouping_key,
      },
      promptBundle,
      chosenCandidate: buildPairCandidateSummary(chosen),
      rejectedCandidate: buildPairCandidateSummary(rejected),
      pairReason: pair.pair_reason_json ?? [],
      pairConfidence: asNumber(pair.pair_confidence),
      weightedGap: asNumber(pair.weighted_gap),
      status: pair.pair_decision ?? "candidate",
      pairDecision: pair.pair_decision,
      preferenceStrength: asNumber(pair.preference_strength),
      judge: pair.judge_result_json ?? null,
    },
    llmFirstPass: task.llm_first_pass_json ?? null,
  };
}

export async function getHumanReviewRawDataFromDb(): Promise<{
  sft: RawRecord[];
  pair: RawRecord[];
}> {
  await seedReviewTasksFromFiles();

  const [taskResult, candidateResult, pairResult] = await Promise.all([
    dbQuery<ReviewTaskRow>("SELECT * FROM npc_review_task ORDER BY created_at ASC, id ASC"),
    dbQuery<CandidateRow>("SELECT * FROM npc_sft_candidate"),
    dbQuery<PairRow>("SELECT * FROM npc_preference_pair"),
  ]);
  const candidateMap = new Map(candidateResult.rows.map((row) => [row.id, row] as const));
  const pairMap = new Map(pairResult.rows.map((row) => [row.id, row] as const));

  const sft: RawRecord[] = [];
  const pair: RawRecord[] = [];

  for (const task of taskResult.rows) {
    if (task.review_kind === "sft" && task.sft_candidate_id) {
      const candidate = candidateMap.get(task.sft_candidate_id);
      if (candidate) {
        sft.push(buildSftRawFromRows(task, candidate));
      }
      continue;
    }

    if (task.review_kind === "pair" && task.preference_pair_id) {
      const pairRow = pairMap.get(task.preference_pair_id);
      if (!pairRow || !pairRow.chosen_candidate_id || !pairRow.rejected_candidate_id) {
        continue;
      }
      const chosen = candidateMap.get(pairRow.chosen_candidate_id);
      const rejected = candidateMap.get(pairRow.rejected_candidate_id);
      if (chosen && rejected) {
        pair.push(buildPairRawFromRows(task, pairRow, chosen, rejected));
      }
    }
  }

  return { sft, pair };
}

export async function updateReviewDecisionInDb(input: {
  kind: ReviewKind;
  reviewId: string;
  decision: SftReviewDecision | PairReviewDecision;
  reviewer?: string | null;
  notes?: string;
}): Promise<RawRecord> {
  await seedReviewTasksFromFiles();

  await withDbTransaction(async (client) => {
    const taskResult = await client.query<ReviewTaskRow>(
      "SELECT * FROM npc_review_task WHERE review_uid = $1 AND review_kind = $2 ORDER BY id DESC LIMIT 1",
      [input.reviewId, input.kind],
    );
    const task = taskResult.rows[0];

    if (!task) {
      throw new Error(`검수 항목을 찾지 못했습니다: ${input.reviewId}`);
    }

    const nextStatus = input.decision ? "reviewed" : "pending";
    const reviewedAt = input.decision ? new Date().toISOString() : null;

    await client.query(
      `UPDATE npc_review_task
          SET current_decision = $1,
              current_reviewer = $2,
              current_notes = $3,
              current_reviewed_at = $4,
              status = $5,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $6`,
      [
        input.decision,
        input.reviewer?.trim() || null,
        input.notes ?? "",
        reviewedAt,
        nextStatus,
        task.id,
      ],
    );

    if (input.decision) {
      await client.query(
        `INSERT INTO npc_review_decision_event (
            review_task_id,
            decision,
            status_after,
            reviewer,
            notes,
            checklist_json,
            decided_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          task.id,
          input.decision,
          nextStatus,
          input.reviewer?.trim() || null,
          input.notes ?? "",
          jsonParam(task.checklist_json ?? null),
          reviewedAt,
        ],
      );
    }
  });

  const dashboard = await getHumanReviewRawDataFromDb();
  const nextItem =
    input.kind === "sft"
      ? dashboard.sft.find((entry) => asString(entry.reviewId) === input.reviewId)
      : dashboard.pair.find((entry) => asString(entry.reviewId) === input.reviewId);

  if (!nextItem) {
    throw new Error(`업데이트된 검수 항목을 찾지 못했습니다: ${input.reviewId}`);
  }

  return nextItem;
}

export async function getPendingReviewCountsFromDb() {
  await seedReviewTasksFromFiles();

  const result = await dbQuery<{
    review_kind: string | null;
    pending_count: string;
  }>(
    `SELECT review_kind, COUNT(*)::text AS pending_count
       FROM npc_review_task
      WHERE current_decision IS NULL
      GROUP BY review_kind`,
  );

  let sft = 0;
  let pair = 0;
  for (const row of result.rows) {
    if (row.review_kind === "sft") {
      sft = Number(row.pending_count);
    } else if (row.review_kind === "pair") {
      pair = Number(row.pending_count);
    }
  }

  return {
    sft,
    pair,
    total: sft + pair,
  };
}

export async function getLatestReviewUpdatedAtFromDb() {
  await seedReviewTasksFromFiles();

  const result = await dbQuery<{ updated_at: Date | string | null }>(
    "SELECT MAX(current_reviewed_at) AS updated_at FROM npc_review_task",
  );
  return isoString(result.rows[0]?.updated_at ?? null);
}

export async function exportReviewQueueFilesFromDb() {
  const data = await getHumanReviewRawDataFromDb();
  await Promise.all([
    writeReviewQueueFile("sft", data.sft),
    writeReviewQueueFile("pair", data.pair),
  ]);
}

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

export async function getReviewFinalizeStatusFromDb(): Promise<ReviewFinalizeStatusView> {
  const pending = await getPendingReviewCountsFromDb();
  const latestReviewUpdatedAt = await getLatestReviewUpdatedAtFromDb();
  await ensureSnapshotsSeededFromFiles();

  const [latestRun, activeSft, activePreference] = await Promise.all([
    getLatestFinalizeRunFromDb(),
    getActiveSnapshotSummary("sft"),
    getActiveSnapshotSummary("preference"),
  ]);
  const metrics = asObject(latestRun?.metrics_json);
  const durations = asObject(metrics.durations);
  const outputs = asObject(metrics.outputs);
  const latestSnapshotAt =
    [activeSft?.generatedAt, activePreference?.generatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const canFinalize =
    pending.total === 0 &&
    latestRun?.state !== "running" &&
    (!latestSnapshotAt ||
      !latestReviewUpdatedAt ||
      Date.parse(latestSnapshotAt) < Date.parse(latestReviewUpdatedAt));

  return {
    state:
      latestRun?.run_kind === "finalize"
        ? ((latestRun.state as ReviewFinalizeStatusView["state"]) ?? "idle")
        : "idle",
    canFinalize,
    pending,
    currentStep:
      latestRun?.run_kind === "finalize"
        ? ((latestRun.current_step as ReviewFinalizeStatusView["currentStep"]) ?? null)
        : null,
    message: latestRun?.run_kind === "finalize" ? latestRun.message : null,
    startedAt: isoString(latestRun?.started_at ?? null),
    finishedAt: isoString(latestRun?.finished_at ?? null),
    updatedAt: isoString(latestRun?.updated_at ?? null),
    durations: {
      sftMs: asNumber(durations.sftMs),
      preferenceMs: asNumber(durations.preferenceMs),
      totalMs: asNumber(durations.totalMs),
    },
    outputs: {
      sft: asString(outputs.sft),
      preference: asString(outputs.preference),
    },
  };
}

export interface TrainingRunSpecRecord {
  runId: string;
  kind: ReviewTrainingKind;
  trainingBackend: ReviewTrainingBackend;
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

export async function getSourceTaskKeysFromDb() {
  const raw = await getHumanReviewRawDataFromDb();
  return {
    sftRowKeys: new Set(
      raw.sft
        .map((entry) => asString(entry.sourceRowId))
        .filter((entry): entry is string => Boolean(entry)),
    ),
    pairKeys: new Set(
      raw.pair
        .map((entry) => asString(entry.pairId))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  };
}

export async function upsertEpisodeExportToDb(params: {
  worldState: RawRecord;
  turns: RawRecord[];
  exportedAt: string;
  exportPaths: {
    richTrace: string;
    sft: string;
    review: string;
  };
}) {
  await withDbTransaction(async (client) => {
    const episodeUid = asString(params.worldState.episodeId);
    if (!episodeUid) {
      return;
    }

    const existingEpisodeResult = await client.query<{ id: number }>(
      "SELECT id FROM npc_episode WHERE episode_uid = $1 ORDER BY id DESC LIMIT 1",
      [episodeUid],
    );
    let episodeId = existingEpisodeResult.rows[0]?.id ?? null;

    if (episodeId) {
      await client.query(
        `UPDATE npc_episode
            SET scenario_id = $2,
                started_at = $3,
                ended_at = $4,
                exported_at = $5,
                resolved = $6,
                resolution_type = $7,
                sacrificed_npc_id = $8,
                sacrificed_label = $9,
                final_round = $10,
                final_state_json = $11,
                export_paths_json = $12,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
          episodeId,
          asString(params.worldState.scenarioId),
          asString(params.worldState.startedAt),
          asString(params.worldState.endedAt),
          params.exportedAt,
          asBoolean(asObject(params.worldState.resolution).resolved),
          asString(asObject(params.worldState.resolution).resolutionType),
          asString(asObject(params.worldState.resolution).sacrificedNpcId),
          asString(asObject(params.worldState.resolution).sacrificedLabel),
          asNumber(asObject(params.worldState.round).currentRound),
          jsonParam(params.worldState),
          jsonParam(params.exportPaths),
        ],
      );
      await client.query("DELETE FROM npc_episode_turn WHERE episode_id = $1", [episodeId]);
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO npc_episode (
            episode_uid,
            scenario_id,
            started_at,
            ended_at,
            exported_at,
            resolved,
            resolution_type,
            sacrificed_npc_id,
            sacrificed_label,
            final_round,
            final_state_json,
            export_paths_json,
            source_file_path
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING id`,
        [
          episodeUid,
          asString(params.worldState.scenarioId),
          asString(params.worldState.startedAt),
          asString(params.worldState.endedAt),
          params.exportedAt,
          asBoolean(asObject(params.worldState.resolution).resolved),
          asString(asObject(params.worldState.resolution).resolutionType),
          asString(asObject(params.worldState.resolution).sacrificedNpcId),
          asString(asObject(params.worldState.resolution).sacrificedLabel),
          asNumber(asObject(params.worldState.round).currentRound),
          jsonParam(params.worldState),
          jsonParam(params.exportPaths),
          params.exportPaths.richTrace,
        ],
      );
      episodeId = inserted.rows[0].id;
    }

    for (const turn of params.turns) {
      await client.query(
        `INSERT INTO npc_episode_turn (
            episode_id,
            turn_index,
            round_before,
            round_after,
            npc_id,
            target_npc_id,
            input_mode,
            action_name,
            raw_player_text,
            normalized_input_summary,
            prompt_context_summary,
            prompt_bundle_json,
            assistant_output_json,
            state_impact_json,
            provider_mode,
            interaction_model,
            fallback_model,
            reply_adapter_mode,
            reply_adapter_applied,
            deterministic_fallback_used,
            generation_meta_json
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
          )`,
        [
          episodeId,
          asNumber(turn.turnIndex),
          asNumber(turn.roundBefore),
          asNumber(turn.roundAfter),
          asString(turn.npcId),
          asString(turn.targetNpcId),
          asString(turn.inputMode),
          asString(turn.action),
          asString(turn.rawPlayerText),
          asString(turn.normalizedInputSummary),
          asString(turn.llmPromptContextSummary),
          jsonParam({
            episodeId,
            scenarioId: asString(params.worldState.scenarioId),
            turnIndex: asNumber(turn.turnIndex),
            npcId: asString(turn.npcId),
            targetNpcId: asString(turn.targetNpcId),
            inputMode: asString(turn.inputMode),
            playerText: asString(turn.rawPlayerText),
            normalizedInputSummary: asString(turn.normalizedInputSummary),
            promptContextSummary: asString(turn.llmPromptContextSummary),
            retrievedMemories: turn.retrievedMemories ?? [],
            retrievedKnowledge: turn.retrievedKnowledge ?? [],
          }),
          jsonParam({
            replyText: asString(turn.modelReplyText),
            emotion: turn.emotion ?? null,
            intent: turn.intent ?? null,
            candidateActions: turn.candidateActions ?? [],
            selectedAction: turn.selectedAction ?? null,
            structuredImpact: turn.structuredImpact ?? null,
          }),
          jsonParam({
            relationshipDelta: turn.relationshipDelta ?? null,
            pressureChanges: turn.pressureChanges ?? [],
            leaderBefore: turn.leaderBefore ?? null,
            leaderAfter: turn.leaderAfter ?? null,
            resolutionAfter: turn.resolutionAfter ?? null,
          }),
          null,
          null,
          null,
          null,
          null,
          false,
          jsonParam(null),
        ],
      );
    }
  });
}

export async function loadPipelineCompletedRawData() {
  const [judgedSftRaw, judgedPairRaw] = await Promise.all([
    readJsonlFile(PIPELINE_FILES.judgedSft),
    readJsonlFile(PIPELINE_FILES.judgedPairs),
  ]);

  return {
    judgedSftRaw,
    judgedPairRaw,
  };
}
