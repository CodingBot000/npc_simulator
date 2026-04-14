import path from "node:path";
import {
  getBooleanOption,
  getStringOption,
  parseCliArgs,
  printUsage,
} from "./_episode-cli-helpers.mjs";
import {
  average,
  buildStrategyLookup,
  inferStrategyLabel,
  loadPlainRecords,
  normalizeHumanDecision,
} from "./_curation-helpers.mjs";
import {
  writeJsonLines,
  writeSummaryJson,
} from "./_quality-judge-helpers.mjs";

const DEFAULT_PAIR_INPUT = "data/evals/preference/candidate_pairs_live_gap1.jsonl";
const DEFAULT_REVIEW_INPUT = "data/review/live/human_review_pair_queue.jsonl";

function usage() {
  printUsage([
    "Usage: node scripts/finalize-preference-dataset.mjs [options]",
    "",
    "Options:",
    `  --pairs-input <path[,path]>    candidate pair input (default: ${DEFAULT_PAIR_INPUT})`,
    `  --review-input <path[,path]>   human pair review annotations (default: ${DEFAULT_REVIEW_INPUT})`,
    "  --collector-input <path[,path]> collector summary files for strategy lookup",
    "  --output-dir <path>            output directory (default: data/train/preference)",
    "  --dataset-version <value>      dataset version label (default: auto date-based label)",
    "  --include-unreviewed           include candidate pairs not routed to human review (default: true)",
    "  --help                         show this message",
  ]);
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

function buildPairReviewMap(reviewRecords) {
  const reviewMap = new Map();

  for (const record of reviewRecords) {
    if (!record || typeof record !== "object") {
      continue;
    }

    const pairId =
      typeof record.pairId === "string"
        ? record.pairId
        : typeof record.reviewId === "string" && record.reviewId.startsWith("pair:")
          ? record.reviewId.slice("pair:".length)
          : null;

    if (!pairId) {
      continue;
    }

    reviewMap.set(pairId, {
      decision:
        normalizeHumanDecision(record.decision) ??
        normalizeHumanDecision(record.status),
      status: typeof record.status === "string" ? record.status : "pending",
      reviewRequired: Boolean(record.reviewRequired),
      reviewer: typeof record.reviewer === "string" ? record.reviewer : null,
      reviewedAt: typeof record.reviewedAt === "string" ? record.reviewedAt : null,
      notes: typeof record.notes === "string" ? record.notes : "",
    });
  }

  return reviewMap;
}

function determinePairInclusion(pair, review, includeUnreviewed) {
  if (review?.decision === "exclude") {
    return { included: false, reason: "human_rejected" };
  }

  if (review?.decision === "include") {
    return { included: true, reason: "human_approved", flip: false };
  }

  if (review?.decision === "flip") {
    return { included: true, reason: "human_flipped", flip: true };
  }

  if (review?.decision === "escalate") {
    return { included: false, reason: "human_escalated" };
  }

  if (review?.reviewRequired) {
    return { included: false, reason: "awaiting_required_human_review" };
  }

  const autoDecision =
    typeof pair?.judge?.final?.decision === "string"
      ? pair.judge.final.decision
      : "include";

  if (autoDecision === "exclude") {
    return { included: false, reason: "auto_pair_rejected" };
  }

  if (autoDecision === "flip") {
    return includeUnreviewed
      ? { included: true, reason: "auto_pair_flipped", flip: true }
      : { included: false, reason: "awaiting_human_review" };
  }

  if (autoDecision === "review") {
    return { included: false, reason: "auto_pair_review" };
  }

  if (includeUnreviewed) {
    return { included: true, reason: "auto_pair_approved", flip: false };
  }

  return { included: false, reason: "awaiting_human_review" };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const pairsInput = getStringOption(options, "pairs-input", DEFAULT_PAIR_INPUT);
  const reviewInput = getStringOption(options, "review-input", DEFAULT_REVIEW_INPUT);
  const collectorInput = getStringOption(options, "collector-input", null);
  const outputDir = getStringOption(options, "output-dir", "data/train/preference");
  const datasetVersion = getStringOption(
    options,
    "dataset-version",
    `preference-${new Date().toISOString().slice(0, 10)}`,
  );
  const effectiveIncludeUnreviewed = getBooleanOption(
    options,
    "include-unreviewed",
    true,
  );

  const [pairResult, reviewResult] = await Promise.all([
    loadOptionalPlainRecords(pairsInput, [DEFAULT_PAIR_INPUT]),
    loadOptionalPlainRecords(reviewInput, [DEFAULT_REVIEW_INPUT]),
  ]);
  const strategyLookup = await buildStrategyLookup(collectorInput).catch(() => null);
  const reviewMap = buildPairReviewMap(reviewResult.records);
  const finalizedPairs = [];
  const exclusionReasons = {};
  const humanReviewCounts = {
    rows: reviewMap.size,
    approved: 0,
    flipped: 0,
    excluded: 0,
    pendingRequired: 0,
  };
  const autoDecisionCounts = {
    approved: 0,
    flipped: 0,
    excluded: 0,
    review: 0,
  };

  for (const pair of pairResult.records) {
    if (!pair || typeof pair !== "object" || typeof pair.pairId !== "string") {
      continue;
    }

    const review = reviewMap.get(pair.pairId) ?? null;
    if (review?.decision === "include") {
      humanReviewCounts.approved += 1;
    } else if (review?.decision === "flip") {
      humanReviewCounts.flipped += 1;
    } else if (review?.decision === "exclude") {
      humanReviewCounts.excluded += 1;
    } else if (review?.reviewRequired) {
      humanReviewCounts.pendingRequired += 1;
    }
    const autoDecision =
      typeof pair?.judge?.final?.decision === "string"
        ? pair.judge.final.decision
        : "include";
    if (autoDecision === "include") {
      autoDecisionCounts.approved += 1;
    } else if (autoDecision === "flip") {
      autoDecisionCounts.flipped += 1;
    } else if (autoDecision === "exclude") {
      autoDecisionCounts.excluded += 1;
    } else {
      autoDecisionCounts.review += 1;
    }
    const inclusion = determinePairInclusion(pair, review, effectiveIncludeUnreviewed);

    if (!inclusion.included) {
      exclusionReasons[inclusion.reason] = (exclusionReasons[inclusion.reason] ?? 0) + 1;
      continue;
    }

    const chosen = inclusion.flip ? pair.rejectedCandidate : pair.chosenCandidate;
    const rejected = inclusion.flip ? pair.chosenCandidate : pair.rejectedCandidate;
    const strategyLabel = inferStrategyLabel(
      {
        promptBundle: pair.promptBundle,
        source: null,
      },
      strategyLookup,
    );

    finalizedPairs.push({
      datasetVersion,
      pairId: pair.pairId,
      promptBundle: pair.promptBundle,
      chosen,
      rejected,
      metadata: {
        grouping: pair.grouping ?? null,
        pairReason: pair.pairReason ?? [],
        weightedGap: pair.weightedGap ?? null,
        pairConfidence: pair.pairConfidence ?? null,
        preferenceStrength: pair.preferenceStrength ?? null,
        strategyLabel,
        humanReviewStatus:
          inclusion.reason === "human_approved"
            ? "approved"
            : inclusion.reason === "human_flipped"
              ? "approved_flipped"
              : inclusion.reason === "auto_pair_flipped"
                ? "auto_flipped"
                : inclusion.reason === "auto_pair_approved"
                  ? "auto_approved"
                : inclusion.reason === "awaiting_required_human_review"
                  ? "awaiting_required_review"
                  : "unreviewed_candidate",
        humanReviewDecision: review?.decision ?? null,
        humanReviewReviewer: review?.reviewer ?? null,
        humanReviewReviewedAt: review?.reviewedAt ?? null,
        humanReviewNotes: review?.notes ?? "",
        pairJudge: pair.judge?.final ?? null,
        inclusionReason: inclusion.reason,
      },
    });
  }

  const pairOutput = path.join(outputDir, "final_preference_pairs.jsonl");
  const manifestOutput = path.join(outputDir, "manifest.json");

  await writeJsonLines(pairOutput, finalizedPairs);
  await writeSummaryJson(manifestOutput, {
    generatedAt: new Date().toISOString(),
    datasetVersion,
    includeUnreviewed: effectiveIncludeUnreviewed,
    inputFiles: {
      pairs: pairResult.files,
      humanReview: reviewResult.files,
      collector: strategyLookup?.files ?? [],
    },
    counts: {
      totalCandidates: pairResult.records.filter(
        (record) => record && typeof record === "object" && typeof record.pairId === "string",
      ).length,
      totalIncluded: finalizedPairs.length,
      humanReviewRows: humanReviewCounts.rows,
      humanApproved: humanReviewCounts.approved,
      humanFlipped: humanReviewCounts.flipped,
      humanExcluded: humanReviewCounts.excluded,
      humanPendingRequired: humanReviewCounts.pendingRequired,
      autoApproved: autoDecisionCounts.approved,
      autoFlipped: autoDecisionCounts.flipped,
      autoExcluded: autoDecisionCounts.excluded,
      autoReview: autoDecisionCounts.review,
    },
    exclusionReasons,
    averages: {
      weightedGap: average(
        finalizedPairs
          .map((pair) => pair.metadata.weightedGap)
          .filter((value) => typeof value === "number"),
      ),
      pairConfidence: average(
        finalizedPairs
          .map((pair) => pair.metadata.pairConfidence)
          .filter((value) => typeof value === "number"),
      ),
      preferenceStrength: average(
        finalizedPairs
          .map((pair) => pair.metadata.preferenceStrength)
          .filter((value) => typeof value === "number"),
      ),
    },
    strategyCounts: finalizedPairs.reduce((counts, pair) => {
      const key = pair.metadata.strategyLabel ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    outputFiles: {
      pairs: pairOutput,
      manifest: manifestOutput,
    },
  });

  console.log(
    [
      `included=${finalizedPairs.length}`,
      `manifest=${manifestOutput}`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
