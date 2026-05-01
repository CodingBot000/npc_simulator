import type { PoolClient } from "pg";
import type {
  PairReviewDecision,
  PairReviewItemView,
  ReviewFinalizeStatusView,
  ReviewKind,
  SftReviewDecision,
  SftReviewItemView,
} from "@backend-contracts/review";
import { dbQuery, withDbTransaction } from "@server/db/postgres";
import {
  ensureSnapshotsSeededFromFiles,
  getActiveSnapshotSummary,
} from "@server/db/review-snapshot-db";
import {
  getLatestFinalizeRunFromDb,
} from "@server/db/review-training-run-db";
import {
  LLM_FIRST_PASS_FILES,
  PIPELINE_FILES,
  REVIEW_FILES,
  type CandidateRow,
  type PairRow,
  type RawRecord,
  type ReviewTaskRow,
  asBoolean,
  asNumber,
  asObject,
  asString,
  fallbackKey,
  findCandidateIdByRowKey,
  findPairIdByKey,
  getCount,
  hashValue,
  isoString,
  jsonParam,
  readJsonArrayFile,
  readJsonlFile,
  readPrimaryJsonOrJsonl,
  writeReviewQueueFile,
} from "@server/db/review-db-core";
export {
  ensureSnapshotsSeededFromFiles,
  getActiveSnapshotSummary,
  syncSnapshotsFromFilesToDb,
} from "@server/db/review-snapshot-db";
export { upsertEpisodeExportToDb } from "@server/db/review-episode-export-db";
export {
  appendTrainingRunEventInDb,
  appendTrainingRunLogChunkInDb,
  createFinalizeRunInDb,
  createTrainingRunInDb,
  getLatestFinalizeRunFromDb,
  getLatestSuccessfulTrainingRun,
  getTrainingRunByFingerprint,
  getTrainingRunSpecFromDb,
  getTrainingRunViewsFromDb,
  getTrainingStatusFromDb,
  listTrainingRunsFromDb,
  registerTrainingArtifactInDb,
  updateFinalizeRunInDb,
  updateTrainingRunRemoteDeploymentInDb,
  updateTrainingRunStateInDb,
} from "@server/db/review-training-run-db";
export type { TrainingRunSpecRecord } from "@server/db/review-training-run-db";

let reviewSeedPromise: Promise<void> | null = null;

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
