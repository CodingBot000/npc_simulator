import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "@server/config";
import { runpodCustomVllmDeployConfig } from "@server/config/runpod-custom-vllm-deploy";
import {
  buildRunpodLoadBalancerBaseUrl,
  createRunpodLoadBalancerEndpoint,
  createRunpodLoadBalancerChatCompletion,
  createRunpodTemplate,
  extractOpenAiCompatibleChatText,
  findRunpodEndpointByName,
  findRunpodTemplateByName,
  getRunpodLoadBalancerPing,
  listRunpodLoadBalancerModels,
  updateRunpodTemplate,
  type RunpodTemplateRecord,
} from "@server/runpod-client";

const OUTPUT_ROOT_DIR = path.join(
  PROJECT_ROOT,
  "outputs",
  "training",
  runpodCustomVllmDeployConfig.runId,
);
const DEPLOYMENT_SUMMARY_PATH = path.join(
  OUTPUT_ROOT_DIR,
  "runpod-custom-vllm-deployment.json",
);

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveStringOption(flag: string, envValue: string | null | undefined) {
  return trimToNull(readOptionalOption(flag)) ?? trimToNull(envValue);
}

function sanitizeEnv(env: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"].includes(key) ? "[configured]" : value,
    ]),
  );
}

function buildTemplateEnv() {
  const env: Record<string, string> = {
    PORT: "8000",
    PORT_HEALTH: "8000",
    RUNPOD_VOLUME_PATH: runpodCustomVllmDeployConfig.volumeMountPath,
    BASE_MODEL_REPO: runpodCustomVllmDeployConfig.baseModelRepo,
    BASE_MODEL_REVISION: runpodCustomVllmDeployConfig.baseModelRevision,
    ADAPTER_REPO: runpodCustomVllmDeployConfig.adapterRepo,
    ADAPTER_REVISION: runpodCustomVllmDeployConfig.adapterRevision,
    SERVED_BASE_MODEL: runpodCustomVllmDeployConfig.servedBaseModel,
    SERVED_LORA_MODEL: runpodCustomVllmDeployConfig.servedLoraModel,
    MAX_MODEL_LEN: String(runpodCustomVllmDeployConfig.maxModelLen),
    GPU_MEMORY_UTILIZATION: runpodCustomVllmDeployConfig.gpuMemoryUtilization,
    ENABLE_LORA: "true",
    MAX_LORAS: String(runpodCustomVllmDeployConfig.maxLoras),
    MAX_LORA_RANK: String(runpodCustomVllmDeployConfig.maxLoraRank),
    HF_HUB_ENABLE_HF_TRANSFER: "1",
    TOKENIZERS_PARALLELISM: "false",
  };

  if (runpodCustomVllmDeployConfig.hfToken) {
    env.HF_TOKEN = runpodCustomVllmDeployConfig.hfToken;
  }

  return env;
}

async function upsertTemplate(params: {
  imageName: string;
}) {
  const templateEnv = buildTemplateEnv();
  const existing = await findRunpodTemplateByName(
    runpodCustomVllmDeployConfig.templateName,
  );
  const templateParams = {
    name: runpodCustomVllmDeployConfig.templateName,
    imageName: params.imageName,
    env: templateEnv,
    containerDiskInGb: runpodCustomVllmDeployConfig.containerDiskGb,
    volumeMountPath: runpodCustomVllmDeployConfig.volumeMountPath,
    isPublic: false,
    ports: ["8000/http"],
    readme:
      "Custom vLLM OpenAI-compatible Llama 3.1 + PEFT LoRA server for Runpod Load Balancer endpoints.",
  };

  const template = existing
    ? await updateRunpodTemplate(existing.id, templateParams)
    : await createRunpodTemplate(templateParams);

  return {
    template,
    templateEnv,
    created: !existing,
  };
}

async function verifyLoadBalancerEndpoint(params: {
  endpointId: string;
}) {
  const ping = await waitForLoadBalancerReady({
    endpointId: params.endpointId,
    timeoutMs: 20 * 60_000,
    pollMs: 10_000,
  });
  const models = await listRunpodLoadBalancerModels(params.endpointId);
  const response = await createRunpodLoadBalancerChatCompletion({
    endpointId: params.endpointId,
    model: runpodCustomVllmDeployConfig.servedLoraModel,
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
    timeoutMs: 300_000,
  });
  const reply = extractOpenAiCompatibleChatText(response);
  if (!reply) {
    throw new Error("Runpod load balancer inference returned an empty response.");
  }

  return {
    baseUrl: buildRunpodLoadBalancerBaseUrl(params.endpointId),
    ping,
    modelIds: models.data?.map((entry) => entry.id).filter(Boolean) ?? [],
    reply,
  };
}

async function waitForLoadBalancerReady(params: {
  endpointId: string;
  timeoutMs: number;
  pollMs: number;
}) {
  const deadline = Date.now() + params.timeoutMs;
  let lastPing: Awaited<ReturnType<typeof getRunpodLoadBalancerPing>> | null = null;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      lastPing = await getRunpodLoadBalancerPing(params.endpointId);
      if (lastPing.status === 200) {
        return lastPing;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(params.pollMs);
  }

  const status = lastPing ? `last ping status=${lastPing.status}` : "no ping response";
  const errorMessage = lastError instanceof Error ? `; last error=${lastError.message}` : "";
  throw new Error(`Runpod load balancer did not become ready: ${status}${errorMessage}`);
}

function buildManualEndpointInstructions(params: {
  template: RunpodTemplateRecord | null;
  imageName: string | null;
  sanitizedEnv: Record<string, string>;
}) {
  return [
    "Runpod console manual step required:",
    "1. Serverless > New Endpoint > Import from Docker Registry.",
    `2. Container Image: ${params.imageName ?? "<RUNPOD_CUSTOM_VLLM_IMAGE>"}`,
    "3. Endpoint Type: Load Balancer.",
    `4. Endpoint Name: ${runpodCustomVllmDeployConfig.endpointName}`,
    `5. Template: ${params.template?.id ?? params.template?.name ?? runpodCustomVllmDeployConfig.templateName}`,
    `6. Network Volume: attach RUNPOD_NETWORK_VOLUME_ID at ${runpodCustomVllmDeployConfig.volumeMountPath}.`,
    `7. GPU priority: ${runpodCustomVllmDeployConfig.gpuTypeIds.join(", ")}`,
    `8. Data centers: ${runpodCustomVllmDeployConfig.dataCenterIds.join(", ")}`,
    `9. Workers: min=${runpodCustomVllmDeployConfig.workersMin}, max=${runpodCustomVllmDeployConfig.workersMax}, idleTimeout=${runpodCustomVllmDeployConfig.idleTimeoutSeconds}s.`,
    "10. HTTP ports: 8000/http.",
    `11. Env: ${JSON.stringify(params.sanitizedEnv)}`,
    "12. Or run this script with --create-endpoint. Set RUNPOD_CONTAINER_REGISTRY_AUTH_ID only for private registry pulls.",
    "13. After creation, set RUNPOD_CUSTOM_VLLM_ENDPOINT_ID=<endpoint_id> and rerun this script with --verify-only.",
  ];
}

async function main() {
  const verifyOnly = hasFlag("--verify-only");
  const createEndpoint = hasFlag("--create-endpoint");
  const skipTemplate = hasFlag("--skip-template") || verifyOnly;
  const imageName = resolveStringOption(
    "--image",
    runpodCustomVllmDeployConfig.imageName,
  );
  let endpointId = resolveStringOption(
    "--endpoint-id",
    runpodCustomVllmDeployConfig.endpointId,
  );

  let templateResult:
    | {
        template: RunpodTemplateRecord;
        templateEnv: Record<string, string>;
        created: boolean;
      }
    | null = null;

  if (!skipTemplate) {
    if (!imageName) {
      throw new Error(
        "RUNPOD_CUSTOM_VLLM_IMAGE or --image is required before upserting the Runpod template.",
      );
    }
    templateResult = await upsertTemplate({ imageName });
  }

  let endpointResult: Awaited<ReturnType<typeof createRunpodLoadBalancerEndpoint>> | null =
    null;
  if (createEndpoint && !endpointId) {
    if (!imageName) {
      throw new Error(
        "RUNPOD_CUSTOM_VLLM_IMAGE or --image is required before creating the Runpod load balancer endpoint.",
      );
    }
    const existingEndpoint = await findRunpodEndpointByName(
      runpodCustomVllmDeployConfig.endpointName,
    );
    if (existingEndpoint) {
      endpointId = existingEndpoint.id;
    } else {
      endpointResult = await createRunpodLoadBalancerEndpoint({
        name: runpodCustomVllmDeployConfig.endpointName,
        imageName,
        env: buildTemplateEnv(),
        containerDiskInGb: runpodCustomVllmDeployConfig.containerDiskGb,
        containerRegistryAuthId: runpodCustomVllmDeployConfig.containerRegistryAuthId,
        volumeMountPath: runpodCustomVllmDeployConfig.volumeMountPath,
        ports: ["8000/http"],
        readme:
          "Custom vLLM OpenAI-compatible Llama 3.1 + PEFT LoRA server for Runpod Load Balancer endpoints.",
        networkVolumeIds: runpodCustomVllmDeployConfig.networkVolumeId
          ? [runpodCustomVllmDeployConfig.networkVolumeId]
          : [],
        gpuIds: runpodCustomVllmDeployConfig.loadBalancerGpuIds,
        gpuCount: 1,
        dataCenterIds: runpodCustomVllmDeployConfig.dataCenterIds,
        workersMin: runpodCustomVllmDeployConfig.workersMin,
        workersMax: runpodCustomVllmDeployConfig.workersMax,
        idleTimeout: runpodCustomVllmDeployConfig.idleTimeoutSeconds,
        executionTimeoutMs: runpodCustomVllmDeployConfig.executionTimeoutMs,
        flashboot: runpodCustomVllmDeployConfig.flashboot,
        scalerValue: runpodCustomVllmDeployConfig.scalerValue,
      });
      endpointId = endpointResult.id;
    }
  }

  let verification: Awaited<ReturnType<typeof verifyLoadBalancerEndpoint>> | null = null;
  if (endpointId) {
    verification = await verifyLoadBalancerEndpoint({ endpointId });
  }

  const templateEnv = templateResult?.templateEnv ?? buildTemplateEnv();
  const summary = {
    generatedAt: new Date().toISOString(),
    runId: runpodCustomVllmDeployConfig.runId,
    mode: "runpod_custom_vllm_load_balancer_network_volume",
    template: templateResult
      ? {
          id: templateResult.template.id,
          name: templateResult.template.name,
          imageName: templateResult.template.imageName,
          created: templateResult.created,
        }
      : null,
    endpoint: endpointId
      ? {
          id: endpointId,
          baseUrl: buildRunpodLoadBalancerBaseUrl(endpointId),
          kind: "load_balancer_vllm",
          created: Boolean(endpointResult),
        }
      : null,
    networkVolume: {
      id: runpodCustomVllmDeployConfig.networkVolumeId,
      mountPath: runpodCustomVllmDeployConfig.volumeMountPath,
    },
    containerRegistryAuth: runpodCustomVllmDeployConfig.containerRegistryAuthId
      ? {
          id: runpodCustomVllmDeployConfig.containerRegistryAuthId,
          password: "[configured outside summary]",
        }
      : null,
    loadBalancerGpuIds: runpodCustomVllmDeployConfig.loadBalancerGpuIds,
    gpuTypeIds: runpodCustomVllmDeployConfig.gpuTypeIds,
    dataCenterIds: runpodCustomVllmDeployConfig.dataCenterIds,
    workersMin: runpodCustomVllmDeployConfig.workersMin,
    workersMax: runpodCustomVllmDeployConfig.workersMax,
    idleTimeoutSeconds: runpodCustomVllmDeployConfig.idleTimeoutSeconds,
    servedBaseModel: runpodCustomVllmDeployConfig.servedBaseModel,
    servedLoraModel: runpodCustomVllmDeployConfig.servedLoraModel,
    baseModelRepo: runpodCustomVllmDeployConfig.baseModelRepo,
    baseModelRevision: runpodCustomVllmDeployConfig.baseModelRevision,
    adapterRepo: runpodCustomVllmDeployConfig.adapterRepo,
    adapterRevision: runpodCustomVllmDeployConfig.adapterRevision,
    templateEnv: sanitizeEnv(templateEnv),
    verification,
    manualEndpointInstructions: buildManualEndpointInstructions({
      template: templateResult?.template ?? null,
      imageName,
      sanitizedEnv: sanitizeEnv(templateEnv),
    }),
  };

  await fs.mkdir(OUTPUT_ROOT_DIR, { recursive: true });
  await fs.writeFile(
    DEPLOYMENT_SUMMARY_PATH,
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
