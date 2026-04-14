import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import { writeJsonLines } from "./_quality-judge-helpers.mjs";

const DEFAULT_BASE_TRAIN = "data/train/sft/live/final_sft_train.jsonl";
const DEFAULT_BASE_VALID = "data/train/sft/live/final_sft_dev.jsonl";
const DEFAULT_PREFERENCE = "data/train/preference/live/final_preference_pairs.jsonl";
const DEFAULT_OUTPUT_DIR = "data/train/mlx_sft_reply50";
const REPLY_SYSTEM_PROMPT =
  "해저연구소 생존 협상 NPC로서 주어진 상태와 근거를 사용해 한국어로 자연스럽게 답한다.";

function usage() {
  printUsage([
    "Usage: node scripts/build-mlx-reply50-dataset.mjs [options]",
    "",
    "Options:",
    `  --base-train <path>     finalized SFT train rows (default: ${DEFAULT_BASE_TRAIN})`,
    `  --base-valid <path>     finalized SFT valid rows (default: ${DEFAULT_BASE_VALID})`,
    `  --preference <path>     finalized preference pairs (default: ${DEFAULT_PREFERENCE})`,
    `  --output-dir <path>     output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    "  --target-train <n>      target number of training rows (default: 45)",
    "  --help                  show this message",
  ]);
}

function compactInputPayload(input) {
  return {
    scenarioId: input?.scenarioId ?? null,
    turnIndex: input?.turnIndex ?? null,
    npcId: input?.npcId ?? null,
    targetNpcId: input?.targetNpcId ?? null,
    playerText: input?.playerText ?? null,
    normalizedInputSummary: input?.normalizedInputSummary ?? null,
    promptContextSummary: input?.promptContextSummary ?? null,
  };
}

function buildChatRow(input, replyText) {
  return {
    messages: [
      {
        role: "system",
        content: REPLY_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          "다음은 NPC 응답 생성 입력이다.",
          "입력 JSON:",
          JSON.stringify(compactInputPayload(input), null, 2),
        ].join("\n"),
      },
      {
        role: "assistant",
        content: String(replyText ?? "").trim(),
      },
    ],
  };
}

function buildBaseExample(row) {
  return {
    id: row.rowId,
    sourceType: "base_sft",
    score: row.curation?.weightedJudgeScore ?? row.curation?.judgeConfidence ?? 0,
    row: buildChatRow(row.input, row.assistant?.replyText ?? ""),
  };
}

function buildPreferenceExample(pair, kind) {
  const candidate = pair?.[kind];
  if (!candidate?.candidateOutput?.replyText) {
    return null;
  }

  return {
    id: `${pair.pairId}:${kind}`,
    sourceType: `preference_${kind}`,
    rowId: candidate.rowId ?? null,
    score: candidate.scores?.weightedScore ?? 0,
    row: buildChatRow(pair.promptBundle, candidate.candidateOutput.replyText),
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const baseTrainPath = getStringOption(options, "base-train", DEFAULT_BASE_TRAIN);
  const baseValidPath = getStringOption(options, "base-valid", DEFAULT_BASE_VALID);
  const preferencePath = getStringOption(options, "preference", DEFAULT_PREFERENCE);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const targetTrain = getNumberOption(options, "target-train", 45);

  const [baseTrainRows, baseValidRows, preferencePairs] = await Promise.all([
    loadJsonOrJsonl(baseTrainPath),
    loadJsonOrJsonl(baseValidPath),
    loadJsonOrJsonl(preferencePath),
  ]);

  const baseTrainExamples = baseTrainRows.map(buildBaseExample);
  const baseValidExamples = baseValidRows.map(buildBaseExample);
  const baseRowIds = new Set(
    [...baseTrainRows, ...baseValidRows]
      .map((row) => row.rowId)
      .filter(Boolean),
  );

  const weightedChosenExamples = preferencePairs
    .map((pair) => buildPreferenceExample(pair, "chosen"))
    .filter(Boolean);

  const novelPreferenceExamples = [];
  const seenNovelRowIds = new Set();
  for (const pair of preferencePairs) {
    for (const kind of ["chosen", "rejected"]) {
      const example = buildPreferenceExample(pair, kind);
      if (!example?.rowId || baseRowIds.has(example.rowId) || seenNovelRowIds.has(example.rowId)) {
        continue;
      }
      seenNovelRowIds.add(example.rowId);
      novelPreferenceExamples.push(example);
    }
  }
  novelPreferenceExamples.sort((left, right) => right.score - left.score);

  const trainExamples = [...baseTrainExamples];

  for (const example of weightedChosenExamples) {
    if (trainExamples.length >= targetTrain) {
      break;
    }
    trainExamples.push(example);
  }

  for (const example of novelPreferenceExamples) {
    if (trainExamples.length >= targetTrain) {
      break;
    }
    trainExamples.push(example);
  }

  if (trainExamples.length < targetTrain) {
    const rejectedFallback = preferencePairs
      .map((pair) => buildPreferenceExample(pair, "rejected"))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    for (const example of rejectedFallback) {
      if (trainExamples.length >= targetTrain) {
        break;
      }
      trainExamples.push(example);
    }
  }

  const trainOutput = path.join(outputDir, "train.jsonl");
  const validOutput = path.join(outputDir, "valid.jsonl");
  const manifestOutput = path.join(outputDir, "manifest.json");

  await writeJsonLines(
    trainOutput,
    trainExamples.map((entry) => entry.row),
  );
  await writeJsonLines(
    validOutput,
    baseValidExamples.map((entry) => entry.row),
  );
  await writeJsonFile(manifestOutput, {
    format: "mlx-lm-chat",
    systemPrompt: REPLY_SYSTEM_PROMPT,
    targetTrain,
    counts: {
      train: trainExamples.length,
      valid: baseValidExamples.length,
      total: trainExamples.length + baseValidExamples.length,
    },
    composition: trainExamples.reduce((counts, entry) => {
      counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;
      return counts;
    }, {}),
    sources: {
      baseTrainPath,
      baseValidPath,
      preferencePath,
    },
    notes: [
      "base_sft rows are the finalized SFT training rows",
      "preference_chosen rows act as weighted replay samples to reinforce preferred reply style",
      "novel preference rows are prompts not present in finalized SFT and increase prompt coverage",
    ],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir,
        counts: {
          train: trainExamples.length,
          valid: baseValidExamples.length,
          total: trainExamples.length + baseValidExamples.length,
        },
        composition: trainExamples.reduce((counts, entry) => {
          counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;
          return counts;
        }, {}),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
