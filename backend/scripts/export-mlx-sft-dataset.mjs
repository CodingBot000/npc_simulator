import fs from "node:fs/promises";
import path from "node:path";
import {
  getStringOption,
  parseCommaSeparatedOption,
  parseCliArgs,
  printUsage,
  resolveProjectPath,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";

const DEFAULT_TRAIN_INPUT = "data/train/sft/live/final_sft_train.jsonl";
const DEFAULT_VALID_INPUT = "data/train/sft/live/final_sft_dev.jsonl";
const DEFAULT_OUTPUT_DIR = "data/train/mlx_sft";
const DEFAULT_INPUT_FORMAT = "full_json";
const DEFAULT_ASSISTANT_FORMAT = "full_json";
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
const DEFAULT_REPLY_ONLY_SYSTEM_PROMPT =
  "해저연구소 생존 협상 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 설명문, 요약문, 해설, JSON, 목록, 라벨(예: '엔지니어:', 'response:')은 금지한다. 플레이어 또는 다른 NPC에게 지금 이 자리에서 바로 말하듯 한 단락의 한국어 대사만 말한다.";

function usage() {
  printUsage([
    "Usage: node scripts/export-mlx-sft-dataset.mjs [options]",
    "",
    "Options:",
    `  --train-input <path>   source train JSONL (default: ${DEFAULT_TRAIN_INPUT})`,
    `  --valid-input <path>   source valid JSONL (default: ${DEFAULT_VALID_INPUT})`,
    `  --output-dir <path>    output directory for MLX chat JSONL files (default: ${DEFAULT_OUTPUT_DIR})`,
    `  --input-format <mode>  full_json or compact (default: ${DEFAULT_INPUT_FORMAT})`,
    `  --assistant-format <mode> full_json or reply_text (default: ${DEFAULT_ASSISTANT_FORMAT})`,
    "  --system-prompt <text>  override system prompt for all rows",
    "  --help                 show this message",
  ]);
}

async function readJsonl(filePath) {
  const fullPath = resolveProjectPath(filePath);
  const raw = await fs.readFile(fullPath, "utf8");

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Failed to parse JSONL line ${index + 1} in ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
}

async function readJsonlInputs(inputValue, fallbackPath) {
  const inputPaths = parseCommaSeparatedOption(inputValue || fallbackPath);
  const rows = [];
  for (const inputPath of inputPaths) {
    rows.push(...(await readJsonl(inputPath)));
  }
  return {
    inputPaths,
    rows,
  };
}

function buildCompactInput(row) {
  const input = row.input ?? {};
  const npcId = input.npcId ?? null;

  return {
    scenarioId: input.scenarioId ?? null,
    turnIndex: input.turnIndex ?? null,
    npcId,
    targetNpcId: input.targetNpcId ?? null,
    npcStyleHint: npcId ? (NPC_STYLE_HINTS[npcId] ?? null) : null,
    playerText: input.playerText ?? null,
    normalizedInputSummary: input.normalizedInputSummary ?? null,
    promptContextSummary: input.promptContextSummary ?? null,
  };
}

function buildUserContent(row, inputFormat) {
  const userPayload =
    inputFormat === "compact"
      ? buildCompactInput(row)
      : (row.input ?? {});

  return [
    "다음은 NPC 응답 생성 입력이다.",
    "입력 JSON:",
    JSON.stringify(userPayload, null, 2),
    "출력 규칙:",
    "- 지금 이 자리에서 바로 내뱉는 대사만 말한다.",
    "- 화자 라벨, 설명, 요약, JSON, 메타 발언을 쓰지 않는다.",
  ].join("\n");
}

function buildAssistantContent(row, assistantFormat) {
  if (assistantFormat === "reply_text") {
    const replyText = row.assistant?.replyText;
    if (typeof replyText !== "string" || !replyText.trim()) {
      throw new Error(`Missing assistant.replyText for row ${row.rowId ?? "unknown"}.`);
    }
    return replyText.trim();
  }

  return JSON.stringify(row.assistant ?? {}, null, 2);
}

function resolveInstruction(row, assistantFormat, systemPromptOverride) {
  if (systemPromptOverride) {
    return systemPromptOverride;
  }

  if (assistantFormat === "reply_text") {
    return DEFAULT_REPLY_ONLY_SYSTEM_PROMPT;
  }

  return typeof row.instruction === "string" && row.instruction.trim()
    ? row.instruction.trim()
    : "주어진 입력을 바탕으로 한국어 NPC 응답과 구조화된 JSON을 생성한다.";
}

function convertRow(row, inputFormat, assistantFormat, systemPromptOverride) {
  if (!row || typeof row !== "object") {
    throw new Error("Encountered a non-object SFT row.");
  }

  const instruction = resolveInstruction(
    row,
    assistantFormat,
    systemPromptOverride,
  );

  return {
    messages: [
      {
        role: "system",
        content: instruction,
      },
      {
        role: "user",
        content: buildUserContent(row, inputFormat),
      },
      {
        role: "assistant",
        content: buildAssistantContent(row, assistantFormat),
      },
    ],
  };
}

async function writeJsonl(filePath, rows) {
  const fullPath = resolveProjectPath(filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(fullPath, body ? `${body}\n` : "", "utf8");
  return fullPath;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const trainInput = getStringOption(options, "train-input", DEFAULT_TRAIN_INPUT);
  const validInput = getStringOption(options, "valid-input", DEFAULT_VALID_INPUT);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const inputFormat = getStringOption(options, "input-format", DEFAULT_INPUT_FORMAT);
  const assistantFormat = getStringOption(
    options,
    "assistant-format",
    DEFAULT_ASSISTANT_FORMAT,
  );
  const systemPromptOverride = getStringOption(options, "system-prompt", null);

  if (!["full_json", "compact"].includes(inputFormat)) {
    throw new Error(`Invalid --input-format '${inputFormat}'. Use full_json or compact.`);
  }

  if (!["full_json", "reply_text"].includes(assistantFormat)) {
    throw new Error(
      `Invalid --assistant-format '${assistantFormat}'. Use full_json or reply_text.`,
    );
  }

  const [trainResult, validResult] = await Promise.all([
    readJsonlInputs(trainInput, DEFAULT_TRAIN_INPUT),
    readJsonlInputs(validInput, DEFAULT_VALID_INPUT),
  ]);
  const trainRows = trainResult.rows;
  const validRows = validResult.rows;

  const convertedTrainRows = trainRows.map((row) =>
    convertRow(row, inputFormat, assistantFormat, systemPromptOverride),
  );
  const convertedValidRows = validRows.map((row) =>
    convertRow(row, inputFormat, assistantFormat, systemPromptOverride),
  );

  const trainOutput = path.join(outputDir, "train.jsonl");
  const validOutput = path.join(outputDir, "valid.jsonl");
  const manifestOutput = path.join(outputDir, "manifest.json");

  await writeJsonl(trainOutput, convertedTrainRows);
  await writeJsonl(validOutput, convertedValidRows);
  await writeJsonFile(manifestOutput, {
    format: "mlx-lm-chat",
    inputFormat,
    assistantFormat,
    systemPrompt:
      systemPromptOverride ??
      (assistantFormat === "reply_text" ? DEFAULT_REPLY_ONLY_SYSTEM_PROMPT : null),
    trainInputPaths: trainResult.inputPaths,
    validInputPaths: validResult.inputPaths,
    trainOutput,
    validOutput,
    counts: {
      train: convertedTrainRows.length,
      valid: convertedValidRows.length,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir,
        counts: {
          train: convertedTrainRows.length,
          valid: convertedValidRows.length,
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
});
