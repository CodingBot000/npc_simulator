import fs from "node:fs/promises";
import path from "node:path";
import {
  getStringOption,
  parseCliArgs,
  printUsage,
  resolveProjectPath,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";

function usage() {
  printUsage([
    "Usage: node scripts/mock-training-run.mjs [options]",
    "",
    "Options:",
    "  --mode <build_sft|build_dpo|train_sft|train_dpo>",
    "  --output-dir <path>           dataset build output directory",
    "  --dataset-dir <path>          dataset directory used by the trainer",
    "  --adapter-path <path>         adapter output directory",
    "  --run-id <value>              training run id",
    "  --snapshot-id <value>         optional source snapshot id",
    "  --reference-adapter-path <path> optional DPO parent adapter path",
    "  --help                        show this message",
  ]);
}

async function writeJsonl(filePath, rows) {
  const fullPath = resolveProjectPath(filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(fullPath, body ? `${body}\n` : "", "utf8");
}

async function runBuildMode(mode, outputDir, snapshotId) {
  if (!outputDir) {
    throw new Error("--output-dir is required for build mode");
  }

  const trainRows = [
    {
      messages: [
        { role: "system", content: "mock system" },
        { role: "user", content: `mock input for ${mode}` },
        { role: "assistant", content: "mock reply" },
      ],
    },
  ];
  const validRows = [
    {
      messages: [
        { role: "system", content: "mock system" },
        { role: "user", content: `mock valid input for ${mode}` },
        { role: "assistant", content: "mock valid reply" },
      ],
    },
  ];

  await writeJsonl(path.join(outputDir, "train.jsonl"), trainRows);
  await writeJsonl(path.join(outputDir, "valid.jsonl"), validRows);
  await writeJsonFile(path.join(resolveProjectPath(outputDir), "manifest.json"), {
    generatedAt: new Date().toISOString(),
    mode,
    sourceSnapshotId: snapshotId ?? null,
    counts: {
      train: trainRows.length,
      valid: validRows.length,
      total: trainRows.length + validRows.length,
    },
    outputFiles: {
      train: path.join(outputDir, "train.jsonl"),
      valid: path.join(outputDir, "valid.jsonl"),
      manifest: path.join(outputDir, "manifest.json"),
    },
  });
}

async function runTrainMode(mode, adapterPath, datasetDir, runId, referenceAdapterPath) {
  if (!adapterPath) {
    throw new Error("--adapter-path is required for train mode");
  }

  const fullAdapterPath = resolveProjectPath(adapterPath);
  await fs.mkdir(fullAdapterPath, { recursive: true });
  await writeJsonFile(path.join(fullAdapterPath, "training-result.json"), {
    generatedAt: new Date().toISOString(),
    mode,
    runId: runId ?? null,
    datasetDir: datasetDir ?? null,
    referenceAdapterPath: referenceAdapterPath ?? null,
    status: "succeeded",
  });
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const mode = getStringOption(options, "mode", null);
  const outputDir = getStringOption(options, "output-dir", null);
  const datasetDir = getStringOption(options, "dataset-dir", null);
  const adapterPath = getStringOption(options, "adapter-path", null);
  const runId = getStringOption(options, "run-id", null);
  const snapshotId = getStringOption(options, "snapshot-id", null);
  const referenceAdapterPath = getStringOption(options, "reference-adapter-path", null);

  if (!mode) {
    throw new Error("--mode is required");
  }

  if (mode === "build_sft" || mode === "build_dpo") {
    await runBuildMode(mode, outputDir, snapshotId);
  } else if (mode === "train_sft" || mode === "train_dpo") {
    await runTrainMode(mode, adapterPath, datasetDir, runId, referenceAdapterPath);
  } else {
    throw new Error(`Unsupported --mode '${mode}'`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode,
        outputDir,
        adapterPath,
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
