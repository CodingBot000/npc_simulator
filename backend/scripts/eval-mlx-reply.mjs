import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  getNumberOption,
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";

const DEFAULT_DATASET = "data/train/mlx_sft_compact/valid.jsonl";
const DEFAULT_MODEL = "mlx-community/Llama-3.1-8B-Instruct-4bit";
const DEFAULT_OUTPUT_DIR = "data/evals/mlx_reply";

function usage() {
  printUsage([
    "Usage: node scripts/eval-mlx-reply.mjs [options]",
    "",
    "Options:",
    `  --dataset <path>        evaluation dataset JSONL (default: ${DEFAULT_DATASET})`,
    `  --model <repo>          MLX model repo or local path (default: ${DEFAULT_MODEL})`,
    "  --adapter-path <path>   trained adapter directory to compare",
    `  --output-dir <path>     output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    "  --limit <n>             number of rows to evaluate (default: 5)",
    "  --help                  show this message",
  ]);
}

function extractDelimitedText(output) {
  const matches = [...String(output).matchAll(/==========\n([\s\S]*?)\n==========/g)];
  const text = matches.at(-1)?.[1]?.trim() ?? "";
  return text;
}

function safeExcerpt(text, length = 140) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > length
    ? `${normalized.slice(0, length - 1)}…`
    : normalized;
}

function countOverlap(a, b) {
  const left = new Set(
    String(a ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length > 1),
  );
  const right = new Set(
    String(b ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length > 1),
  );

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

async function runGenerate({ model, adapterPath, systemPrompt, prompt }) {
  const args = [
    ".venv/bin/mlx_lm.generate",
    "--model",
    model,
    "--system-prompt",
    systemPrompt,
    "--prompt",
    prompt,
    "--max-tokens",
    "160",
  ];

  if (adapterPath) {
    args.push("--adapter-path", adapterPath);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
      if (code === 0) {
        resolve({
          raw: stdout || stderr,
          text: extractDelimitedText(stdout || stderr),
        });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `generate failed with exit code ${code}`));
    });
  });
}

function classify(text) {
  const normalized = String(text ?? "");
  if (!normalized.trim()) {
    return "empty";
  }
  if (/^!+$/u.test(normalized.trim())) {
    return "collapsed";
  }
  return "ok";
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const datasetPath = getStringOption(options, "dataset", DEFAULT_DATASET);
  const model = getStringOption(options, "model", DEFAULT_MODEL);
  const adapterPath = getStringOption(options, "adapter-path", null);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const limit = getNumberOption(options, "limit", 5);

  if (!adapterPath) {
    throw new Error("--adapter-path is required.");
  }

  const rows = await loadJsonOrJsonl(datasetPath);
  const selectedRows = rows.slice(0, limit);
  const results = [];

  for (const [index, row] of selectedRows.entries()) {
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
    const prompt = messages.find((message) => message.role === "user")?.content ?? "";
    const expected = messages.find((message) => message.role === "assistant")?.content ?? "";

    const [base, tuned] = await Promise.all([
      runGenerate({ model, systemPrompt, prompt }),
      runGenerate({ model, adapterPath, systemPrompt, prompt }),
    ]);

    results.push({
      index: index + 1,
      promptExcerpt: safeExcerpt(prompt),
      expectedExcerpt: safeExcerpt(expected),
      base: {
        text: base.text,
        status: classify(base.text),
        overlapWithExpected: countOverlap(base.text, expected),
      },
      tuned: {
        text: tuned.text,
        status: classify(tuned.text),
        overlapWithExpected: countOverlap(tuned.text, expected),
      },
    });
  }

  const summary = {
    datasetPath,
    model,
    adapterPath,
    evaluated: results.length,
    baseOk: results.filter((entry) => entry.base.status === "ok").length,
    tunedOk: results.filter((entry) => entry.tuned.status === "ok").length,
    baseAverageOverlap:
      results.reduce((sum, entry) => sum + entry.base.overlapWithExpected, 0) /
      Math.max(results.length, 1),
    tunedAverageOverlap:
      results.reduce((sum, entry) => sum + entry.tuned.overlapWithExpected, 0) /
      Math.max(results.length, 1),
  };

  await fs.mkdir(path.resolve(process.cwd(), outputDir), { recursive: true });
  const outputPath = path.join(outputDir, "mlx_reply_eval.json");
  await writeJsonFile(outputPath, {
    generatedAt: new Date().toISOString(),
    summary,
    results,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        summary,
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
