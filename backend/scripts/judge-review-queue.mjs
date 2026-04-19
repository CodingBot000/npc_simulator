import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  parseCliArgs,
  printUsage,
} from "./_episode-cli-helpers.mjs";
import {
  loadNormalizedRows,
  runDatasetJudge,
  summarizeJudgeRun,
  writeJsonLines,
  writeSummaryJson,
} from "./_quality-judge-helpers.mjs";

function usage() {
  printUsage([
    "Usage: node scripts/judge-review-queue.mjs [options]",
    "",
    "Options:",
    "  --input <path[,path]>         file, directory, or glob (default: data/evals/filtered/*_sft.jsonl)",
    "  --output <path>               JSONL output path (default: data/evals/judged/judged-review-live.jsonl)",
    "  --mode <heuristic|llm|hybrid> judge mode (default: llm)",
    "  --provider <codex|openai>     LLM provider for llm/hybrid mode (default: codex)",
    "  --limit <n>                   process only the first n rows",
    "  --dry-run                     skip actual LLM calls in llm/hybrid mode",
    "  --verbose                     print per-row judge output",
    "  --help                        show this message",
  ]);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const input = getStringOption(
    options,
    "input",
    "data/evals/filtered/*_sft.jsonl",
  );
  const output = getStringOption(
    options,
    "output",
    "data/evals/judged/judged-review-live.jsonl",
  );
  const mode = getStringOption(options, "mode", "llm");
  const provider = getStringOption(options, "provider", "codex");
  const limit = getNumberOption(options, "limit", null);
  const dryRun = Boolean(options["dry-run"]);
  const verbose = Boolean(options.verbose);

  if (!["heuristic", "llm", "hybrid"].includes(mode)) {
    throw new Error("--mode must be one of heuristic, llm, hybrid");
  }

  if (!["codex", "openai"].includes(provider)) {
    throw new Error("--provider must be one of codex, openai");
  }

  if (limit !== null && limit < 1) {
    throw new Error("--limit must be at least 1");
  }

  const { files, rows } = await loadNormalizedRows({
    input,
    defaultPatterns: ["data/evals/filtered/*_sft.jsonl"],
  });
  const limitedRows = limit ? rows.slice(0, limit) : rows;
  const judgedRows = [];

  for (const row of limitedRows) {
    const judge = await runDatasetJudge(row, {
      mode,
      provider,
      dryRun,
    });
    const record = {
      ...row,
      judge: {
        mode,
        provider,
        heuristic: {
          responseQuality: judge.heuristic.responseQuality,
          structuredImpactQuality: judge.heuristic.structuredImpactQuality,
          groundingQuality: judge.heuristic.groundingQuality,
          personaConsistency: judge.heuristic.personaConsistency,
          inspectorUsefulness: judge.heuristic.inspectorUsefulness,
          verdict: judge.heuristic.verdict,
          reasons: judge.heuristic.reasons,
        },
        llm: judge.llm,
        final: judge.final,
        llmSkipped: judge.llmSkipped,
        llmError: judge.llmError,
      },
    };

    judgedRows.push(record);

    if (verbose) {
      const final = record.judge.final;
      console.log(
        [
          row.source.label,
          `verdict=${final.verdict}`,
          `response=${final.responseQuality}`,
          `impact=${final.structuredImpactQuality}`,
          `grounding=${final.groundingQuality}`,
          `persona=${final.personaConsistency}`,
        ].join(" | "),
      );
      if (record.judge.llmError) {
        console.log(`  llmError: ${record.judge.llmError}`);
      }
    }
  }

  const summaryPath = path.join(path.dirname(output), "judge-summary.json");
  await writeJsonLines(output, judgedRows);

  const summary = summarizeJudgeRun({
    inputFiles: files,
    results: judgedRows,
    mode,
    provider,
    outputFiles: {
      judged: output,
    },
  });

  await writeSummaryJson(summaryPath, summary);

  console.log(
    [
      `processed=${summary.processedCount}`,
      `keep=${summary.verdicts.keep}`,
      `review=${summary.verdicts.review}`,
      `drop=${summary.verdicts.drop}`,
      `summary=${summaryPath}`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
