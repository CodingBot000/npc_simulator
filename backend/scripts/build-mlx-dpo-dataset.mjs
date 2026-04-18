import fs from "node:fs/promises";
import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  resolveProjectPath,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import { closeDbPool, loadSnapshotRowsFromDb } from "./_db-runtime.mjs";

const DEFAULT_INPUT = "data/train/preference/live/final_preference_pairs.jsonl";
const DEFAULT_OUTPUT_DIR = "data/train/mlx_dpo";
const DEFAULT_VALID_RATIO = 10;
const DEFAULT_SYSTEM_PROMPT =
  "해저연구소 생존 협상 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 설명문, 요약문, 해설, JSON, 목록, 라벨(예: '엔지니어:', 'response:')은 금지한다. 플레이어 또는 다른 NPC에게 지금 이 자리에서 바로 말하듯 한 단락의 한국어 대사만 말한다.";

const NPC_STYLE_HINTS = {
  engineer:
    "직선적이고 거칠다. 관리직 책임 회피를 싫어하고 현장 단어를 자주 쓴다. 공손체보다 반말/직설체에 가깝다.",
  doctor:
    "차분하지만 죄책감이 배어 있다. 윤리와 기록을 중시한다. 설교문보다 사람을 향한 직접 발화로 말한다.",
  supervisor:
    "감정을 눌러 말한다. 법적 책임, 비용, 대체 가능성을 기준으로 자른다. 군더더기 없이 차갑게 말한다.",
  director:
    "짧게 끊어 말하고 권위를 지키려 한다. 조직, 승인, 통제 계통을 중시한다. 훈계문보다 통제하는 대사처럼 말한다.",
};

function usage() {
  printUsage([
    "Usage: node scripts/build-mlx-dpo-dataset.mjs [options]",
    "",
    "  --snapshot-id <id>     source active/explicit DB snapshot id for preference rows",
    `  --input <path>         finalized preference JSONL input (default: ${DEFAULT_INPUT})`,
    `  --output-dir <path>    output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    `  --valid-ratio <n>      validation split percent 0-50 (default: ${DEFAULT_VALID_RATIO})`,
    "  --help                 show this message",
  ]);
}

function hashFragment(value) {
  return Array.from(String(value ?? "")).reduce(
    (hash, character) => ((hash * 33) ^ character.charCodeAt(0)) >>> 0,
    5381,
  );
}

function buildCompactInput(promptBundle) {
  const npcId = promptBundle?.npcId ?? null;

  return {
    scenarioId: promptBundle?.scenarioId ?? null,
    turnIndex: promptBundle?.turnIndex ?? null,
    npcId,
    targetNpcId: promptBundle?.targetNpcId ?? null,
    npcStyleHint: npcId ? (NPC_STYLE_HINTS[npcId] ?? null) : null,
    playerText: promptBundle?.playerText ?? null,
    normalizedInputSummary: promptBundle?.normalizedInputSummary ?? null,
    promptContextSummary: promptBundle?.promptContextSummary ?? null,
  };
}

function buildPromptMessages(promptBundle) {
  return [
    {
      role: "system",
      content: DEFAULT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "다음은 NPC 응답 생성 입력이다.",
        "입력 JSON:",
        JSON.stringify(buildCompactInput(promptBundle), null, 2),
        "출력 규칙:",
        "- 지금 이 자리에서 바로 내뱉는 대사만 말한다.",
        "- 화자 라벨, 설명, 요약, JSON, 메타 발언을 쓰지 않는다.",
      ].join("\n"),
    },
  ];
}

function buildRow(pair) {
  if (
    !pair ||
    typeof pair !== "object" ||
    typeof pair.pairId !== "string" ||
    !pair.promptBundle
  ) {
    throw new Error("Encountered an invalid preference pair row.");
  }

  const chosenReply = pair.chosen?.candidateOutput?.replyText;
  const rejectedReply = pair.rejected?.candidateOutput?.replyText;

  if (
    typeof chosenReply !== "string" ||
    !chosenReply.trim() ||
    typeof rejectedReply !== "string" ||
    !rejectedReply.trim()
  ) {
    throw new Error(`Pair ${pair.pairId} is missing chosen/rejected replyText.`);
  }

  return {
    pairId: pair.pairId,
    promptMessages: buildPromptMessages(pair.promptBundle),
    chosen: chosenReply.trim(),
    rejected: rejectedReply.trim(),
    metadata: {
      datasetVersion: pair.datasetVersion ?? null,
      strategyLabel: pair.metadata?.strategyLabel ?? null,
      weightedGap: pair.metadata?.weightedGap ?? null,
      preferenceStrength: pair.metadata?.preferenceStrength ?? null,
      parentHumanReviewStatus: pair.metadata?.humanReviewStatus ?? null,
    },
  };
}

async function writeJsonl(filePath, rows) {
  const fullPath = resolveProjectPath(filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(
    fullPath,
    rows.map((entry) => JSON.stringify(entry)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const inputPath = getStringOption(options, "input", DEFAULT_INPUT);
  const snapshotId = getNumberOption(options, "snapshot-id", null);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const validRatio = getNumberOption(options, "valid-ratio", DEFAULT_VALID_RATIO);

  if (validRatio < 0 || validRatio > 50) {
    throw new Error("--valid-ratio must be between 0 and 50.");
  }

  const rawPairs = snapshotId
    ? (
        await loadSnapshotRowsFromDb({
          kind: "preference",
          snapshotId,
        })
      ).rows
    : await loadJsonOrJsonl(inputPath);
  const rows = rawPairs.map(buildRow);
  const trainRows = [];
  const validRows = [];

  for (const row of rows) {
    const bucket = hashFragment(row.pairId) % 100;
    if (bucket < validRatio) {
      validRows.push(row);
    } else {
      trainRows.push(row);
    }
  }

  if (!trainRows.length) {
    throw new Error("No train rows were generated for the DPO dataset.");
  }

  const trainOutput = path.join(outputDir, "train.jsonl");
  const validOutput = path.join(outputDir, "valid.jsonl");
  const manifestOutput = path.join(outputDir, "manifest.json");

  await writeJsonl(trainOutput, trainRows);
  await writeJsonl(validOutput, validRows);
  await writeJsonFile(manifestOutput, {
    generatedAt: new Date().toISOString(),
    sourceInput: snapshotId ? `db:npc_dataset_snapshot:${snapshotId}` : inputPath,
    sourceSnapshotId: snapshotId ?? null,
    validRatio,
    counts: {
      train: trainRows.length,
      valid: validRows.length,
      total: trainRows.length + validRows.length,
    },
    outputFiles: {
      train: trainOutput,
      valid: validOutput,
      manifest: manifestOutput,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir,
        counts: {
          train: trainRows.length,
          valid: validRows.length,
          total: trainRows.length + validRows.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
