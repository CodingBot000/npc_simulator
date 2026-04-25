import { createHash, randomBytes } from "node:crypto";
import type { AutonomyRuntimeState } from "@backend-persistence";
import type { AutonomyRandom } from "@server/engine/npc-autonomy/types";

function hashFraction(seed: string, drawIndex: number) {
  const digest = createHash("sha256")
    .update(`${seed}:${drawIndex}`)
    .digest();
  const numerator = digest.readUIntBE(0, 6);
  return numerator / 0x1000000000000;
}

function coerceRuntimeState(value: Partial<AutonomyRuntimeState> | null | undefined) {
  if (!value || typeof value.liveSeed !== "string" || !value.liveSeed.trim()) {
    return null;
  }

  const drawCount =
    typeof value.drawCount === "number" && Number.isInteger(value.drawCount) && value.drawCount >= 0
      ? value.drawCount
      : 0;

  return {
    liveSeed: value.liveSeed.trim(),
    drawCount,
  } satisfies AutonomyRuntimeState;
}

/**
 * Build the per-episode autonomy RNG state. Live play uses a fresh crypto seed,
 * while debug mode can pin the seed through scenario config.
 */
export function createAutonomyRuntimeState(debugSeed: string | null): AutonomyRuntimeState {
  return {
    liveSeed: debugSeed?.trim() || randomBytes(16).toString("hex"),
    drawCount: 0,
  };
}

/**
 * Normalize stored runtime state without introducing per-read randomness. When
 * older bundles are missing autonomy runtime, derive a stable fallback from the
 * episode id until the next mutation persists it.
 */
export function normalizeAutonomyRuntimeState(params: {
  value: Partial<AutonomyRuntimeState> | null | undefined;
  fallbackSeed: string;
  debugSeed: string | null;
}) {
  const existing = coerceRuntimeState(params.value);

  if (existing) {
    return existing;
  }

  return {
    liveSeed: params.debugSeed?.trim() || params.fallbackSeed,
    drawCount: 0,
  } satisfies AutonomyRuntimeState;
}

/**
 * Create a traceable deterministic RNG backed by the persisted episode seed and
 * draw count so save/load cycles remain reproducible.
 */
export function createAutonomyRandom(runtime: AutonomyRuntimeState): AutonomyRandom {
  const trace: Array<{ label: string; drawIndex: number; value: number }> = [];

  function nextFloat(label: string) {
    const drawIndex = runtime.drawCount;
    const value = hashFraction(runtime.liveSeed, drawIndex);
    runtime.drawCount += 1;
    trace.push({
      label,
      drawIndex,
      value: Number(value.toFixed(6)),
    });
    return value;
  }

  return {
    runtime,
    nextFloat,
    pickInt(min: number, max: number, label: string) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
        throw new Error(`Invalid pickInt range: ${min}..${max}`);
      }

      if (min === max) {
        return min;
      }

      const span = max - min + 1;
      return min + Math.floor(nextFloat(`${label}:int`) * span);
    },
    pickWeighted<T>(
      options: Array<{ value: T; weight: number }>,
      label: string,
    ) {
      const eligible = options.filter((option) => Number.isFinite(option.weight) && option.weight > 0);

      if (eligible.length === 0) {
        return null;
      }

      const totalWeight = eligible.reduce((sum, option) => sum + option.weight, 0);
      let cursor = nextFloat(`${label}:weight`) * totalWeight;

      for (const option of eligible) {
        cursor -= option.weight;
        if (cursor <= 0) {
          return option.value;
        }
      }

      return eligible.at(-1)?.value ?? null;
    },
    drainSamples() {
      const samples = [...trace];
      trace.length = 0;
      return samples;
    },
  };
}
