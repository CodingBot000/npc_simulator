import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "@server/config";
import { runpodDeployConfig } from "@server/config/runpod-deploy";
import {
  appendTrainingRunEventInDb,
  getLatestSuccessfulTrainingRun,
  getTrainingRunSpecFromDb,
  registerTrainingArtifactInDb,
  updateTrainingRunRemoteDeploymentInDb,
} from "@server/db/review-db";
import { closeDbPool } from "@server/db/postgres";
import {
  createRunpodEndpoint,
  createRunpodVllmRunSync,
  createRunpodTemplate,
  extractRunpodVllmText,
  findRunpodEndpointByName,
  findRunpodTemplateByName,
  getRunpodEndpoint,
  getRunpodEndpointHealth,
  listRunpodTemplates,
  updateRunpodEndpoint,
  updateRunpodTemplate,
} from "@server/runpod-client";
import {
  buildRunpodRemoteProvider,
  parseRemoteProviderRef,
} from "@server/remote-provider";

type RawRecord = Record<string, unknown>;

type UploadedAdapterInfo = {
  repoId: string;
  repoUrl: string;
  private: boolean;
  adapterDir: string;
};

const PYTHON_BINARY_PATH = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const HF_PUBLISH_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "backend",
  "scripts",
  "publish-peft-adapter-to-hf.py",
);
function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readOptionalOption(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonLine<T>(stdout: string): T {
  const lastLine = stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) {
    throw new Error("command did not produce JSON output");
  }
  return JSON.parse(lastLine) as T;
}

async function pathExists(targetPath: string | null | undefined) {
  if (!targetPath) {
    return false;
  }
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NPC_SIMULATOR_ROOT: PROJECT_ROOT,
        ...envOverrides,
      },
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
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} failed.`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readAdapterMetadata(adapterDir: string) {
  const configPath = path.join(adapterDir, "adapter_config.json");
  const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as RawRecord;
  const loraParameters = asObject(raw.lora_parameters);
  const baseModel =
    trimToNull(asString(raw.base_model_name_or_path)) ??
    trimToNull(asString(raw.model));
  const rank = asNumber(raw.r) ?? asNumber(loraParameters.rank) ?? 64;

  return {
    baseModel,
    rank,
    raw,
  };
}

function resolveOutputRootDir(params: {
  runId: string;
  trainingResultPath: string | null;
  adapterPath: string | null;
}) {
  if (params.trainingResultPath) {
    return path.dirname(params.trainingResultPath);
  }
  if (params.adapterPath) {
    return path.basename(params.adapterPath) === "canonical"
      ? path.dirname(params.adapterPath)
      : params.adapterPath;
  }
  return path.join(PROJECT_ROOT, "outputs", "training", params.runId);
}

async function publishAdapterToHf(params: {
  adapterDir: string;
  runId: string;
  repoId?: string | null;
  publicRepo: boolean;
}) {
  const pythonBinary = (await pathExists(PYTHON_BINARY_PATH)) ? PYTHON_BINARY_PATH : "python3";
  const args = [
    HF_PUBLISH_SCRIPT_PATH,
    "--adapter-dir",
    params.adapterDir,
    "--run-id",
    params.runId,
    "--repo-name-prefix",
    runpodDeployConfig.hfRepoPrefix,
    params.publicRepo ? "--public" : "--private",
  ];
  if (params.repoId) {
    args.push("--repo-id", params.repoId);
  }
  const result = await runCommand(pythonBinary, args, {
    HF_TOKEN: runpodDeployConfig.hfToken ?? undefined,
  });
  return parseJsonLine<UploadedAdapterInfo>(result.stdout);
}

function resolveGpuTypeIds() {
  return runpodDeployConfig.gpuTypeIds;
}

function buildEndpointName(runId: string) {
  return `${slugify(runpodDeployConfig.endpointNamePrefix)}-${slugify(runId)}`;
}

function buildTemplateName(runId: string) {
  return `${buildEndpointName(runId)}-vllm`;
}

function buildServedModelName(runId: string) {
  return `${slugify(runpodDeployConfig.servedModelPrefix)}-${slugify(runId)}`;
}

function buildTemplateEnv(params: {
  baseModel: string;
  servedModelName: string;
  adapterRepoId: string;
  loraRank: number;
  publicRepo: boolean;
}) {
  const env: Record<string, string> = {
    MODEL_NAME: params.baseModel,
    ENABLE_LORA: "true",
    MAX_LORAS: "1",
    MAX_LORA_RANK: String(params.loraRank),
    LORA_MODULES: JSON.stringify([
      {
        name: params.servedModelName,
        path: params.adapterRepoId,
      },
    ]),
    OPENAI_SERVED_MODEL_NAME_OVERRIDE: params.servedModelName,
  };

  const hfToken = runpodDeployConfig.hfToken;
  if (hfToken && !params.publicRepo) {
    env.HF_TOKEN = hfToken;
  }

  return env;
}

async function waitForRunpodWorkerReady(params: { endpointId: string }) {
  const timeoutMs = runpodDeployConfig.readyTimeoutMs;
  const pollMs = runpodDeployConfig.readyPollMs;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await getRunpodEndpointHealth(params.endpointId);
      const workers = asObject(response.workers);
      const readyCount =
        (asNumber(workers.ready) ?? 0) +
        (asNumber(workers.idle) ?? 0) +
        (asNumber(workers.running) ?? 0);
      if (readyCount > 0) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Runpod endpoint did not become ready before timeout.";
  throw new Error(message);
}

async function verifyRunpodInference(params: {
  endpointId: string;
}) {
  const response = await createRunpodVllmRunSync({
    endpointId: params.endpointId,
    messages: [
      {
        role: "system",
        content: "한 문장의 짧은 한국어 인사만 말한다.",
      },
      {
        role: "user",
        content: "안녕하세요",
      },
    ],
    maxTokens: 40,
    temperature: 0.2,
  });
  const text = extractRunpodVllmText(response);
  const trimmed = trimToNull(text);
  if (!trimmed) {
    throw new Error("Runpod inference returned an empty response.");
  }
  return trimmed;
}

async function main() {
  const kind = trimToNull(readOptionalOption("--kind")) === "dpo" ? "dpo" : "sft";
  const requestedRunId = trimToNull(readOptionalOption("--run-id"));
  const requestedHfRepoId = trimToNull(readOptionalOption("--hf-repo-id"));
  const publicRepo = hasFlag("--public-hf-repo");

  const latestRun =
    requestedRunId == null ? await getLatestSuccessfulTrainingRun(kind) : null;
  const runId = requestedRunId ?? trimToNull(latestRun?.run_uid);
  if (!runId) {
    throw new Error(`no successful ${kind} training run found for Runpod deployment.`);
  }

  try {
    const spec = await getTrainingRunSpecFromDb(runId);
    if (!spec) {
      throw new Error(`training run spec not found: ${runId}`);
    }
    if (!spec.adapterPath) {
      throw new Error(`training run has no adapter path: ${runId}`);
    }
    if (!(await pathExists(path.join(spec.adapterPath, "adapter_model.safetensors")))) {
      throw new Error(`adapter_model.safetensors not found: ${spec.adapterPath}`);
    }

    await appendTrainingRunEventInDb({
      runUid: runId,
      level: "info",
      eventType: "runpod_deploy_started",
      step: null,
      message: "Runpod 배포 시작",
    });

    const adapterMetadata = await readAdapterMetadata(spec.adapterPath);
    const baseModel =
      adapterMetadata.baseModel ??
      trimToNull(spec.baseModel) ??
      (() => {
        throw new Error(`unable to resolve base model for run: ${runId}`);
      })();
    const servedModelName = buildServedModelName(runId);
    const endpointName = buildEndpointName(runId);
    const templateName = buildTemplateName(runId);

    const uploadedAdapter = await publishAdapterToHf({
      adapterDir: spec.adapterPath,
      runId,
      repoId: requestedHfRepoId,
      publicRepo,
    });
    await appendTrainingRunEventInDb({
      runUid: runId,
      level: "info",
      eventType: "runpod_adapter_uploaded",
      step: null,
      message: "LoRA adapter Hugging Face 업로드 완료",
      payload: uploadedAdapter,
    });

    const templateEnv = buildTemplateEnv({
      baseModel,
      servedModelName,
      adapterRepoId: uploadedAdapter.repoId,
      loraRank: adapterMetadata.rank,
      publicRepo,
    });

    const templateImage = runpodDeployConfig.vllmImage;
    const gpuTypeIds = resolveGpuTypeIds();
    const remoteProviderRef = parseRemoteProviderRef(spec.remoteProvider);
    const existingEndpoint =
      remoteProviderRef?.kind === "runpod"
        ? (await getRunpodEndpoint(remoteProviderRef.endpointId).catch(() => null)) ??
          (await findRunpodEndpointByName(endpointName))
        : await findRunpodEndpointByName(endpointName);
    const existingTemplates = await listRunpodTemplates();
    const existingTemplate =
      existingTemplates.find((entry) => entry.id === existingEndpoint?.templateId) ??
      (await findRunpodTemplateByName(templateName));

    const template = existingTemplate
      ? await updateRunpodTemplate(existingTemplate.id, {
          name: templateName,
          imageName: templateImage,
          env: templateEnv,
          containerDiskInGb: runpodDeployConfig.containerDiskGb,
          isPublic: false,
          ports: [],
          readme: "",
        })
      : await createRunpodTemplate({
          name: templateName,
          imageName: templateImage,
          env: templateEnv,
          containerDiskInGb: runpodDeployConfig.containerDiskGb,
          isPublic: false,
          ports: [],
          readme: "",
        });

    const endpointParams = {
      name: endpointName,
      templateId: template.id,
      gpuTypeIds,
      gpuCount: 1,
      workersMin: runpodDeployConfig.workersMin,
      workersMax: runpodDeployConfig.workersMax,
      idleTimeout: runpodDeployConfig.idleTimeoutSeconds,
      executionTimeoutMs: runpodDeployConfig.executionTimeoutMs,
      flashboot: runpodDeployConfig.flashboot,
      scalerType: "QUEUE_DELAY" as const,
      scalerValue: runpodDeployConfig.scalerValue,
    };
    const endpoint = existingEndpoint
      ? await updateRunpodEndpoint(existingEndpoint.id, endpointParams)
      : await createRunpodEndpoint(endpointParams);

    await appendTrainingRunEventInDb({
      runUid: runId,
      level: "info",
      eventType: "runpod_endpoint_readying",
      step: null,
      message: "Runpod endpoint 준비 대기 중",
      payload: {
        endpointId: endpoint.id,
        templateId: template.id,
        endpointName,
        servedModelName,
      },
    });

    const readyHealth = await waitForRunpodWorkerReady({
      endpointId: endpoint.id,
    });
    const verificationReply = await verifyRunpodInference({
      endpointId: endpoint.id,
    });

    const outputRootDir = resolveOutputRootDir({
      runId,
      trainingResultPath: spec.trainingResultPath,
      adapterPath: spec.adapterPath,
    });
    const deploymentSummaryPath = path.join(outputRootDir, "runpod-deployment.json");
    const deploymentSummary = {
      deployedAt: new Date().toISOString(),
      runId,
      kind: spec.kind,
      endpointId: endpoint.id,
      endpointName,
      templateId: template.id,
      templateName,
      servedModelName,
      baseModel,
      adapterRepoId: uploadedAdapter.repoId,
      adapterRepoUrl: uploadedAdapter.repoUrl,
      adapterRepoPrivate: uploadedAdapter.private,
      templateImage,
      gpuTypeIds,
      workersMin: endpointParams.workersMin,
      workersMax: endpointParams.workersMax,
      idleTimeout: endpointParams.idleTimeout,
      flashboot: endpointParams.flashboot,
      readyHealth,
      verificationReply,
    };
    await fs.mkdir(outputRootDir, { recursive: true });
    await fs.writeFile(
      deploymentSummaryPath,
      `${JSON.stringify(deploymentSummary, null, 2)}\n`,
      "utf8",
    );

    await updateTrainingRunRemoteDeploymentInDb({
      runUid: runId,
      remoteProvider: buildRunpodRemoteProvider(endpoint.id),
      remoteModelName: servedModelName,
      message: "Runpod 배포 완료",
      deployment: deploymentSummary,
    });
    await appendTrainingRunEventInDb({
      runUid: runId,
      level: "info",
      eventType: "runpod_deploy_finished",
      step: null,
      message: "Runpod 배포 완료",
      payload: deploymentSummary,
    });
    await registerTrainingArtifactInDb({
      runUid: runId,
      artifactKind: "runpod_deployment_summary",
      filePath: deploymentSummaryPath,
      metadata: {
        endpointId: endpoint.id,
        templateId: template.id,
        servedModelName,
        adapterRepoId: uploadedAdapter.repoId,
      },
    });

    process.stdout.write(`${JSON.stringify(deploymentSummary)}\n`);
  } catch (error) {
    await appendTrainingRunEventInDb({
      runUid: runId,
      level: "error",
      eventType: "runpod_deploy_failed",
      step: null,
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool().catch(() => {});
  });
