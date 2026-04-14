import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  parseCliArgs,
  printUsage,
} from "./_episode-cli-helpers.mjs";
import {
  buildHeuristicQualityAnalysis,
  classifyFilterDecision,
  loadNormalizedRows,
  summarizeFilterRun,
  writeJsonLines,
  writeSummaryJson,
} from "./_quality-judge-helpers.mjs";

function usage() {
  printUsage([
    "Usage: node scripts/filter-sft-rows.mjs [options]",
    "",
    "Options:",
    "  --input <path[,path]>         file, directory, or glob (default: data/datasets/sft)",
    "  --output-dir <path>           output directory (default: data/evals/filtered)",
    "  --limit <n>                   process only the first n rows",
    "  --verbose                     print per-row decisions",
    "  --help                        show this message",
  ]);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const input = getStringOption(options, "input", "data/datasets/sft");
  const outputDir = getStringOption(options, "output-dir", "data/evals/filtered");
  const limit = getNumberOption(options, "limit", null);
  const verbose = Boolean(options.verbose);

  if (limit !== null && limit < 1) {
    throw new Error("--limit must be at least 1");
  }

  const { files, rows } = await loadNormalizedRows({
    input,
    defaultPatterns: ["data/datasets/sft"],
  });
  const limitedRows = limit ? rows.slice(0, limit) : rows;
  const classifiedRows = [];
  const keepRows = [];
  const reviewRows = [];
  const dropRows = [];

  for (const row of limitedRows) {
    const analysis = buildHeuristicQualityAnalysis(row);
    const decision = classifyFilterDecision(analysis);
    const record = {
      ...row,
      filter: {
        decision,
        hardFailures: analysis.hardFailures,
        heuristicScores: analysis.heuristicScores,
        aggregateScore: analysis.aggregateScore,
        minAxisScore: analysis.minAxisScore,
        evidenceStats: analysis.evidenceStats,
        reasonBuckets: analysis.reasonBuckets,
      },
    };

    classifiedRows.push(record);

    if (decision === "keep") {
      keepRows.push(record);
    } else if (decision === "review") {
      reviewRows.push(record);
    } else {
      dropRows.push(record);
    }

    if (verbose) {
      const summary = [
        `${record.source.label}`,
        `${record.promptBundle.npcId}`,
        `decision=${decision}`,
        `score=${analysis.aggregateScore}`,
      ].join(" | ");
      console.log(summary);
      if (analysis.hardFailures.length) {
        console.log(`  hardFailures: ${analysis.hardFailures.join("; ")}`);
      }
    }
  }

  const keepPath = path.join(outputDir, "keep_sft.jsonl");
  const reviewPath = path.join(outputDir, "review_sft.jsonl");
  const dropPath = path.join(outputDir, "drop_sft.jsonl");
  const summaryPath = path.join(outputDir, "filter-summary.json");

  await writeJsonLines(keepPath, keepRows);
  await writeJsonLines(reviewPath, reviewRows);
  await writeJsonLines(dropPath, dropRows);

  const summary = summarizeFilterRun({
    inputFiles: files,
    results: classifiedRows,
    outputFiles: {
      keep: keepPath,
      review: reviewPath,
      drop: dropPath,
    },
  });

  await writeSummaryJson(summaryPath, summary);

  console.log(
    [
      `processed=${summary.processedCount}`,
      `keep=${summary.decisions.keep}`,
      `review=${summary.decisions.review}`,
      `drop=${summary.decisions.drop}`,
      `summary=${summaryPath}`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
