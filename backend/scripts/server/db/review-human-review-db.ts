import type {
  PairReviewDecision,
  ReviewKind,
  SftReviewDecision,
} from "@backend-contracts/review";
import { dbQuery, withDbTransaction } from "@server/db/postgres";
import {
  type CandidateRow,
  type PairRow,
  type RawRecord,
  type ReviewTaskRow,
  asNumber,
  asObject,
  asString,
  isoString,
  jsonParam,
  writeReviewQueueFile,
} from "@server/db/review-db-core";
import { seedReviewTasksFromFiles } from "@server/db/review-queue-db";

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
