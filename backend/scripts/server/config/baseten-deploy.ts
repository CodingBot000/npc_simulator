import { getServerEnv } from "@server/config";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export const basetenDeployConfig = {
  hfToken: trimToNull(getServerEnv("HF_TOKEN")),
  smokeTimeoutMs: Number(
    getServerEnv("BASETEN_SMOKE_TIMEOUT_MS") || String(20 * 60_000),
  ),
  autoscaling: {
    minReplica: Number(getServerEnv("BASETEN_MIN_REPLICA") || "0"),
    maxReplica: Number(getServerEnv("BASETEN_MAX_REPLICA") || "1"),
    autoscalingWindow: Number(getServerEnv("BASETEN_AUTOSCALING_WINDOW") || "60"),
    scaleDownDelay: Number(getServerEnv("BASETEN_SCALE_DOWN_DELAY") || "0"),
    concurrencyTarget: Number(getServerEnv("BASETEN_CONCURRENCY_TARGET") || "8"),
    targetUtilizationPercentage: Number(
      getServerEnv("BASETEN_TARGET_UTILIZATION_PERCENTAGE") || "70",
    ),
  },
} as const;
