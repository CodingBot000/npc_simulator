import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  parseCliArgs,
  printUsage,
} from "./_episode-cli-helpers.mjs";
import {
  buildCanonicalRowKey,
  buildSourceExportPath,
  buildStableNumber,
  buildStrategyLookup,
  inferStrategyLabel,
  loadPlainRecords,
} from "./_curation-helpers.mjs";
import {
  loadNormalizedRows,
  rankJudgedRecord,
  writeJsonLines,
  writeSummaryJson,
} from "./_quality-judge-helpers.mjs";

const DEFAULT_SFT_REVIEW_INPUT = "data/evals/judged/judged-review-live.jsonl";
const DEFAULT_PAIR_INPUT = "data/evals/preference/candidate_pairs_live_gap1.jsonl";
const DEFAULT_OUTPUT_DIR = "data/review/live";

function usage() {
  printUsage([
    "Usage: node scripts/prepare-human-review.mjs [options]",
    "",
    "Options:",
    `  --review-input <path[,path]>   judged SFT rows (default: ${DEFAULT_SFT_REVIEW_INPUT})`,
    `  --pairs-input <path[,path]>    preference candidate pairs (default: ${DEFAULT_PAIR_INPUT})`,
    "  --collector-input <path[,path]> collector summary files for strategy lookup",
    "  --sft-review-percent <n>       bottom percentile routed to human review (default: 30)",
    "  --pair-review-percent <n>      bottom percentile routed to human review (default: 30)",
    "  --sft-low-confidence <n>       confidence threshold for forced human review (default: 3)",
    "  --pair-low-confidence <n>      confidence threshold for forced human review (default: 2)",
    "  --pair-small-gap <n>           weighted gap threshold for forced human review (default: 2)",
    "  --sft-top-audit-percent <n>    top percentile audit sample (default: 5)",
    "  --pair-top-audit-percent <n>   top percentile audit sample (default: 5)",
    `  --output-dir <path>            output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    "  --help                         show this message",
  ]);
}

async function loadOptionalNormalizedRows(input, defaultPatterns) {
  try {
    return await loadNormalizedRows({
      input,
      defaultPatterns,
    });
  } catch (error) {
    if (error instanceof Error && /ENOENT/u.test(error.message)) {
      return { files: [], rows: [] };
    }

    throw error;
  }
}

async function loadOptionalPlainRecords(input, defaultPatterns) {
  try {
    return await loadPlainRecords(input, defaultPatterns);
  } catch (error) {
    if (error instanceof Error && /ENOENT/u.test(error.message)) {
      return { files: [], records: [] };
    }

    throw error;
  }
}

function clampPercent(value, fallbackValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallbackValue;
  }

  return Math.max(0, Math.min(100, numeric));
}

function countForPercent(total, percent) {
  if (!total || percent <= 0) {
    return 0;
  }

  return Math.min(total, Math.ceil((total * percent) / 100));
}

function addReason(reasonMap, key, reason) {
  const reasons = reasonMap.get(key) ?? new Set();
  reasons.add(reason);
  reasonMap.set(key, reasons);
}

function buildReasonBreakdown(selections) {
  return selections.reduce((counts, selection) => {
    for (const reason of selection.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }

    return counts;
  }, {});
}

function sortAscendingByMetric(items, getMetric, getKey) {
  return [...items].sort((left, right) => {
    const metricDelta = getMetric(left) - getMetric(right);
    if (metricDelta !== 0) {
      return metricDelta;
    }

    return buildStableNumber(getKey(left)) - buildStableNumber(getKey(right));
  });
}

function sortDescendingByMetric(items, getMetric, getKey) {
  return [...items].sort((left, right) => {
    const metricDelta = getMetric(right) - getMetric(left);
    if (metricDelta !== 0) {
      return metricDelta;
    }

    return buildStableNumber(getKey(left)) - buildStableNumber(getKey(right));
  });
}

function buildSftSelections(rows, options) {
  const candidates = rows.map((record) => {
    const ranking = rankJudgedRecord(record);

    return {
      key: buildCanonicalRowKey(record),
      record,
      ranking,
      confidence: ranking.finalJudge.confidence ?? 3,
      llmError: record.judge?.llmError ?? null,
    };
  });
  const reasonMap = new Map();
  const bottomCount = countForPercent(candidates.length, options.reviewPercent);
  const topAuditCount = countForPercent(candidates.length, options.topAuditPercent);

  for (const candidate of sortAscendingByMetric(
    candidates,
    (item) => item.ranking.weightedScore,
    (item) => item.key,
  ).slice(0, bottomCount)) {
    addReason(reasonMap, candidate.key, `bottom_${options.reviewPercent}_percent`);
  }

  for (const candidate of candidates) {
    if (candidate.confidence <= options.lowConfidenceThreshold) {
      addReason(reasonMap, candidate.key, "low_confidence");
    }
    if (candidate.llmError) {
      addReason(reasonMap, candidate.key, "llm_error_fallback");
    }
  }

  for (const candidate of sortDescendingByMetric(
    candidates,
    (item) => item.ranking.weightedScore,
    (item) => item.key,
  ).slice(0, topAuditCount)) {
    addReason(reasonMap, candidate.key, `top_${options.topAuditPercent}_percent_audit`);
  }

  return candidates
    .filter((candidate) => reasonMap.has(candidate.key))
    .map((candidate) => ({
      ...candidate,
      reasons: [...(reasonMap.get(candidate.key) ?? new Set())],
    }));
}

function derivePairConfidence(pair) {
  const judgeConfidence = Number(pair?.judge?.final?.confidence);
  if (Number.isFinite(judgeConfidence)) {
    return judgeConfidence;
  }

  if (typeof pair.pairConfidence === "number" && Number.isFinite(pair.pairConfidence)) {
    return pair.pairConfidence;
  }

  const chosenConfidence = Number(pair.chosenCandidate?.scores?.confidence);
  const rejectedConfidence = Number(pair.rejectedCandidate?.scores?.confidence);

  if (Number.isFinite(chosenConfidence) && Number.isFinite(rejectedConfidence)) {
    return Math.min(chosenConfidence, rejectedConfidence);
  }

  return 3;
}

function derivePreferenceStrength(pair) {
  const judgeStrength = Number(pair?.judge?.final?.preferenceStrength);
  if (Number.isFinite(judgeStrength)) {
    return judgeStrength;
  }

  const weightedGap =
    typeof pair?.weightedGap === "number" && Number.isFinite(pair.weightedGap)
      ? pair.weightedGap
      : 0;

  if (weightedGap >= 6) {
    return 5;
  }
  if (weightedGap >= 4) {
    return 4;
  }
  if (weightedGap >= 2) {
    return 3;
  }
  if (weightedGap >= 1) {
    return 2;
  }

  return 1;
}

function buildPairSelections(pairs, options) {
  const candidates = pairs.map((pair) => {
    const pairId = typeof pair.pairId === "string" ? pair.pairId : null;

    return {
      key: pairId,
      pair,
      weightedGap:
        typeof pair.weightedGap === "number" && Number.isFinite(pair.weightedGap)
          ? pair.weightedGap
          : 0,
      preferenceStrength: derivePreferenceStrength(pair),
      pairConfidence: derivePairConfidence(pair),
      llmError:
        pair.judge?.llmError ??
        pair.chosenCandidate?.llmError ??
        pair.rejectedCandidate?.llmError ??
        null,
      pairDecision:
        typeof pair?.judge?.final?.decision === "string"
          ? pair.judge.final.decision
          : "review",
    };
  }).filter((candidate) => candidate.key);
  const reasonMap = new Map();
  const bottomCount = countForPercent(candidates.length, options.reviewPercent);
  const topAuditCount = countForPercent(candidates.length, options.topAuditPercent);

  for (const candidate of sortAscendingByMetric(
    candidates,
    (item) => item.preferenceStrength,
    (item) => item.key,
  ).slice(0, bottomCount)) {
    addReason(reasonMap, candidate.key, `bottom_${options.reviewPercent}_percent`);
  }

  for (const candidate of candidates) {
    if (candidate.pairDecision === "review") {
      addReason(reasonMap, candidate.key, "pair_judge_review");
    }
    if (candidate.pairConfidence <= options.lowConfidenceThreshold) {
      addReason(reasonMap, candidate.key, "low_confidence");
    }
    if (candidate.weightedGap <= options.smallGapThreshold) {
      addReason(reasonMap, candidate.key, "small_gap");
    }
    if (candidate.llmError) {
      addReason(reasonMap, candidate.key, "llm_error_fallback");
    }
  }

  for (const candidate of sortDescendingByMetric(
    candidates,
    (item) => item.preferenceStrength,
    (item) => item.key,
  ).slice(0, topAuditCount)) {
    addReason(reasonMap, candidate.key, `top_${options.topAuditPercent}_percent_audit`);
  }

  return candidates
    .filter((candidate) => reasonMap.has(candidate.key))
    .map((candidate) => ({
      ...candidate,
      reasons: [...(reasonMap.get(candidate.key) ?? new Set())],
    }));
}

function buildPriority(reasons) {
  if (
    reasons.includes("low_confidence") ||
    reasons.includes("small_gap") ||
    reasons.includes("llm_error_fallback") ||
    reasons.some((reason) => reason.startsWith("bottom_"))
  ) {
    return "high";
  }

  return "medium";
}

function buildSftReviewRecord(selection, strategyLabel) {
  const record = selection.record;

  return {
    reviewId: `sft:llm_triage:${record.rowId}`,
    reviewType: "sft_row",
    bucket: selection.reasons.some((reason) => reason.startsWith("top_"))
      ? "top_audit"
      : "llm_triage",
    priority: buildPriority(selection.reasons),
    status: "pending",
    decision: null,
    reviewer: null,
    reviewedAt: null,
    notes: "",
    reviewRequired: true,
    selectionReasons: selection.reasons,
    selectionMetrics: {
      weightedJudgeScore: selection.ranking.weightedScore,
      confidence: selection.confidence,
      verdict: selection.ranking.finalJudge.verdict,
      llmError: selection.llmError,
    },
    sourceRowId: record.rowId,
    canonicalRowKey: buildCanonicalRowKey(record),
    queueReason: selection.reasons.join("|"),
    source: {
      episodeId: record.promptBundle.episodeId,
      scenarioId: record.promptBundle.scenarioId,
      turnIndex: record.promptBundle.turnIndex,
      npcId: record.promptBundle.npcId,
      targetNpcId: record.promptBundle.targetNpcId,
      strategyLabel,
      exportPath: buildSourceExportPath(record),
      sourceLabel: record.source.label,
    },
    filter: record.filter,
    judge: record.judge?.final ?? null,
    weightedJudgeScore: selection.ranking.weightedScore,
    qualityChecklist: {
      responseQuality: null,
      structuredImpactQuality: null,
      groundingQuality: null,
      personaConsistency: null,
      inspectorUsefulness: null,
      verdict: null,
      reasons: [],
      issues: [],
    },
    promptBundle: record.promptBundle,
    candidateOutput: record.candidateOutput,
    metadata: record.metadata,
    rubricHints: record.rubricHints,
  };
}

function buildPairReviewRecord(selection) {
  const pair = selection.pair;
  const chosenConfidence = Number(pair.chosenCandidate?.scores?.confidence);
  const rejectedConfidence = Number(pair.rejectedCandidate?.scores?.confidence);

  return {
    reviewId: `pair:${pair.pairId}`,
    reviewType: "preference_pair",
    status: "pending",
    decision: null,
    reviewer: null,
    reviewedAt: null,
    notes: "",
    reviewRequired: true,
    selectionReasons: selection.reasons,
    selectionMetrics: {
      weightedGap: selection.weightedGap,
      preferenceStrength: selection.preferenceStrength,
      pairConfidence: selection.pairConfidence,
      chosenConfidence: Number.isFinite(chosenConfidence) ? chosenConfidence : null,
      rejectedConfidence: Number.isFinite(rejectedConfidence) ? rejectedConfidence : null,
      pairDecision: selection.pairDecision,
      llmError: selection.llmError,
    },
    pairId: pair.pairId,
    priority: buildPriority(selection.reasons),
    queueReason: selection.reasons.join("|"),
    qualityChecklist: {
      preferenceStrength: null,
      structuredImpactGap: null,
      groundingGap: null,
      personaGap: null,
      safeForTraining: null,
      issues: [],
    },
    candidatePair: pair,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const reviewInput = getStringOption(options, "review-input", DEFAULT_SFT_REVIEW_INPUT);
  const pairsInput = getStringOption(options, "pairs-input", DEFAULT_PAIR_INPUT);
  const collectorInput = getStringOption(options, "collector-input", null);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const sftReviewPercent = clampPercent(
    getNumberOption(options, "sft-review-percent", 30),
    30,
  );
  const pairReviewPercent = clampPercent(
    getNumberOption(options, "pair-review-percent", 30),
    30,
  );
  const sftLowConfidence = getNumberOption(options, "sft-low-confidence", 3);
  const pairLowConfidence = getNumberOption(options, "pair-low-confidence", 2);
  const pairSmallGap = getNumberOption(options, "pair-small-gap", 2);
  const sftTopAuditPercent = clampPercent(
    getNumberOption(options, "sft-top-audit-percent", 5),
    5,
  );
  const pairTopAuditPercent = clampPercent(
    getNumberOption(options, "pair-top-audit-percent", 5),
    5,
  );

  const [reviewRowsResult, pairResult] = await Promise.all([
    loadOptionalNormalizedRows(reviewInput, [DEFAULT_SFT_REVIEW_INPUT]),
    loadOptionalPlainRecords(pairsInput, [DEFAULT_PAIR_INPUT]),
  ]);
  const strategyLookup = await buildStrategyLookup(collectorInput).catch(() => null);
  const sftSelections = buildSftSelections(reviewRowsResult.rows, {
    reviewPercent: sftReviewPercent,
    lowConfidenceThreshold: sftLowConfidence,
    topAuditPercent: sftTopAuditPercent,
  });
  const pairSelections = buildPairSelections(
    pairResult.records.filter(
      (record) => record && typeof record === "object" && typeof record.pairId === "string",
    ),
    {
      reviewPercent: pairReviewPercent,
      lowConfidenceThreshold: pairLowConfidence,
      smallGapThreshold: pairSmallGap,
      topAuditPercent: pairTopAuditPercent,
    },
  );
  const sftQueue = sftSelections.map((selection) =>
    buildSftReviewRecord(
      selection,
      inferStrategyLabel(selection.record, strategyLookup),
    ),
  );
  const pairQueue = pairSelections.map((selection) => buildPairReviewRecord(selection));

  const sftOutput = path.join(outputDir, "human_review_sft_queue.jsonl");
  const pairOutput = path.join(outputDir, "human_review_pair_queue.jsonl");
  const sftPrettyOutput = path.join(outputDir, "human_review_sft_queue.json");
  const pairPrettyOutput = path.join(outputDir, "human_review_pair_queue.json");
  const summaryOutput = path.join(outputDir, "human_review_summary.json");

  await writeJsonLines(sftOutput, sftQueue);
  await writeJsonLines(pairOutput, pairQueue);
  await writeSummaryJson(sftPrettyOutput, sftQueue);
  await writeSummaryJson(pairPrettyOutput, pairQueue);
  await writeSummaryJson(summaryOutput, {
    generatedAt: new Date().toISOString(),
    inputFiles: {
      review: reviewRowsResult.files,
      pairs: pairResult.files,
      collector: strategyLookup?.files ?? [],
    },
    thresholds: {
      sftReviewPercent,
      pairReviewPercent,
      sftLowConfidence,
      pairLowConfidence,
      pairSmallGap,
      sftTopAuditPercent,
      pairTopAuditPercent,
    },
    counts: {
      judgedSftRows: reviewRowsResult.rows.length,
      selectedSftRows: sftQueue.length,
      pairCandidates: pairResult.records.filter(
        (record) => record && typeof record === "object" && typeof record.pairId === "string",
      ).length,
      selectedPairRows: pairQueue.length,
    },
    selectionReasons: {
      sft: buildReasonBreakdown(sftSelections),
      pair: buildReasonBreakdown(pairSelections),
    },
    outputFiles: {
      sft: sftOutput,
      sftPretty: sftPrettyOutput,
      pairs: pairOutput,
      pairsPretty: pairPrettyOutput,
      summary: summaryOutput,
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
