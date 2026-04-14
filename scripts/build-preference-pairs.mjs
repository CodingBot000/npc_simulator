import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  parseCliArgs,
  printUsage,
} from "./_episode-cli-helpers.mjs";
import {
  buildHeuristicJudge,
  loadNormalizedRows,
  rankJudgedRecord,
  resolvePromptKeys,
  runPreferencePairJudge,
  writeJsonLines,
  writeSummaryJson,
} from "./_quality-judge-helpers.mjs";

function usage() {
  printUsage([
    "Usage: node scripts/build-preference-pairs.mjs [options]",
    "",
    "Options:",
    "  --input <path[,path]>         judged JSONL input (default: data/evals/judged/judged-review-live.jsonl)",
    "  --output <path>               JSONL output path (default: data/evals/preference/candidate_pairs_live_gap1.jsonl)",
    "  --limit <n>                   process only the first n judged rows",
    "  --min-score-gap <n>           weighted score gap threshold (default: 1)",
    "  --judge-mode <heuristic|llm|hybrid> pair judge mode (default: llm)",
    "  --provider <codex|openai>     LLM provider for llm/hybrid mode (default: codex)",
    "  --dry-run                     skip actual LLM calls in llm/hybrid mode",
    "  --verbose                     print per-pair details",
    "  --help                        show this message",
  ]);
}

function groupBy(records, getKey) {
  return records.reduce((accumulator, record) => {
    const key = getKey(record);
    accumulator[key] ??= [];
    accumulator[key].push(record);
    return accumulator;
  }, {});
}

function buildAxisReasons(chosenJudge, rejectedJudge) {
  const reasons = [];

  if (chosenJudge.structuredImpactQuality > rejectedJudge.structuredImpactQuality) {
    reasons.push("structuredImpact quality higher");
  }
  if (chosenJudge.personaConsistency > rejectedJudge.personaConsistency) {
    reasons.push("persona consistency higher");
  }
  if (chosenJudge.groundingQuality > rejectedJudge.groundingQuality) {
    reasons.push("grounding quality higher");
  }
  if (chosenJudge.responseQuality > rejectedJudge.responseQuality) {
    reasons.push("response quality higher");
  }
  if (chosenJudge.inspectorUsefulness > rejectedJudge.inspectorUsefulness) {
    reasons.push("inspector usefulness higher");
  }

  return reasons.length ? reasons : ["weighted quality score higher"];
}

function mergeReasons(primary, secondary) {
  return [...new Set([...(primary ?? []), ...(secondary ?? [])].filter(Boolean))].slice(0, 6);
}

function createCandidateSummary(record, ranking) {
  return {
    rowId: record.rowId,
    source: record.source,
    verdict: ranking.finalJudge.verdict,
    llmError: record.judge?.llmError ?? null,
    scores: {
      responseQuality: ranking.finalJudge.responseQuality,
      structuredImpactQuality: ranking.finalJudge.structuredImpactQuality,
      groundingQuality: ranking.finalJudge.groundingQuality,
      personaConsistency: ranking.finalJudge.personaConsistency,
      inspectorUsefulness: ranking.finalJudge.inspectorUsefulness,
      confidence: ranking.finalJudge.confidence ?? null,
      weightedScore: ranking.weightedScore,
    },
    candidateOutput: record.candidateOutput,
  };
}

function buildPairCandidates(groupRecords, strategy, minScoreGap) {
  if (groupRecords.length < 2) {
    return [];
  }

  const scored = groupRecords
    .map((record) => ({
      record,
      ranking: rankJudgedRecord(record),
    }))
    .sort((left, right) => right.ranking.weightedScore - left.ranking.weightedScore);
  const pairs = [];

  for (let leftIndex = 0; leftIndex < scored.length - 1; leftIndex += 1) {
    for (let rightIndex = scored.length - 1; rightIndex > leftIndex; rightIndex -= 1) {
      const chosen = scored[leftIndex];
      const rejected = scored[rightIndex];
      const weightedGap = chosen.ranking.weightedScore - rejected.ranking.weightedScore;

      if (weightedGap < minScoreGap) {
        continue;
      }

      pairs.push({
        pairId: `${strategy}:${chosen.record.rowId}:${rejected.record.rowId}`,
        grouping: {
          strategy,
          key:
            strategy === "exact_prompt"
              ? resolvePromptKeys(chosen.record).exactPromptKey
              : resolvePromptKeys(chosen.record).similarSituationKey,
        },
        promptBundle: chosen.record.promptBundle,
        chosenCandidate: createCandidateSummary(chosen.record, chosen.ranking),
        rejectedCandidate: createCandidateSummary(rejected.record, rejected.ranking),
        pairReason: buildAxisReasons(
          chosen.ranking.finalJudge,
          rejected.ranking.finalJudge,
        ),
        pairConfidence: Math.min(
          chosen.ranking.finalJudge.confidence ?? 3,
          rejected.ranking.finalJudge.confidence ?? 3,
        ),
        weightedGap,
        status: "candidate",
      });

      break;
    }
  }

  return pairs;
}

function summarizePairs(inputFilePaths, pairs, outputPath) {
  return {
    generatedAt: new Date().toISOString(),
    inputFiles: inputFilePaths,
    pairCount: pairs.length,
    exactPromptPairs: pairs.filter(
      (pair) => pair.grouping.strategy === "exact_prompt",
    ).length,
    similarSituationPairs: pairs.filter(
      (pair) => pair.grouping.strategy === "similar_situation",
    ).length,
    averageWeightedGap:
      pairs.length > 0
        ? Number(
            (
              pairs.reduce((sum, pair) => sum + pair.weightedGap, 0) / pairs.length
            ).toFixed(2),
          )
        : 0,
    averagePreferenceStrength:
      pairs.length > 0
        ? Number(
            (
              pairs.reduce((sum, pair) => sum + (pair.preferenceStrength ?? 0), 0) /
              pairs.length
            ).toFixed(2),
          )
        : 0,
    averagePairConfidence:
      pairs.length > 0
        ? Number(
            (
              pairs.reduce((sum, pair) => sum + (pair.pairConfidence ?? 0), 0) /
              pairs.length
            ).toFixed(2),
          )
        : 0,
    decisionCounts: pairs.reduce((counts, pair) => {
      const key = pair.pairDecision ?? "review";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    outputFile: outputPath,
  };
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
    "data/evals/judged/judged-review-live.jsonl",
  );
  const output = getStringOption(
    options,
    "output",
    "data/evals/preference/candidate_pairs_live_gap1.jsonl",
  );
  const limit = getNumberOption(options, "limit", null);
  const minScoreGap = getNumberOption(options, "min-score-gap", 1);
  const judgeMode = getStringOption(options, "judge-mode", "llm");
  const provider = getStringOption(options, "provider", "codex");
  const dryRun = Boolean(options["dry-run"]);
  const verbose = Boolean(options.verbose);

  if (limit !== null && limit < 1) {
    throw new Error("--limit must be at least 1");
  }

  if (!["heuristic", "llm", "hybrid"].includes(judgeMode)) {
    throw new Error("--judge-mode must be one of heuristic, llm, hybrid");
  }

  if (!["codex", "openai"].includes(provider)) {
    throw new Error("--provider must be one of codex, openai");
  }

  const { files, rows } = await loadNormalizedRows({
    input,
    defaultPatterns: ["data/evals/judged/judged-review-live.jsonl"],
  });
  const limitedRows = limit ? rows.slice(0, limit) : rows;
  const hydratedRows = limitedRows.map((row) => ({
    ...row,
    judge:
      row.judge ??
      {
        final: buildHeuristicJudge(row),
      },
  }));
  const exactGroups = Object.values(
    groupBy(hydratedRows, (row) => resolvePromptKeys(row).exactPromptKey),
  ).filter((group) => group.length >= 2);
  const similarGroups = Object.values(
    groupBy(hydratedRows, (row) => resolvePromptKeys(row).similarSituationKey),
  ).filter((group) => group.length >= 2);
  const pairMap = new Map();

  for (const group of exactGroups) {
    for (const pair of buildPairCandidates(group, "exact_prompt", minScoreGap)) {
      pairMap.set(pair.pairId, pair);
    }
  }

  for (const group of similarGroups) {
    for (const pair of buildPairCandidates(group, "similar_situation", minScoreGap)) {
      const pairKey = [pair.chosenCandidate.rowId, pair.rejectedCandidate.rowId]
        .sort()
        .join("|");
      if (!pairMap.has(pair.pairId) && !Array.from(pairMap.values()).some(
        (candidate) =>
          [candidate.chosenCandidate.rowId, candidate.rejectedCandidate.rowId]
            .sort()
            .join("|") === pairKey,
      )) {
        pairMap.set(pair.pairId, pair);
      }
    }
  }

  const rawPairs = Array.from(pairMap.values()).sort(
    (left, right) => right.weightedGap - left.weightedGap,
  );
  const pairs = [];

  for (const pair of rawPairs) {
    const judge = await runPreferencePairJudge(pair, {
      mode: judgeMode,
      provider,
      dryRun,
    });
    const finalReasons = mergeReasons(pair.pairReason, judge.final.reasons);

    pairs.push({
      ...pair,
      pairDecision: judge.final.decision,
      pairConfidence: judge.final.confidence,
      preferenceStrength: judge.final.preferenceStrength,
      pairReason: finalReasons,
      judge,
    });
  }
  const summaryPath = path.join(path.dirname(output), "pair-summary.json");

  await writeJsonLines(output, pairs);
  const summary = summarizePairs(
    files.map((filePath) => path.relative(process.cwd(), filePath)),
    pairs,
    output,
  );
  await writeSummaryJson(summaryPath, summary);

  if (verbose) {
    for (const pair of pairs) {
      console.log(
        [
          pair.grouping.strategy,
          `chosen=${pair.chosenCandidate.rowId}`,
          `rejected=${pair.rejectedCandidate.rowId}`,
          `gap=${pair.weightedGap}`,
          `decision=${pair.pairDecision}`,
          `confidence=${pair.pairConfidence}`,
        ].join(" | "),
      );
    }
  }

  console.log(
    [`pairs=${summary.pairCount}`, `summary=${summaryPath}`].join(" "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
