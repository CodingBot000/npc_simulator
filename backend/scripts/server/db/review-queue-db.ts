import type { PoolClient } from "pg";
import type { ReviewKind } from "@backend-contracts/review";
import { withDbTransaction } from "@server/db/postgres";
import {
  LLM_FIRST_PASS_FILES,
  REVIEW_FILES,
  type RawRecord,
  asBoolean,
  asNumber,
  asObject,
  asString,
  fallbackKey,
  findCandidateIdByRowKey,
  findPairIdByKey,
  getCount,
  hashValue,
  jsonParam,
  readJsonArrayFile,
  readPrimaryJsonOrJsonl,
} from "@server/db/review-db-core";

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

export async function seedReviewTasksFromFiles() {
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
