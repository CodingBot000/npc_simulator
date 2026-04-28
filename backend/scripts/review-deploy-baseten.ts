import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { buildChildProcessEnv } from "@backend-support/bootstrap";
import { PROJECT_ROOT } from "@server/config";
import {
  type BasetenAutoscalingSettings,
  createBasetenChatCompletion,
  extractBasetenChatText,
  getBasetenDeployment,
  listBasetenModels,
  updateBasetenDeploymentAutoscaling,
  upsertBasetenSecret,
} from "@server/baseten-client";
import { basetenDeployConfig } from "@server/config/baseten-deploy";
import { basetenServiceConfig } from "@server/config/baseten-service";

type RawRecord = Record<string, unknown>;

const DEFAULT_RUN_ID = "manual_llama31_local_check_20260421_025259";
const DEFAULT_TRUSS_DIR = path.join(
  PROJECT_ROOT,
  "deploy",
  "baseten",
  "npc-sim-llama31-lora-vllm",
);
const SERVED_LORA_MODEL_NAME = "npc-sim-manual-llama31-local-check-20260421-025259";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalOption(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
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

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function collectRecords(value: unknown): RawRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectRecords(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as RawRecord;
  const nested = Object.values(record).flatMap((entry) => collectRecords(entry));
  return [record, ...nested];
}

async function runCommand(
  command: string,
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: buildChildProcessEnv(PROJECT_ROOT, envOverrides),
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

function parseJsonMaybe(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractBasetenModelIdFromText(text: string) {
  const urlMatch = /model-([a-zA-Z0-9]+)\.api\.baseten\.co/u.exec(text);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }
  const jsonLikeMatches = [
    /"model[_-]?id"\s*:\s*"([^"]+)"/iu,
    /"id"\s*:\s*"([a-zA-Z0-9]{6,})"/u,
  ];
  for (const pattern of jsonLikeMatches) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function extractBasetenModelIdFromJson(value: unknown) {
  for (const record of collectRecords(value)) {
    const candidates = [
      asString(record.model_id),
      asString(record.modelId),
      asString(record.id),
    ];
    for (const candidate of candidates) {
      if (candidate && /^[a-zA-Z0-9]+$/u.test(candidate)) {
        return candidate;
      }
    }
    const urlCandidate =
      asString(record.model_url) ??
      asString(record.modelUrl) ??
      asString(record.url) ??
      asString(record.invocation_url);
    if (urlCandidate) {
      const modelId = extractBasetenModelIdFromText(urlCandidate);
      if (modelId) {
        return modelId;
      }
    }
  }
  return null;
}

function extractBasetenDeploymentIdFromJson(value: unknown) {
  for (const record of collectRecords(value)) {
    const directCandidates = [
      asString(record.model_version_id),
      asString(record.deployment_id),
      asString(record.deploymentId),
    ];
    for (const candidate of directCandidates) {
      if (candidate && /^[a-zA-Z0-9]+$/u.test(candidate)) {
        return candidate;
      }
    }

    const isDeploymentRecord =
      typeof record.status === "string" &&
      ("is_production" in record || "active_replica_count" in record);
    const deploymentRecordId = asString(record.id);
    if (isDeploymentRecord && deploymentRecordId && /^[a-zA-Z0-9]+$/u.test(deploymentRecordId)) {
      return deploymentRecordId;
    }
  }
  return null;
}

function getModelName(record: RawRecord) {
  return (
    asString(record.name) ??
    asString(record.model_name) ??
    asString(record.modelName)
  );
}

async function findModelIdByName(modelName: string) {
  const payload = await listBasetenModels();
  const records = collectRecords(payload);
  const match = records.find((record) => getModelName(record) === modelName);
  const id =
    asString(match?.id) ??
    asString(match?.model_id) ??
    asString(match?.modelId);
  return id && /^[a-zA-Z0-9]+$/u.test(id) ? id : null;
}

async function upsertHfSecret() {
  const hfToken = basetenDeployConfig.hfToken;
  if (!hfToken) {
    throw new Error("HF_TOKEN is required to let Baseten download the private adapter repo.");
  }
  await upsertBasetenSecret({
    name: basetenServiceConfig.hfSecretName,
    value: hfToken,
  });
}

async function pushTruss(params: {
  trussDir: string;
  deploymentName: string;
  timeoutSeconds: number;
}) {
  const result = await runCommand("uvx", [
    "truss",
    "push",
    params.trussDir,
    "--promote",
    "--deployment-name",
    params.deploymentName,
    "--non-interactive",
    "--wait",
    "--timeout-seconds",
    String(params.timeoutSeconds),
    "--deploy-timeout-minutes",
    String(Math.ceil(params.timeoutSeconds / 60)),
    "--output",
    "json",
  ], {
    BASETEN_API_KEY: basetenServiceConfig.apiKey ?? undefined,
  });

  const parsed = parseJsonMaybe(result.stdout);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    parsed,
    modelId:
      extractBasetenModelIdFromJson(parsed) ??
      extractBasetenModelIdFromText(`${result.stdout}\n${result.stderr}`),
  };
}

async function verifyBasetenInference(params: {
  modelId: string;
  modelUrl?: string | null;
}) {
  const response = await createBasetenChatCompletion({
    modelId: params.modelId,
    modelUrl: params.modelUrl,
    model: SERVED_LORA_MODEL_NAME,
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
    maxTokens: 64,
    temperature: 0.2,
    timeoutMs: basetenDeployConfig.smokeTimeoutMs,
  });
  const text = extractBasetenChatText(response);
  const trimmed = trimToNull(text);
  if (!trimmed) {
    throw new Error("Baseten inference returned an empty response.");
  }
  return trimmed;
}

function buildAutoscalingSettings(): BasetenAutoscalingSettings {
  return {
    min_replica: basetenDeployConfig.autoscaling.minReplica,
    max_replica: basetenDeployConfig.autoscaling.maxReplica,
    autoscaling_window: basetenDeployConfig.autoscaling.autoscalingWindow,
    scale_down_delay: basetenDeployConfig.autoscaling.scaleDownDelay,
    concurrency_target: basetenDeployConfig.autoscaling.concurrencyTarget,
    target_utilization_percentage:
      basetenDeployConfig.autoscaling.targetUtilizationPercentage,
  };
}

async function main() {
  if (!basetenServiceConfig.apiKey) {
    throw new Error("BASETEN_API_KEY is required.");
  }

  const runId = trimToNull(readOptionalOption("--run-id")) ?? DEFAULT_RUN_ID;
  const trussDir = trimToNull(readOptionalOption("--truss-dir")) ?? DEFAULT_TRUSS_DIR;
  const modelName =
    trimToNull(readOptionalOption("--model-name")) ?? "npc-sim-llama31-lora-vllm";
  const deploymentName =
    trimToNull(readOptionalOption("--deployment-name")) ??
    `npc-sim-llama31-lora-${new Date().toISOString().slice(0, 10)}`;
  const requestedModelId =
    trimToNull(readOptionalOption("--model-id")) ?? basetenServiceConfig.modelId;
  const requestedDeploymentId = trimToNull(readOptionalOption("--deployment-id"));
  const modelUrl = trimToNull(readOptionalOption("--model-url")) ?? basetenServiceConfig.modelUrl;
  const timeoutSeconds = Number(readOptionalOption("--timeout-seconds") || "3600");
  const skipPush = hasFlag("--skip-push");

  const outputRootDir = path.join(PROJECT_ROOT, "outputs", "training", runId);
  const adapterDir = path.join(outputRootDir, "canonical");
  if (!(await pathExists(path.join(adapterDir, "adapter_model.safetensors")))) {
    throw new Error(`adapter_model.safetensors not found: ${adapterDir}`);
  }
  if (!(await pathExists(path.join(trussDir, "config.yaml")))) {
    throw new Error(`Baseten Truss config not found: ${trussDir}`);
  }

  await upsertHfSecret();

  const pushResult = skipPush
    ? null
    : await pushTruss({
        trussDir,
        deploymentName,
        timeoutSeconds,
      });
  const modelId =
    requestedModelId ??
    pushResult?.modelId ??
    (await findModelIdByName(modelName));
  if (!modelId) {
    throw new Error("Unable to resolve Baseten model ID from push output or model list.");
  }

  const deploymentId =
    requestedDeploymentId ??
    (pushResult ? extractBasetenDeploymentIdFromJson(pushResult.parsed) : null) ??
    "production";
  const requestedAutoscalingSettings = buildAutoscalingSettings();
  await updateBasetenDeploymentAutoscaling({
    modelId,
    deploymentId,
    settings: requestedAutoscalingSettings,
  });
  const deployment = await getBasetenDeployment({
    modelId,
    deploymentId,
  });

  const verificationReply = await verifyBasetenInference({
    modelId,
    modelUrl,
  });
  const verifiedDeployment = await getBasetenDeployment({
    modelId,
    deploymentId,
  });
  const deploymentSummary = {
    deployedAt: new Date().toISOString(),
    runId,
    trussDir,
    modelName,
    modelId,
    deploymentId: verifiedDeployment.id ?? deployment.id ?? deploymentId,
    deploymentStatus: verifiedDeployment.status ?? deployment.status ?? null,
    modelUrl:
      modelUrl ??
      `https://model-${modelId}.api.baseten.co/environments/production/sync/v1`,
    deploymentName,
    servedModelName: SERVED_LORA_MODEL_NAME,
    baseModel: "unsloth/Meta-Llama-3.1-8B-Instruct",
    adapterRepoId:
      "AutoBot000/npc-sim-manual-llama31-local-check-20260421-025259-adapter",
    instanceType: "H100MIG",
    scaleToZero: {
      expectedMinReplica: requestedAutoscalingSettings.min_replica,
      expectedScaleDownDelaySeconds: requestedAutoscalingSettings.scale_down_delay,
      source: "Baseten autoscaling API updated by this deploy script.",
    },
    autoscalingSettings:
      verifiedDeployment.autoscaling_settings ??
      deployment.autoscaling_settings ??
      requestedAutoscalingSettings,
    verificationReply,
    pushOutput: pushResult
      ? {
          parsed: pushResult.parsed,
          stdoutTail: pushResult.stdout.slice(-4000),
          stderrTail: pushResult.stderr.slice(-4000),
        }
      : null,
  };

  const summaryPath = path.join(outputRootDir, "baseten-deployment.json");
  await fs.mkdir(outputRootDir, { recursive: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(deploymentSummary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(deploymentSummary)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
