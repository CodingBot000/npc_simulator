import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getStringOption,
  parseCliArgs,
  printUsage,
  loadJsonOrJsonl,
  resolveProjectPath,
} from "./_episode-cli-helpers.mjs";
import {
  runDatasetJudge,
  runPreferencePairJudge,
} from "./_quality-judge-helpers.mjs";
import {
  buildScriptSpawnEnv,
  ensureScriptProjectRoot,
} from "./_script-runtime.mjs";

const DEFAULT_SFT_INPUT = "data/review/live/human_review_sft_queue.jsonl";
const DEFAULT_PAIR_INPUT = "data/review/live/human_review_pair_queue.jsonl";
const DEFAULT_OUTPUT_DIR = "data/review/live";
const PROJECT_ROOT = ensureScriptProjectRoot(import.meta.url, "..", "..");
const REVIEW_SYNC_SCRIPT_PATH = path.join(PROJECT_ROOT, "backend", "scripts", "review-sync-queue.ts");

function usage() {
  printUsage([
    "Usage: node scripts/llm-first-pass-review-queue.mjs [options]",
    "",
    "Options:",
    `  --sft-input <path>            raw SFT human review queue (default: ${DEFAULT_SFT_INPUT})`,
    `  --pair-input <path>           raw pair human review queue (default: ${DEFAULT_PAIR_INPUT})`,
    `  --output-dir <path>           output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    "  --provider <codex|openai>     LLM provider (default: codex)",
    "  --skip-db-sync                skip DB sync after LLM first-pass files are written",
    "  --help                        show this message",
  ]);
}

function runQueueSync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", REVIEW_SYNC_SCRIPT_PATH, ...args], {
      cwd: PROJECT_ROOT,
      env: buildScriptSpawnEnv(PROJECT_ROOT),
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "llm first-pass DB sync failed"));
        return;
      }
      resolve();
    });
  });
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapSftVerdictToSuggestion(verdict) {
  if (verdict === "keep") {
    return "include";
  }

  if (verdict === "drop") {
    return "exclude";
  }

  return "escalate";
}

function mapPairDecisionToSuggestion(decision) {
  if (decision === "include" || decision === "flip" || decision === "exclude") {
    return decision;
  }

  return "escalate";
}

function buildSftRecordFromQueueItem(item) {
  return {
    rowId: item.sourceRowId ?? item.rowId ?? item.reviewId,
    source: {
      kind: "review-queue",
      path: item.source?.exportPath ?? item.source?.sourceLabel ?? item.reviewId,
      lineNumber: null,
      turnIndex: item.promptBundle?.turnIndex ?? null,
      label: item.source?.sourceLabel ?? item.reviewId,
    },
    promptBundle: item.promptBundle,
    candidateOutput: item.candidateOutput,
    metadata: item.metadata ?? {
      relationshipDelta: { trust: 0, affinity: 0, tension: 0 },
      pressureChanges: [],
      resolutionAfter: null,
    },
    rubricHints: ensureArray(item.rubricHints),
    filter: item.filter ?? null,
    judge: item.judge ? { final: item.judge } : null,
  };
}

async function writeOutputs(basePath, items) {
  const jsonPath = `${basePath}.json`;
  const jsonlPath = `${basePath}.jsonl`;
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  const jsonlPayload = items.map((item) => JSON.stringify(item)).join("\n");
  await fs.writeFile(jsonlPath, jsonlPayload ? `${jsonlPayload}\n` : "", "utf8");
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const sftInput = getStringOption(options, "sft-input", DEFAULT_SFT_INPUT);
  const pairInput = getStringOption(options, "pair-input", DEFAULT_PAIR_INPUT);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const provider = getStringOption(options, "provider", "codex");
  const skipDbSync = Boolean(options["skip-db-sync"]);

  if (!["codex", "openai"].includes(provider)) {
    throw new Error("--provider must be one of codex, openai");
  }

  const [rawSftItems, rawPairItems] = await Promise.all([
    loadJsonOrJsonl(sftInput).catch((error) => {
      if (error instanceof Error && /ENOENT/u.test(error.message)) {
        return [];
      }
      throw error;
    }),
    loadJsonOrJsonl(pairInput).catch((error) => {
      if (error instanceof Error && /ENOENT/u.test(error.message)) {
        return [];
      }
      throw error;
    }),
  ]);

  const sftItems = ensureArray(rawSftItems);
  const pairItems = ensureArray(rawPairItems);

  const llmReviewedSft = [];
  for (const item of sftItems) {
    const judge = await runDatasetJudge(buildSftRecordFromQueueItem(item), {
      mode: "llm",
      provider,
    });

    llmReviewedSft.push({
      ...item,
      llmFirstPass: {
        provider,
        suggestedDecision: mapSftVerdictToSuggestion(judge.final.verdict),
        verdict: judge.final.verdict,
        confidence: judge.final.confidence ?? null,
        scores: {
          responseQuality: judge.final.responseQuality,
          structuredImpactQuality: judge.final.structuredImpactQuality,
          groundingQuality: judge.final.groundingQuality,
          personaConsistency: judge.final.personaConsistency,
          inspectorUsefulness: judge.final.inspectorUsefulness,
        },
        reasons: judge.final.reasons ?? [],
        llmError: judge.llmError ?? null,
      },
    });
  }

  const llmReviewedPairs = [];
  for (const item of pairItems) {
    const pair = item.candidatePair ?? null;
    if (!pair) {
      llmReviewedPairs.push({
        ...item,
        llmFirstPass: {
          provider,
          suggestedDecision: "escalate",
          decision: "review",
          confidence: null,
          preferenceStrength: null,
          reasons: ["candidatePair missing"],
          llmError: "candidatePair missing",
        },
      });
      continue;
    }

    const judge = await runPreferencePairJudge(pair, {
      mode: "llm",
      provider,
    });

    llmReviewedPairs.push({
      ...item,
      llmFirstPass: {
        provider,
        suggestedDecision: mapPairDecisionToSuggestion(judge.final.decision),
        decision: judge.final.decision,
        confidence: judge.final.confidence ?? null,
        preferenceStrength: judge.final.preferenceStrength ?? null,
        reasons: judge.final.reasons ?? [],
        llmError: judge.llmError ?? null,
      },
    });
  }

  const outputRoot = resolveProjectPath(outputDir);
  await writeOutputs(path.join(outputRoot, "llm_first_pass_sft_queue"), llmReviewedSft);
  await writeOutputs(path.join(outputRoot, "llm_first_pass_pair_queue"), llmReviewedPairs);
  await fs.writeFile(
    path.join(outputRoot, "llm_first_pass_summary.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        provider,
        inputFiles: {
          sft: resolveProjectPath(sftInput),
          pair: resolveProjectPath(pairInput),
        },
        counts: {
          sft: llmReviewedSft.length,
          pair: llmReviewedPairs.length,
        },
        outputFiles: {
          sftJson: path.join(outputDir, "llm_first_pass_sft_queue.json"),
          sftJsonl: path.join(outputDir, "llm_first_pass_sft_queue.jsonl"),
          pairJson: path.join(outputDir, "llm_first_pass_pair_queue.json"),
          pairJsonl: path.join(outputDir, "llm_first_pass_pair_queue.jsonl"),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (!skipDbSync) {
    await runQueueSync([
      "--mode",
      "llm-first-pass",
      "--sft-json",
      path.join(outputRoot, "llm_first_pass_sft_queue.json"),
      "--pair-json",
      path.join(outputRoot, "llm_first_pass_pair_queue.json"),
      "--sft-jsonl",
      path.join(outputRoot, "llm_first_pass_sft_queue.jsonl"),
      "--pair-jsonl",
      path.join(outputRoot, "llm_first_pass_pair_queue.jsonl"),
    ]);
  }

  console.log(
    `sft=${llmReviewedSft.length} pair=${llmReviewedPairs.length} output=${outputDir}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
