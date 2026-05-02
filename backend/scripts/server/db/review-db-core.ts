import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type { ReviewKind } from "@backend-contracts/review";
import { DATA_DIR } from "@server/config";
import { dbQuery } from "@server/db/postgres";

export type RawRecord = Record<string, unknown>;

export const REVIEW_DIR = path.join(DATA_DIR, "review", "live");
export const REVIEW_FILES = {
  sft: {
    json: path.join(REVIEW_DIR, "human_review_sft_queue.json"),
    jsonl: path.join(REVIEW_DIR, "human_review_sft_queue.jsonl"),
  },
  pair: {
    json: path.join(REVIEW_DIR, "human_review_pair_queue.json"),
    jsonl: path.join(REVIEW_DIR, "human_review_pair_queue.jsonl"),
  },
} as const;

export const LLM_FIRST_PASS_FILES = {
  sft: {
    json: path.join(REVIEW_DIR, "llm_first_pass_sft_queue.json"),
    jsonl: path.join(REVIEW_DIR, "llm_first_pass_sft_queue.jsonl"),
  },
  pair: {
    json: path.join(REVIEW_DIR, "llm_first_pass_pair_queue.json"),
    jsonl: path.join(REVIEW_DIR, "llm_first_pass_pair_queue.jsonl"),
  },
} as const;

export const PIPELINE_FILES = {
  judgedSft: path.join(DATA_DIR, "evals", "judged", "judged-review-live.jsonl"),
  judgedPairs: path.join(
    DATA_DIR,
    "evals",
    "preference",
    "candidate_pairs_live_gap1.jsonl",
  ),
} as const;

export const SFT_MANIFEST_PATH = path.join(DATA_DIR, "train", "sft", "live", "manifest.json");
export const SFT_TRAIN_PATH = path.join(DATA_DIR, "train", "sft", "live", "final_sft_train.jsonl");
export const SFT_DEV_PATH = path.join(DATA_DIR, "train", "sft", "live", "final_sft_dev.jsonl");
export const PREFERENCE_MANIFEST_PATH = path.join(
  DATA_DIR,
  "train",
  "preference",
  "live",
  "manifest.json",
);
export const PREFERENCE_PAIRS_PATH = path.join(
  DATA_DIR,
  "train",
  "preference",
  "live",
  "final_preference_pairs.jsonl",
);
export const LEGACY_TRAIN_RUNS_DIR = path.join(DATA_DIR, "train", "runs");

export interface CandidateRow {
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

export interface PairRow {
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

export interface ReviewTaskRow {
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

export interface SnapshotRow {
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

export interface TrainingRunRow {
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

export function asObject(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function isoString(value: unknown): string | null {
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

export function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function jsonParam(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

export function fallbackKey(prefix: string, value: unknown) {
  return `${prefix}:${hashValue(value).slice(0, 16)}`;
}

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
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

export async function readJsonArrayFile(filePath: string): Promise<RawRecord[]> {
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

export async function readJsonlFile(filePath: string): Promise<RawRecord[]> {
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

export async function readPrimaryJsonOrJsonl(
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

export async function writeReviewQueueFile(kind: ReviewKind, items: RawRecord[]) {
  const { json, jsonl } = REVIEW_FILES[kind];
  await fs.mkdir(path.dirname(json), { recursive: true });
  await fs.writeFile(json, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  const payload = items.map((entry) => JSON.stringify(entry)).join("\n");
  await fs.writeFile(jsonl, payload ? `${payload}\n` : "", "utf8");
}

export async function fingerprintFiles(filePaths: string[]) {
  const hash = createHash("sha256");

  for (const filePath of filePaths) {
    hash.update(filePath);
    hash.update("\n");
    hash.update(await fs.readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

export async function getCount(tableName: string) {
  const result = await dbQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count ?? "0");
}

export async function findCandidateIdByRowKey(
  client: PoolClient,
  rowKey: string,
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_sft_candidate WHERE row_key = $1 ORDER BY id DESC LIMIT 1",
    [rowKey],
  );
  return result.rows[0]?.id ?? null;
}

export async function findPairIdByKey(client: PoolClient, pairKey: string): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    "SELECT id FROM npc_preference_pair WHERE pair_key = $1 ORDER BY id DESC LIMIT 1",
    [pairKey],
  );
  return result.rows[0]?.id ?? null;
}
