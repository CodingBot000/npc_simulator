import path from "node:path";
import {
  getBooleanOption,
  getNumberOption,
  getStringOption,
  parseCliArgs,
  printUsage,
} from "./_episode-cli-helpers.mjs";
import {
  assignSplit,
  average,
  buildAssistantPayload,
  buildCanonicalRowKey,
  buildInputPayload,
  buildSourceExportPath,
  buildStrategyLookup,
  inferStrategyLabel,
  loadPlainRecords,
  loadSourceEntry,
  normalizeHumanDecision,
} from "./_curation-helpers.mjs";
import { closeDbPool, loadSftReviewRecordsFromDb } from "./_db-runtime.mjs";
import {
  loadNormalizedRows,
  rankJudgedRecord,
  writeJsonLines,
  writeSummaryJson,
} from "./_quality-judge-helpers.mjs";

const DEFAULT_INSTRUCTION =
  "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화와 구조화된 추론 JSON을 생성한다.";
const DEFAULT_KEEP_INPUT = "data/evals/filtered/keep_sft.jsonl";
const DEFAULT_JUDGED_INPUT = "data/evals/judged/judged-review-live.jsonl";
const DEFAULT_REVIEW_INPUT = "db";

function usage() {
  printUsage([
    "Usage: node scripts/finalize-sft-dataset.mjs [options]",
    "",
    "Options:",
    `  --keep-input <path[,path]>     keep rows to include automatically (default: ${DEFAULT_KEEP_INPUT})`,
    `  --judged-input <path[,path]>   judged review rows (default: ${DEFAULT_JUDGED_INPUT})`,
    `  --review-input <path[,path]|db> human review annotations (default: ${DEFAULT_REVIEW_INPUT})`,
    "  --collector-input <path[,path]> collector summary files for strategy lookup",
    "  --output-dir <path>            output directory (default: data/train/sft)",
    "  --dataset-version <value>      dataset version label (default: auto date-based label)",
    "  --filter-version <value>       filter version metadata (default: heuristic-filter-v1)",
    "  --judge-version <value>        judge version metadata (default: heuristic-judge-v1)",
    "  --dev-ratio <n>                dev split percentage (default: 20)",
    "  --seed <value>                 deterministic split seed (default: 20260411)",
    "  --include-unreviewed-keep      include keep rows without human review (default: false)",
    "  --include-unreviewed-judged-keep include judged keep rows without human review (default: true)",
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
  if (input === "db") {
    return loadSftReviewRecordsFromDb();
  }

  try {
    return await loadPlainRecords(input, defaultPatterns);
  } catch (error) {
    if (error instanceof Error && /ENOENT/u.test(error.message)) {
      return { files: [], records: [] };
    }

    throw error;
  }
}

function buildReviewDecisionMap(reviewRecords) {
  const decisionMap = new Map();

  for (const record of reviewRecords) {
    if (!record || typeof record !== "object") {
      continue;
    }

    const rowKey =
      typeof record.canonicalRowKey === "string" && record.canonicalRowKey
        ? record.canonicalRowKey
        : record.promptBundle
          ? buildCanonicalRowKey(record)
          : typeof record.sourceRowId === "string"
            ? record.sourceRowId
            : typeof record.rowId === "string"
              ? record.rowId
              : null;

    if (!rowKey) {
      continue;
    }

    const decision =
      normalizeHumanDecision(record.decision) ??
      normalizeHumanDecision(record.status);

    decisionMap.set(rowKey, {
      decision,
      status: typeof record.status === "string" ? record.status : "pending",
      reviewRequired: Boolean(record.reviewRequired),
      reviewer: typeof record.reviewer === "string" ? record.reviewer : null,
      reviewedAt: typeof record.reviewedAt === "string" ? record.reviewedAt : null,
      notes: typeof record.notes === "string" ? record.notes : "",
    });
  }

  return decisionMap;
}

function upsertCandidate(candidateMap, row, sourceKind) {
  const canonicalKey = buildCanonicalRowKey(row);
  const existing = candidateMap.get(canonicalKey);

  if (!existing) {
    candidateMap.set(canonicalKey, {
      canonicalKey,
      row,
      sourceKinds: new Set([sourceKind]),
    });
    return;
  }

  const shouldReplaceRow =
    sourceKind === "keep" ||
    !existing.sourceKinds.has("keep");

  existing.sourceKinds.add(sourceKind);
  existing.row = shouldReplaceRow
    ? {
        ...existing.row,
        ...row,
        filter: row.filter ?? existing.row.filter ?? null,
        judge: row.judge ?? existing.row.judge ?? null,
      }
    : {
        ...row,
        ...existing.row,
        filter: existing.row.filter ?? row.filter ?? null,
        judge: row.judge ?? existing.row.judge ?? null,
      };
}

function resolveHumanReviewStatus(humanReview, inclusionReason) {
  if (humanReview?.decision === "include") {
    return "approved";
  }

  if (humanReview?.decision === "exclude") {
    return "rejected";
  }

  if (humanReview?.decision === "escalate") {
    return "escalated";
  }

  if (humanReview?.reviewRequired) {
    return "awaiting_required_review";
  }

  if (inclusionReason === "auto_keep") {
    return "unreviewed_auto_keep";
  }

  if (inclusionReason === "judged_keep") {
    return "unreviewed_judged_keep";
  }

  return "pending";
}

function determineInclusion(entry, humanReview, options) {
  if (humanReview?.decision === "exclude") {
    return { included: false, reason: "human_excluded" };
  }

  if (humanReview?.decision === "include") {
    return { included: true, reason: "human_approved" };
  }

  if (humanReview?.decision === "escalate") {
    return { included: false, reason: "human_escalated" };
  }

  if (humanReview?.reviewRequired) {
    return { included: false, reason: "awaiting_required_human_review" };
  }

  if (
    entry.sourceKinds.has("keep") &&
    options.includeUnreviewedKeep
  ) {
    return { included: true, reason: "auto_keep" };
  }

  if (
    entry.row.judge?.final?.verdict === "keep" &&
    options.includeUnreviewedJudgedKeep
  ) {
    return { included: true, reason: "judged_keep" };
  }

  return { included: false, reason: "awaiting_human_review" };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const keepInput = getStringOption(options, "keep-input", DEFAULT_KEEP_INPUT);
  const judgedInput = getStringOption(options, "judged-input", DEFAULT_JUDGED_INPUT);
  const reviewInput = getStringOption(options, "review-input", DEFAULT_REVIEW_INPUT);
  const collectorInput = getStringOption(options, "collector-input", null);
  const outputDir = getStringOption(options, "output-dir", "data/train/sft");
  const datasetVersion = getStringOption(
    options,
    "dataset-version",
    `sft-${new Date().toISOString().slice(0, 10)}`,
  );
  const filterVersion = getStringOption(
    options,
    "filter-version",
    "heuristic-filter-v1",
  );
  const judgeVersion = getStringOption(
    options,
    "judge-version",
    "heuristic-judge-v1",
  );
  const devRatio = getNumberOption(options, "dev-ratio", 20);
  const seed = getStringOption(options, "seed", "20260411");
  const includeUnreviewedKeep = getBooleanOption(
    options,
    "include-unreviewed-keep",
    false,
  );
  const includeUnreviewedJudgedKeep = getBooleanOption(
    options,
    "include-unreviewed-judged-keep",
    true,
  );

  const [keepRowsResult, judgedRowsResult, reviewResult] = await Promise.all([
    loadOptionalNormalizedRows(keepInput, [DEFAULT_KEEP_INPUT]),
    loadOptionalNormalizedRows(judgedInput, [DEFAULT_JUDGED_INPUT]),
    loadOptionalPlainRecords(reviewInput, [DEFAULT_REVIEW_INPUT]),
  ]);
  const strategyLookup = await buildStrategyLookup(collectorInput).catch(() => null);
  const reviewDecisionMap = buildReviewDecisionMap(reviewResult.records);
  const candidateMap = new Map();
  const sourceCache = new Map();
  const humanReviewCounts = {
    rows: reviewDecisionMap.size,
    approved: 0,
    excluded: 0,
    escalated: 0,
    pendingRequired: 0,
  };

  for (const row of keepRowsResult.rows) {
    upsertCandidate(candidateMap, row, "keep");
  }

  for (const row of judgedRowsResult.rows) {
    upsertCandidate(candidateMap, row, "judged");
  }

  const includedRows = [];
  const exclusionReasons = {};

  for (const entry of candidateMap.values()) {
    const humanReview = reviewDecisionMap.get(entry.canonicalKey) ?? null;
    if (humanReview?.decision === "include") {
      humanReviewCounts.approved += 1;
    } else if (humanReview?.decision === "exclude") {
      humanReviewCounts.excluded += 1;
    } else if (humanReview?.decision === "escalate") {
      humanReviewCounts.escalated += 1;
    } else if (humanReview?.reviewRequired) {
      humanReviewCounts.pendingRequired += 1;
    }
    const inclusion = determineInclusion(
      entry,
      humanReview,
      {
        includeUnreviewedKeep,
        includeUnreviewedJudgedKeep,
      },
    );

    if (!inclusion.included) {
      exclusionReasons[inclusion.reason] = (exclusionReasons[inclusion.reason] ?? 0) + 1;
      continue;
    }

    const rawEntry = await loadSourceEntry(entry.row.source, sourceCache);
    const inputPayload = buildInputPayload(entry.row, rawEntry);
    const assistantPayload = buildAssistantPayload(entry.row, rawEntry);
    const metadataPayload = rawEntry?.metadata ?? entry.row.metadata ?? null;
    const ranking = entry.row.judge ? rankJudgedRecord(entry.row) : null;
    const strategyLabel = inferStrategyLabel(entry.row, strategyLookup);
    const split = assignSplit(entry.row.rowId, devRatio, seed);

    includedRows.push({
      split,
      row: {
        datasetVersion,
        rowId: entry.row.rowId,
        instruction: rawEntry?.instruction ?? DEFAULT_INSTRUCTION,
        input: inputPayload,
        assistant: assistantPayload,
        metadata: metadataPayload,
        rubricHints: entry.row.rubricHints ?? [],
        curation: {
          sourceEpisodeId: entry.row.promptBundle.episodeId,
          sourceExportPath: buildSourceExportPath(entry.row),
          sourceLabel: entry.row.source.label,
          sourceKinds: [...entry.sourceKinds],
          strategyLabel,
          filterVersion,
          judgeVersion,
          humanReviewStatus: resolveHumanReviewStatus(humanReview, inclusion.reason),
          humanReviewDecision: humanReview?.decision ?? null,
          humanReviewReviewer: humanReview?.reviewer ?? null,
          humanReviewReviewedAt: humanReview?.reviewedAt ?? null,
          inclusionReason: inclusion.reason,
          filter: entry.row.filter ?? null,
          judge: entry.row.judge?.final ?? null,
          judgeConfidence: ranking?.finalJudge.confidence ?? null,
          weightedJudgeScore: ranking?.weightedScore ?? null,
        },
      },
    });
  }

  const trainRows = includedRows
    .filter((entry) => entry.split === "train")
    .map((entry) => entry.row);
  const devRows = includedRows
    .filter((entry) => entry.split === "dev")
    .map((entry) => entry.row);
  const trainOutput = path.join(outputDir, "final_sft_train.jsonl");
  const devOutput = path.join(outputDir, "final_sft_dev.jsonl");
  const manifestOutput = path.join(outputDir, "manifest.json");

  await writeJsonLines(trainOutput, trainRows);
  await writeJsonLines(devOutput, devRows);
  await writeSummaryJson(manifestOutput, {
    generatedAt: new Date().toISOString(),
    datasetVersion,
    filterVersion,
    judgeVersion,
    seed,
    devRatio,
    includeUnreviewedKeep,
    includeUnreviewedJudgedKeep,
    inputFiles: {
      keep: keepRowsResult.files,
      judged: judgedRowsResult.files,
      humanReview: reviewResult.files,
      collector: strategyLookup?.files ?? [],
    },
    candidateCounts: {
      totalCandidates: candidateMap.size,
      totalIncluded: includedRows.length,
      train: trainRows.length,
      dev: devRows.length,
      keepRows: keepRowsResult.rows.length,
      judgedRows: judgedRowsResult.rows.length,
      humanReviewRows: humanReviewCounts.rows,
      humanApproved: humanReviewCounts.approved,
      humanExcluded: humanReviewCounts.excluded,
      humanEscalated: humanReviewCounts.escalated,
      humanPendingRequired: humanReviewCounts.pendingRequired,
    },
    exclusionReasons,
    averages: {
      weightedJudgeScore: average(
        includedRows
          .map((entry) => entry.row.curation.weightedJudgeScore)
          .filter((value) => typeof value === "number"),
      ),
      judgeConfidence: average(
        includedRows
          .map((entry) => entry.row.curation.judgeConfidence)
          .filter((value) => typeof value === "number"),
      ),
    },
    strategyCounts: includedRows.reduce((counts, entry) => {
      const key = entry.row.curation.strategyLabel ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    scenarioCounts: includedRows.reduce((counts, entry) => {
      const key = entry.row.input.scenarioId ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    outputFiles: {
      train: trainOutput,
      dev: devOutput,
      manifest: manifestOutput,
    },
  });

  console.log(
    [
      `included=${includedRows.length}`,
      `train=${trainRows.length}`,
      `dev=${devRows.length}`,
      `manifest=${manifestOutput}`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
