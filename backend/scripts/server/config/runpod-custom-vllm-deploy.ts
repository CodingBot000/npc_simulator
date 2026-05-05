import { getServerEnv } from "@server/config";

const DEFAULT_GPU_TYPE_IDS = [
  "NVIDIA L40S",
  "NVIDIA RTX 6000 Ada Generation",
  "NVIDIA GeForce RTX 5090",
  "NVIDIA H100 80GB HBM3",
];
const DEFAULT_DATA_CENTER_IDS = ["EUR-IS-3", "EUR-IS-2", "EUR-NO-1"];
const DEFAULT_RUN_ID = "manual_llama31_local_check_20260421_025259";
const DEFAULT_SERVED_LORA_MODEL =
  "npc-sim-manual-llama31-local-check-20260421-025259";
const DEFAULT_LOAD_BALANCER_GPU_IDS = "ADA_80_PRO";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCsvEnv(key: string, defaults: string[]) {
  const raw = trimToNull(getServerEnv(key));
  if (!raw) {
    return defaults;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const runpodCustomVllmDeployConfig = {
  runId: trimToNull(getServerEnv("RUNPOD_CUSTOM_VLLM_RUN_ID")) ?? DEFAULT_RUN_ID,
  imageName: trimToNull(getServerEnv("RUNPOD_CUSTOM_VLLM_IMAGE")),
  templateName:
    trimToNull(getServerEnv("RUNPOD_CUSTOM_VLLM_TEMPLATE_NAME")) ??
    "npc-sim-llama31-lora-custom-vllm",
  endpointName:
    trimToNull(getServerEnv("RUNPOD_CUSTOM_VLLM_ENDPOINT_NAME")) ??
    "npc-sim-llama31-lora-custom-vllm-lb",
  endpointId: trimToNull(getServerEnv("RUNPOD_CUSTOM_VLLM_ENDPOINT_ID")),
  networkVolumeId: trimToNull(getServerEnv("RUNPOD_NETWORK_VOLUME_ID")),
  volumeMountPath:
    trimToNull(getServerEnv("RUNPOD_VOLUME_MOUNT_PATH")) ?? "/workspace",
  containerDiskGb: Number(getServerEnv("RUNPOD_CUSTOM_VLLM_CONTAINER_DISK_GB") || "30"),
  workersMin: Number(getServerEnv("RUNPOD_WORKERS_MIN") || "0"),
  workersMax: Number(getServerEnv("RUNPOD_WORKERS_MAX") || "1"),
  idleTimeoutSeconds: Number(getServerEnv("RUNPOD_IDLE_TIMEOUT_SECONDS") || "60"),
  executionTimeoutMs: Number(getServerEnv("RUNPOD_EXECUTION_TIMEOUT_MS") || "600000"),
  flashboot: getServerEnv("RUNPOD_FLASHBOOT") === "false" ? false : true,
  scalerValue: Number(getServerEnv("RUNPOD_SCALER_VALUE") || "1"),
  loadBalancerGpuIds:
    trimToNull(getServerEnv("RUNPOD_LOAD_BALANCER_GPU_IDS")) ??
    DEFAULT_LOAD_BALANCER_GPU_IDS,
  gpuTypeIds: parseCsvEnv("RUNPOD_GPU_TYPE_IDS", DEFAULT_GPU_TYPE_IDS),
  dataCenterIds: parseCsvEnv("RUNPOD_DATA_CENTER_IDS", DEFAULT_DATA_CENTER_IDS),
  containerRegistryAuthId: trimToNull(
    getServerEnv("RUNPOD_CONTAINER_REGISTRY_AUTH_ID"),
  ),
  hfToken: trimToNull(getServerEnv("HF_TOKEN")),
  baseModelRepo:
    trimToNull(getServerEnv("RUNPOD_BASE_MODEL_REPO")) ??
    "unsloth/Meta-Llama-3.1-8B-Instruct",
  baseModelRevision:
    trimToNull(getServerEnv("RUNPOD_BASE_MODEL_REVISION")) ??
    "a2856192dd7c25b842431f39c179a6c2c2f627d1",
  adapterRepo:
    trimToNull(getServerEnv("RUNPOD_ADAPTER_REPO")) ??
    "AutoBot000/npc-sim-manual-llama31-local-check-20260421-025259-adapter",
  adapterRevision:
    trimToNull(getServerEnv("RUNPOD_ADAPTER_REVISION")) ??
    "aa5c65b17f5ab9286f2f2c689cd66f0b0698606e",
  servedBaseModel:
    trimToNull(getServerEnv("RUNPOD_SERVED_BASE_MODEL")) ??
    "unsloth/Meta-Llama-3.1-8B-Instruct",
  servedLoraModel:
    trimToNull(getServerEnv("RUNPOD_SERVED_LORA_MODEL")) ??
    DEFAULT_SERVED_LORA_MODEL,
  maxModelLen: Number(getServerEnv("RUNPOD_MAX_MODEL_LEN") || "4096"),
  gpuMemoryUtilization:
    trimToNull(getServerEnv("RUNPOD_GPU_MEMORY_UTILIZATION")) ?? "0.90",
  maxLoras: Number(getServerEnv("RUNPOD_MAX_LORAS") || "1"),
  maxLoraRank: Number(getServerEnv("RUNPOD_MAX_LORA_RANK") || "8"),
} as const;
