import { getServerEnv } from "@server/config";

const DEFAULT_RUNPOD_VLLM_IMAGE = "runpod/worker-vllm:stable-cuda12.1.0";
const DEFAULT_GPU_TYPE_IDS = [
  "NVIDIA L4",
  "NVIDIA RTX A5000",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 4090",
];

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseGpuTypeIds() {
  const raw = trimToNull(getServerEnv("RUNPOD_GPU_TYPE_IDS"));
  if (!raw) {
    return DEFAULT_GPU_TYPE_IDS;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const runpodDeployConfig = {
  hfRepoPrefix: trimToNull(getServerEnv("RUNPOD_HF_REPO_PREFIX")) ?? "npc-sim",
  hfToken: trimToNull(getServerEnv("HF_TOKEN")),
  gpuTypeIds: parseGpuTypeIds(),
  endpointNamePrefix:
    trimToNull(getServerEnv("RUNPOD_ENDPOINT_NAME_PREFIX")) ?? "npc-sim",
  servedModelPrefix:
    trimToNull(getServerEnv("RUNPOD_SERVED_MODEL_PREFIX")) ?? "npc-sim",
  readyTimeoutMs: Number(getServerEnv("RUNPOD_DEPLOY_READY_TIMEOUT_MS") || String(12 * 60_000)),
  readyPollMs: Number(getServerEnv("RUNPOD_DEPLOY_READY_POLL_MS") || "5000"),
  vllmImage: trimToNull(getServerEnv("RUNPOD_VLLM_IMAGE")) ?? DEFAULT_RUNPOD_VLLM_IMAGE,
  containerDiskGb: 50,
  workersMin: Number(getServerEnv("RUNPOD_WORKERS_MIN") || "0"),
  workersMax: Number(getServerEnv("RUNPOD_WORKERS_MAX") || "1"),
  idleTimeoutSeconds: Number(getServerEnv("RUNPOD_IDLE_TIMEOUT_SECONDS") || "5"),
  executionTimeoutMs: Number(getServerEnv("RUNPOD_EXECUTION_TIMEOUT_MS") || "600000"),
  flashboot: getServerEnv("RUNPOD_FLASHBOOT") === "false" ? false : true,
  scalerValue: Number(getServerEnv("RUNPOD_SCALER_VALUE") || "4"),
} as const;
