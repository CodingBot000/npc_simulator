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
    "  --mode <build_sft|build_dpo|train_sft|train_dpo|derive_runtime>",
    "  --output-dir <path>           dataset build output directory",
    "  --dataset-dir <path>          dataset directory used by the trainer",
    "  --adapter-path <path>         adapter output directory",
    "  --runtime-artifact-path <path> runtime artifact output directory",
    "  --runtime-artifact-kind <kind> runtime artifact kind",
    "  --manifest-path <path>        training result manifest output path",
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

async function runTrainMode(
  mode,
  adapterPath,
  runtimeArtifactPath,
  runtimeArtifactKind,
  manifestPath,
  datasetDir,
  runId,
  referenceAdapterPath,
) {
  if (!adapterPath) {
    throw new Error("--adapter-path is required for train mode");
  }

  const fullAdapterPath = resolveProjectPath(adapterPath);
  const fullRuntimeArtifactPath = resolveProjectPath(
    runtimeArtifactPath ?? path.join(path.dirname(fullAdapterPath), "runtime"),
  );
  const fullManifestPath = resolveProjectPath(
    manifestPath ?? path.join(path.dirname(fullAdapterPath), "training-result.json"),
  );

  await fs.mkdir(fullAdapterPath, { recursive: true });
  await fs.mkdir(fullRuntimeArtifactPath, { recursive: true });
  await writeJsonFile(path.join(fullAdapterPath, "adapter_config.json"), {
    base_model_name_or_path: "Qwen/Qwen2.5-7B-Instruct",
    peft_type: "LORA",
    task_type: "CAUSAL_LM",
  });
  await fs.writeFile(path.join(fullAdapterPath, "adapter_model.safetensors"), "", "utf8");
  if (runtimeArtifactKind === "mlx_fused_model") {
    await writeJsonFile(path.join(fullRuntimeArtifactPath, "config.json"), {
      model_type: "qwen2",
      runtimeKind: runtimeArtifactKind,
    });
  } else {
    await writeJsonFile(path.join(fullRuntimeArtifactPath, "adapter_config.json"), {
      model: "mlx-community/Qwen2.5-7B-Instruct-4bit",
      fine_tune_type: "lora",
    });
    await fs.writeFile(path.join(fullRuntimeArtifactPath, "adapters.safetensors"), "", "utf8");
  }
  await writeJsonFile(fullManifestPath, {
    generatedAt: new Date().toISOString(),
    mode,
    runId: runId ?? null,
    datasetDir: datasetDir ?? null,
    referenceAdapterPath: referenceAdapterPath ?? null,
    canonicalArtifact: {
      kind: "peft_adapter",
      path: fullAdapterPath,
    },
    runtimeArtifact: {
      kind: runtimeArtifactKind ?? "legacy_mlx_adapter",
      path: fullRuntimeArtifactPath,
    },
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
  const runtimeArtifactPath = getStringOption(options, "runtime-artifact-path", null);
  const runtimeArtifactKind = getStringOption(options, "runtime-artifact-kind", null);
  const manifestPath = getStringOption(options, "manifest-path", null);
  const runId = getStringOption(options, "run-id", null);
  const snapshotId = getStringOption(options, "snapshot-id", null);
  const referenceAdapterPath = getStringOption(options, "reference-adapter-path", null);

  if (!mode) {
    throw new Error("--mode is required");
  }

  if (mode === "build_sft" || mode === "build_dpo") {
    await runBuildMode(mode, outputDir, snapshotId);
  } else if (mode === "train_sft" || mode === "train_dpo" || mode === "derive_runtime") {
    await runTrainMode(
      mode,
      adapterPath,
      runtimeArtifactPath,
      runtimeArtifactKind,
      manifestPath,
      datasetDir,
      runId,
      referenceAdapterPath,
    );
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
