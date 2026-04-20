import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  ReviewTrainingKind,
  ReviewTrainingPreflightView,
  ReviewTrainingRuntimeArtifactKind,
  ReviewTrainingRunView,
  ReviewTrainingStatusView,
} from "@/lib/review-types";
import { PROJECT_ROOT } from "@server/config";
import { getReviewFinalizeStatus } from "./finalize";
import {
  appendTrainingRunEventInDb,
  appendTrainingRunLogChunkInDb,
  createTrainingRunInDb,
  getActiveSnapshotSummary,
  getLatestSuccessfulTrainingRun,
  getTrainingRunByFingerprint,
  getTrainingRunSpecFromDb,
  getTrainingStatusFromDb,
  registerTrainingArtifactInDb,
  updateTrainingRunStateInDb,
} from "@server/db/review-db";

const TRAIN_RUNS_DIR = path.join(PROJECT_ROOT, "data", "train", "runs");
const TRAIN_OUTPUTS_DIR = path.join(PROJECT_ROOT, "outputs", "training");
const WORKER_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "review-training-worker.ts",
);
const TSX_BINARY_PATH = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const PYTHON_BINARY_PATH = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const EXPORT_MLX_SFT_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "export-mlx-sft-dataset.mjs",
);
const BUILD_MLX_DPO_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "build-mlx-dpo-dataset.mjs",
);
const TRAIN_PEFT_DPO_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "train-peft-dpo.py",
);
const TRAIN_PEFT_SFT_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "train-peft-sft.py",
);
const DERIVE_MLX_RUNTIME_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "derive-mlx-runtime-from-peft.py",
);

const TRAINING_BASE_MODEL =
  process.env.CANONICAL_TRAINING_BASE_MODEL || "Qwen/Qwen2.5-7B-Instruct";
const SFT_TRAINING_ARGS = {
  batchSize: Number(process.env.LOCAL_TRAINING_SFT_BATCH_SIZE || "1"),
  iters: Number(process.env.LOCAL_TRAINING_SFT_ITERS || "40"),
  learningRate: process.env.LOCAL_TRAINING_SFT_LEARNING_RATE || "1e-6",
  numLayers: Number(process.env.LOCAL_TRAINING_SFT_NUM_LAYERS || "2"),
  stepsPerReport: Number(process.env.LOCAL_TRAINING_SFT_STEPS_PER_REPORT || "10"),
  stepsPerEval: Number(process.env.LOCAL_TRAINING_SFT_STEPS_PER_EVAL || "10"),
  saveEvery: Number(process.env.LOCAL_TRAINING_SFT_SAVE_EVERY || "20"),
  maxSeqLength: Number(process.env.LOCAL_TRAINING_SFT_MAX_SEQ_LENGTH || "2048"),
};
const DPO_TRAINING_ARGS = {
  batchSize: Number(process.env.LOCAL_TRAINING_DPO_BATCH_SIZE || "1"),
  iters: Number(process.env.LOCAL_TRAINING_DPO_ITERS || "30"),
  learningRate: process.env.LOCAL_TRAINING_DPO_LEARNING_RATE || "5e-7",
  numLayers: Number(process.env.LOCAL_TRAINING_DPO_NUM_LAYERS || "2"),
  stepsPerReport: Number(process.env.LOCAL_TRAINING_DPO_STEPS_PER_REPORT || "5"),
  stepsPerEval: Number(process.env.LOCAL_TRAINING_DPO_STEPS_PER_EVAL || "10"),
  saveEvery: Number(process.env.LOCAL_TRAINING_DPO_SAVE_EVERY || "10"),
  beta: process.env.LOCAL_TRAINING_DPO_BETA || "0.1",
  maxSeqLength: Number(process.env.LOCAL_TRAINING_DPO_MAX_SEQ_LENGTH || "2048"),
};

interface SnapshotSummary {
  snapshotId: number;
  datasetVersion: string | null;
  fingerprint: string | null;
  manifestPath: string | null;
  rowCount: number;
  generatedAt: string | null;
}

interface TrainingRunSpec {
  runUid: string;
  kind: ReviewTrainingKind;
  fingerprint: string;
  sourceFingerprint: string;
  sourceSnapshotId: number | null;
  sourceDatasetVersion: string | null;
  parentRunUid: string | null;
  baseModel: string;
  datasetDir: string;
  outputRootDir: string;
  adapterPath: string;
  runtimeArtifactPath: string;
  runtimeArtifactKind: ReviewTrainingRuntimeArtifactKind;
  trainingResultPath: string;
  logPath: string;
  commands: {
    build: {
      command: string;
      args: string[];
    };
    train: {
      command: string;
      args: string[];
    };
    derive: {
      command: string;
      args: string[];
    };
  };
}

type TrainingArtifactSpec = {
  runUid?: string;
  runId?: string;
  kind: ReviewTrainingKind;
  sourceDatasetVersion: string | null;
  sourceFingerprint: string;
  baseModel: string;
  datasetDir: string;
  adapterPath: string;
  runtimeArtifactPath: string;
  runtimeArtifactKind: ReviewTrainingRuntimeArtifactKind;
  outputRootDir: string;
  trainingResultPath: string;
};

function trainingRunId(spec: TrainingArtifactSpec) {
  return spec.runUid ?? spec.runId ?? "unknown-run";
}

function trainingArtifactMetadata(spec: TrainingArtifactSpec, artifactPhase: string) {
  return {
    runId: trainingRunId(spec),
    kind: spec.kind,
    artifactPhase,
    baseModel: spec.baseModel,
    sourceDatasetVersion: spec.sourceDatasetVersion,
    sourceFingerprint: spec.sourceFingerprint,
    canonicalAdapterPath: spec.adapterPath,
    runtimeArtifactPath: spec.runtimeArtifactPath,
    runtimeArtifactKind: spec.runtimeArtifactKind,
  };
}

async function registerDatasetArtifacts(spec: TrainingArtifactSpec) {
  const manifestPath = path.join(spec.datasetDir, "manifest.json");
  const trainPath = path.join(spec.datasetDir, "train.jsonl");
  const validPath = path.join(spec.datasetDir, "valid.jsonl");
  const metadata = trainingArtifactMetadata(spec, "dataset_build");

  await registerTrainingArtifactInDb({
    runUid: spec.runUid,
    artifactKind: "dataset_manifest",
    filePath: manifestPath,
    metadata,
  });
  await registerTrainingArtifactInDb({
    runUid: spec.runUid,
    artifactKind: "dataset_train",
    filePath: trainPath,
    metadata,
  });
  await registerTrainingArtifactInDb({
    runUid: spec.runUid,
    artifactKind: "dataset_valid",
    filePath: validPath,
    metadata,
  });
}

async function registerTrainingOutputArtifacts(spec: TrainingArtifactSpec) {
  const metadata = trainingArtifactMetadata(spec, "training_output");

  await registerTrainingArtifactInDb({
    runUid: spec.runUid,
    artifactKind: "canonical_adapter_output",
    filePath: spec.adapterPath,
    metadata: {
      ...metadata,
      adapterVersion: trainingRunId(spec),
    },
  });
  await registerTrainingArtifactInDb({
    runUid: spec.runUid,
    artifactKind: "runtime_artifact_output",
    filePath: spec.runtimeArtifactPath,
    metadata: metadata,
  });
  await registerTrainingArtifactInDb({
    runUid: spec.runUid,
    artifactKind: "training_result_manifest",
    filePath: spec.trainingResultPath,
    metadata: trainingArtifactMetadata(spec, "training_result_manifest"),
  });
}

async function pathExists(targetPath: string) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasVenvModule(moduleName: string) {
  const libRoot = path.join(PROJECT_ROOT, ".venv", "lib");
  let pythonDirs: string[] = [];
  try {
    pythonDirs = await fsp.readdir(libRoot);
  } catch {
    return false;
  }

  for (const pythonDir of pythonDirs) {
    const sitePackages = path.join(libRoot, pythonDir, "site-packages");
    if (
      (await pathExists(path.join(sitePackages, moduleName))) ||
      (await pathExists(path.join(sitePackages, `${moduleName}.py`)))
    ) {
      return true;
    }
  }

  return false;
}

async function collectMissingPythonModules(moduleNames: string[]) {
  const checks = await Promise.all(
    moduleNames.map(async (moduleName) => ({
      moduleName,
      installed: await hasVenvModule(moduleName),
    })),
  );
  return checks.filter((entry) => !entry.installed).map((entry) => entry.moduleName);
}

function fingerprintSpec(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function commandToString(command: string, args: string[]) {
  return [command, ...args]
    .map((entry) => (/\s/u.test(entry) ? JSON.stringify(entry) : entry))
    .join(" ");
}

function buildEmptyPreflight(kind: ReviewTrainingKind): ReviewTrainingPreflightView {
  return {
    kind,
    canStart: false,
    alreadyTrained: false,
    duplicateRunId: null,
    parentRunId: null,
    adapterPath: null,
    blockingIssues: [],
    dataset: {
      exists: false,
      manifestPath: null,
      datasetVersion: null,
      fingerprint: null,
      rowCount: null,
    },
  };
}

async function getFinalizeBlockingIssues() {
  const finalizeStatus = await getReviewFinalizeStatus();

  if (finalizeStatus.pending.total > 0) {
    return ["먼저 사람 검수를 끝내고 finalize를 실행해야 합니다."];
  }

  if (finalizeStatus.canFinalize) {
    return ["review 변경사항이 있어 finalize를 다시 실행해야 합니다."];
  }

  const [sftSnapshot, preferenceSnapshot] = await Promise.all([
    getActiveSnapshotSummary("sft"),
    getActiveSnapshotSummary("preference"),
  ]);
  const hasImportedSnapshots =
    Boolean(sftSnapshot?.rowCount) || Boolean(preferenceSnapshot?.rowCount);

  if (finalizeStatus.state === "succeeded" || hasImportedSnapshots) {
    return [];
  }

  return ["먼저 finalize를 실행해 최신 학습 데이터셋을 만들어야 합니다."];
}

async function getSnapshot(kind: "sft" | "preference"): Promise<SnapshotSummary | null> {
  const snapshot = await getActiveSnapshotSummary(kind);

  if (!snapshot || !snapshot.fingerprint) {
    return null;
  }

  return {
    snapshotId: snapshot.snapshotId,
    datasetVersion: snapshot.datasetVersion,
    fingerprint: snapshot.fingerprint,
    manifestPath: snapshot.manifestPath,
    rowCount: snapshot.rowCount,
    generatedAt: snapshot.generatedAt,
  };
}

async function buildSftPreflight(): Promise<ReviewTrainingPreflightView> {
  const preflight = buildEmptyPreflight("sft");
  const blockingIssues = await getFinalizeBlockingIssues();
  const dataset = await getSnapshot("sft");

  preflight.dataset = {
    exists: Boolean(dataset),
    manifestPath: dataset?.manifestPath ?? null,
    datasetVersion: dataset?.datasetVersion ?? null,
    fingerprint: dataset?.fingerprint ?? null,
    rowCount: dataset?.rowCount ?? null,
  };

  if (!(await pathExists(PYTHON_BINARY_PATH))) {
    blockingIssues.push("`.venv/bin/python`이 없어 PEFT SFT 학습을 실행할 수 없습니다.");
  }
  if (!(await pathExists(TSX_BINARY_PATH)) || !(await pathExists(WORKER_SCRIPT_PATH))) {
    blockingIssues.push("training worker 실행 파일이 없어 SFT 학습을 시작할 수 없습니다.");
  }
  if (!(await pathExists(TRAIN_PEFT_SFT_SCRIPT_PATH))) {
    blockingIssues.push("PEFT SFT trainer 스크립트가 없습니다.");
  }
  if (!(await pathExists(DERIVE_MLX_RUNTIME_SCRIPT_PATH))) {
    blockingIssues.push("MLX runtime 파생 스크립트가 없습니다.");
  }
  const missingModules = await collectMissingPythonModules([
    "torch",
    "transformers",
    "peft",
    "datasets",
    "mlx_lm",
  ]);
  if (missingModules.length > 0) {
    blockingIssues.push(
      `PEFT/MLX 학습 의존성이 없습니다: ${missingModules.join(", ")}. \`.venv/bin/pip install -r backend/requirements-peft.txt\`가 필요합니다.`,
    );
  }

  if (!dataset || !dataset.rowCount) {
    blockingIssues.push("최종 SFT 데이터셋이 없거나 비어 있습니다.");
  }

  const fingerprint = dataset?.fingerprint
    ? fingerprintSpec({
        kind: "sft",
        baseModel: TRAINING_BASE_MODEL,
        sourceFingerprint: dataset.fingerprint,
        training: SFT_TRAINING_ARGS,
        build: {
          inputFormat: "compact",
          assistantFormat: "reply_text",
        },
      })
    : null;

  const duplicate = fingerprint
    ? await getTrainingRunByFingerprint({ kind: "sft", fingerprint })
    : null;

  preflight.alreadyTrained = Boolean(duplicate?.state === "succeeded");
  preflight.duplicateRunId = duplicate?.run_uid ?? null;
  preflight.blockingIssues = duplicate
    ? [
        ...blockingIssues,
        duplicate.state === "running"
          ? `같은 SFT 학습이 이미 실행 중입니다. runId=${duplicate.run_uid}`
          : `같은 SFT 데이터와 설정으로 이미 학습했습니다. runId=${duplicate.run_uid}`,
      ]
    : blockingIssues;
  preflight.canStart =
    Boolean(dataset?.rowCount && fingerprint) && preflight.blockingIssues.length === 0;

  return preflight;
}

async function buildDpoPreflight(
  sftPreflight: ReviewTrainingPreflightView,
): Promise<ReviewTrainingPreflightView> {
  const preflight = buildEmptyPreflight("dpo");
  const blockingIssues = await getFinalizeBlockingIssues();
  const dataset = await getSnapshot("preference");

  preflight.dataset = {
    exists: Boolean(dataset),
    manifestPath: dataset?.manifestPath ?? null,
    datasetVersion: dataset?.datasetVersion ?? null,
    fingerprint: dataset?.fingerprint ?? null,
    rowCount: dataset?.rowCount ?? null,
  };

  if (!(await pathExists(PYTHON_BINARY_PATH))) {
    blockingIssues.push("`.venv/bin/python`이 없어 DPO 학습을 실행할 수 없습니다.");
  }
  if (!(await pathExists(TSX_BINARY_PATH)) || !(await pathExists(WORKER_SCRIPT_PATH))) {
    blockingIssues.push("training worker 실행 파일이 없어 DPO 학습을 시작할 수 없습니다.");
  }
  if (!(await pathExists(TRAIN_PEFT_DPO_SCRIPT_PATH))) {
    blockingIssues.push("PEFT DPO trainer 스크립트가 없습니다.");
  }
  if (!(await pathExists(DERIVE_MLX_RUNTIME_SCRIPT_PATH))) {
    blockingIssues.push("MLX runtime 파생 스크립트가 없습니다.");
  }
  const missingModules = await collectMissingPythonModules([
    "torch",
    "transformers",
    "peft",
    "trl",
    "datasets",
    "mlx_lm",
  ]);
  if (missingModules.length > 0) {
    blockingIssues.push(
      `PEFT/MLX 학습 의존성이 없습니다: ${missingModules.join(", ")}. \`.venv/bin/pip install -r backend/requirements-peft.txt\`가 필요합니다.`,
    );
  }

  if (!dataset || !dataset.rowCount) {
    blockingIssues.push("최종 preference 데이터셋이 없거나 비어 있습니다.");
  }

  const latestSftRun = await getLatestSuccessfulTrainingRun("sft");
  if (!latestSftRun || !latestSftRun.output_adapter_path) {
    blockingIssues.push("먼저 성공한 SFT 학습 결과가 있어야 DPO를 실행할 수 있습니다.");
  } else {
    preflight.parentRunId = latestSftRun.run_uid ?? null;
    preflight.adapterPath = latestSftRun.output_adapter_path;
  }

  if (
    latestSftRun &&
    sftPreflight.dataset.fingerprint &&
    latestSftRun.source_fingerprint !== sftPreflight.dataset.fingerprint
  ) {
    blockingIssues.push("현재 finalized SFT 데이터로 먼저 새 SFT 학습을 완료해야 DPO를 실행할 수 있습니다.");
  }

  const fingerprint =
    dataset?.fingerprint && latestSftRun?.run_uid && latestSftRun.run_fingerprint
      ? fingerprintSpec({
          kind: "dpo",
          baseModel: TRAINING_BASE_MODEL,
          sourceFingerprint: dataset.fingerprint,
          parentRunUid: latestSftRun.run_uid,
          parentFingerprint: latestSftRun.run_fingerprint,
          training: DPO_TRAINING_ARGS,
        })
      : null;

  const duplicate = fingerprint
    ? await getTrainingRunByFingerprint({ kind: "dpo", fingerprint })
    : null;

  preflight.alreadyTrained = Boolean(duplicate?.state === "succeeded");
  preflight.duplicateRunId = duplicate?.run_uid ?? null;
  preflight.blockingIssues = duplicate
    ? [
        ...blockingIssues,
        duplicate.state === "running"
          ? `같은 DPO 학습이 이미 실행 중입니다. runId=${duplicate.run_uid}`
          : `같은 DPO 데이터와 설정으로 이미 학습했습니다. runId=${duplicate.run_uid}`,
      ]
    : blockingIssues;
  preflight.canStart =
    Boolean(dataset?.rowCount && latestSftRun?.run_uid && fingerprint) &&
    preflight.blockingIssues.length === 0;

  return preflight;
}

export async function getReviewTrainingStatus(): Promise<ReviewTrainingStatusView> {
  const sft = await buildSftPreflight();
  const dpo = await buildDpoPreflight(sft);
  return getTrainingStatusFromDb({ sftPreflight: sft, dpoPreflight: dpo });
}

async function buildRunSpec(params: {
  kind: ReviewTrainingKind;
  preflight: ReviewTrainingPreflightView;
}): Promise<TrainingRunSpec> {
  const snapshot = await getSnapshot(params.kind === "sft" ? "sft" : "preference");
  if (!snapshot?.snapshotId) {
    throw new Error("활성 snapshot을 찾지 못했습니다.");
  }
  const runUid = `${new Date().toISOString().replace(/[:.]/g, "-")}_${params.kind}`;
  const datasetDir = path.join(TRAIN_RUNS_DIR, runUid, "dataset");
  const outputRootDir = path.join(TRAIN_OUTPUTS_DIR, runUid);
  const adapterPath = path.join(outputRootDir, "canonical");
  const runtimeArtifactPath = path.join(outputRootDir, "runtime");
  const runtimeArtifactKind: ReviewTrainingRuntimeArtifactKind = "mlx_fused_model";
  const trainingResultPath = path.join(outputRootDir, "training-result.json");
  const logPath = path.join(TRAIN_RUNS_DIR, runUid, "worker.log");
  const sourceFingerprint = params.preflight.dataset.fingerprint!;

  const fingerprint = fingerprintSpec({
    kind: params.kind,
    baseModel: TRAINING_BASE_MODEL,
    sourceFingerprint,
    parentRunId: params.preflight.parentRunId,
    training: params.kind === "sft" ? SFT_TRAINING_ARGS : DPO_TRAINING_ARGS,
  });

  const buildCommand =
    params.kind === "sft"
      ? {
          command: process.execPath,
          args: [
            EXPORT_MLX_SFT_SCRIPT_PATH,
            "--snapshot-id",
            String(snapshot.snapshotId),
            "--output-dir",
            datasetDir,
            "--input-format",
            "compact",
            "--assistant-format",
            "reply_text",
          ],
        }
      : {
          command: process.execPath,
          args: [
            BUILD_MLX_DPO_SCRIPT_PATH,
            "--snapshot-id",
            String(snapshot.snapshotId),
            "--output-dir",
            datasetDir,
          ],
        };

  const trainCommand =
    params.kind === "sft"
      ? {
          command: PYTHON_BINARY_PATH,
          args: [
            TRAIN_PEFT_SFT_SCRIPT_PATH,
            "--model",
            TRAINING_BASE_MODEL,
            "--data-dir",
            datasetDir,
            "--output-dir",
            adapterPath,
            "--iters",
            String(SFT_TRAINING_ARGS.iters),
            "--batch-size",
            String(SFT_TRAINING_ARGS.batchSize),
            "--learning-rate",
            SFT_TRAINING_ARGS.learningRate,
            "--max-seq-length",
            String(SFT_TRAINING_ARGS.maxSeqLength),
          ],
        }
      : {
          command: PYTHON_BINARY_PATH,
          args: [
            TRAIN_PEFT_DPO_SCRIPT_PATH,
            "--model",
            TRAINING_BASE_MODEL,
            "--data-dir",
            datasetDir,
            "--reference-adapter-dir",
            params.preflight.adapterPath!,
            "--output-dir",
            adapterPath,
            "--iters",
            String(DPO_TRAINING_ARGS.iters),
            "--batch-size",
            String(DPO_TRAINING_ARGS.batchSize),
            "--learning-rate",
            DPO_TRAINING_ARGS.learningRate,
            "--num-layers",
            String(DPO_TRAINING_ARGS.numLayers),
            "--steps-per-report",
            String(DPO_TRAINING_ARGS.stepsPerReport),
            "--steps-per-eval",
            String(DPO_TRAINING_ARGS.stepsPerEval),
            "--save-every",
            String(DPO_TRAINING_ARGS.saveEvery),
            "--beta",
            DPO_TRAINING_ARGS.beta,
            "--max-seq-length",
            String(DPO_TRAINING_ARGS.maxSeqLength),
          ],
        };

  const deriveCommand = {
    command: PYTHON_BINARY_PATH,
    args: [
      DERIVE_MLX_RUNTIME_SCRIPT_PATH,
      "--model",
      TRAINING_BASE_MODEL,
      "--adapter-dir",
      adapterPath,
      "--output-dir",
      runtimeArtifactPath,
      "--runtime-kind",
      runtimeArtifactKind,
      "--manifest-path",
      trainingResultPath,
    ],
  };

  return {
    runUid,
    kind: params.kind,
    fingerprint,
    sourceFingerprint,
    sourceSnapshotId: snapshot?.snapshotId ?? null,
    sourceDatasetVersion: params.preflight.dataset.datasetVersion,
    parentRunUid: params.preflight.parentRunId,
    baseModel: TRAINING_BASE_MODEL,
    datasetDir,
    outputRootDir,
    adapterPath,
    runtimeArtifactPath,
    runtimeArtifactKind,
    trainingResultPath,
    logPath,
    commands: {
      build: buildCommand,
      train: trainCommand,
      derive: deriveCommand,
    },
  };
}

export async function runReviewTraining(payload: {
  kind: ReviewTrainingKind;
}): Promise<ReviewTrainingStatusView> {
  const status = await getReviewTrainingStatus();
  const preflight = payload.kind === "sft" ? status.sft : status.dpo;

  if (status.activeRun) {
    throw new Error(`이미 실행 중인 학습이 있습니다. runId=${status.activeRun.runId}`);
  }

  if (!preflight.canStart) {
    throw new Error(preflight.blockingIssues[0] ?? "학습을 시작할 수 없습니다.");
  }

  const spec = await buildRunSpec({ kind: payload.kind, preflight });

  await fsp.mkdir(path.dirname(spec.logPath), { recursive: true });
  await fsp.mkdir(spec.outputRootDir, { recursive: true });
  await fsp.writeFile(
    spec.logPath,
    [
      `runId=${spec.runUid}`,
      `kind=${spec.kind}`,
      `build=${commandToString(spec.commands.build.command, spec.commands.build.args)}`,
      `train=${commandToString(spec.commands.train.command, spec.commands.train.args)}`,
      `derive=${commandToString(spec.commands.derive.command, spec.commands.derive.args)}`,
      "",
    ].join("\n"),
    "utf8",
  );

  await createTrainingRunInDb({
    runUid: spec.runUid,
    kind: spec.kind,
    state: "running",
    currentStep: "build_dataset",
    message:
      spec.kind === "sft" ? "SFT 학습 데이터셋 준비 중" : "DPO 학습 데이터셋 준비 중",
    sourceSnapshotId: spec.sourceSnapshotId,
    sourceFingerprint: spec.sourceFingerprint,
    sourceDatasetVersion: spec.sourceDatasetVersion,
    parentRunUid: spec.parentRunUid,
    baseModel: spec.baseModel,
    datasetDir: spec.datasetDir,
    adapterPath: spec.adapterPath,
    runtimeArtifactPath: spec.runtimeArtifactPath,
    runtimeArtifactKind: spec.runtimeArtifactKind,
    logPath: spec.logPath,
    fingerprint: spec.fingerprint,
    commands: spec.commands,
  });
  await appendTrainingRunEventInDb({
    runUid: spec.runUid,
    level: "info",
    eventType: "run_created",
    step: "build_dataset",
    message: spec.kind === "sft" ? "새로운 SFT Base 생성 시작" : "DPO 학습 시작",
  });

  const worker = spawn(TSX_BINARY_PATH, [WORKER_SCRIPT_PATH, "--run-id", spec.runUid], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NPC_SIMULATOR_ROOT: PROJECT_ROOT,
    },
    detached: true,
    stdio: "ignore",
  });

  worker.unref();

  return getReviewTrainingStatus();
}

async function appendLog(logPath: string, text: string) {
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  await fsp.appendFile(logPath, `${text}\n`, "utf8");
}

async function runLoggedCommand(params: {
  runUid: string;
  command: string;
  args: string[];
  logPath: string;
}) {
  await appendLog(
    params.logPath,
    `\n$ ${commandToString(params.command, params.args)}\n`,
  );
  await appendTrainingRunLogChunkInDb({
    runUid: params.runUid,
    streamName: "system",
    chunkIndex: 0,
    chunkText: `$ ${commandToString(params.command, params.args)}`,
  });

  return new Promise<number>((resolve, reject) => {
    const startedAt = Date.now();
    const logStream = fs.createWriteStream(params.logPath, { flags: "a" });
    const chunkIndexByStream = {
      stdout: 0,
      stderr: 0,
    };
    const child = spawn(params.command, params.args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NPC_SIMULATOR_ROOT: PROJECT_ROOT,
        TOKENIZERS_PARALLELISM: "true",
      },
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      chunkIndexByStream.stdout += 1;
      void appendTrainingRunLogChunkInDb({
        runUid: params.runUid,
        streamName: "stdout",
        chunkIndex: chunkIndexByStream.stdout,
        chunkText: text,
      });
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      chunkIndexByStream.stderr += 1;
      void appendTrainingRunLogChunkInDb({
        runUid: params.runUid,
        streamName: "stderr",
        chunkIndex: chunkIndexByStream.stderr,
        chunkText: text,
      });
    });
    child.on("error", (error) => {
      logStream.end();
      reject(error);
    });
    child.on("close", (code) => {
      logStream.end();
      if (code !== 0) {
        reject(new Error(`${path.basename(params.command)} exited with code ${code}`));
        return;
      }
      resolve(Date.now() - startedAt);
    });
  });
}

export async function runReviewTrainingWorker(runUid: string) {
  const spec = await getTrainingRunSpecFromDb(runUid);

  if (!spec) {
    throw new Error(`training run spec not found: ${runUid}`);
  }

  const startedAtMs = Date.now();

  try {
    await appendTrainingRunEventInDb({
      runUid,
      level: "info",
      eventType: "dataset_build_started",
      step: "build_dataset",
      message: spec.kind === "sft" ? "SFT 데이터셋 생성 시작" : "DPO 데이터셋 생성 시작",
    });

    const buildMs = await runLoggedCommand({
      runUid,
      ...spec.commands.build,
      logPath: spec.logPath,
    });

    await appendTrainingRunEventInDb({
      runUid,
      level: "info",
      eventType: "dataset_build_finished",
      step: spec.kind === "sft" ? "train_sft" : "train_dpo",
      message: spec.kind === "sft" ? "SFT 데이터셋 생성 완료" : "DPO 데이터셋 생성 완료",
      payload: { buildMs },
    });
    await updateTrainingRunStateInDb({
      runUid,
      state: "running",
      currentStep: spec.kind === "sft" ? "train_sft" : "train_dpo",
      message: spec.kind === "sft" ? "새로운 SFT Base 생성 중" : "DPO 학습 실행 중",
      durations: {
        buildMs,
        trainMs: null,
        totalMs: null,
      },
    });
    await registerDatasetArtifacts(spec);

    const trainMs = await runLoggedCommand({
      runUid,
      ...spec.commands.train,
      logPath: spec.logPath,
    });
    await appendTrainingRunEventInDb({
      runUid,
      level: "info",
      eventType: "runtime_derivation_started",
      step: "derive_runtime",
      message: "MLX runtime artifact 생성 시작",
    });
    await updateTrainingRunStateInDb({
      runUid,
      state: "running",
      currentStep: "derive_runtime",
      message: "MLX runtime artifact 생성 중",
      durations: {
        buildMs,
        trainMs,
        totalMs: null,
      },
    });
    await runLoggedCommand({
      runUid,
      ...spec.commands.derive,
      logPath: spec.logPath,
    });
    const finishedAt = new Date().toISOString();

    await updateTrainingRunStateInDb({
      runUid,
      state: "succeeded",
      currentStep: null,
      message: spec.kind === "sft" ? "SFT 학습 완료" : "DPO 학습 완료",
      finishedAt,
      adapterPath: spec.adapterPath,
      adapterVersion: trainingRunId(spec),
      runtimeArtifactPath: spec.runtimeArtifactPath,
      runtimeArtifactKind: spec.runtimeArtifactKind,
      durations: {
        buildMs,
        trainMs,
        totalMs: Date.parse(finishedAt) - startedAtMs,
      },
    });
    await appendTrainingRunEventInDb({
      runUid,
      level: "info",
      eventType: "trainer_finished",
      step: null,
      message: spec.kind === "sft" ? "SFT 학습 완료" : "DPO 학습 완료",
      payload: { buildMs, trainMs },
    });
    await registerTrainingArtifactInDb({
      runUid,
      artifactKind: "log_file",
      filePath: spec.logPath,
      metadata: trainingArtifactMetadata(spec, "worker_log"),
    });
    await registerTrainingOutputArtifacts(spec);
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message =
      error instanceof Error ? error.message : "학습 실행에 실패했습니다.";

    await appendLog(spec.logPath, `\n[failed] ${message}`);
    await appendTrainingRunEventInDb({
      runUid,
      level: "error",
      eventType: "trainer_failed",
      step: null,
      message,
    });
    await updateTrainingRunStateInDb({
      runUid,
      state: "failed",
      currentStep: null,
      message,
      finishedAt: failedAt,
    });
    await registerTrainingArtifactInDb({
      runUid,
      artifactKind: "log_file",
      filePath: spec.logPath,
      metadata: trainingArtifactMetadata(spec, "worker_log_failed"),
    });
    throw error;
  }
}
