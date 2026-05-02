import type { ReviewFinalizeStatusView } from "@backend-contracts/review";
import {
  ensureSnapshotsSeededFromFiles,
  getActiveSnapshotSummary,
} from "@server/db/review-snapshot-db";
import { getLatestFinalizeRunFromDb } from "@server/db/review-training-run-db";
import { asNumber, asObject, asString, isoString } from "@server/db/review-db-core";
import {
  getLatestReviewUpdatedAtFromDb,
  getPendingReviewCountsFromDb,
} from "@server/db/review-human-review-db";

export async function getReviewFinalizeStatusFromDb(): Promise<ReviewFinalizeStatusView> {
  const pending = await getPendingReviewCountsFromDb();
  const latestReviewUpdatedAt = await getLatestReviewUpdatedAtFromDb();
  await ensureSnapshotsSeededFromFiles();

  const [latestRun, activeSft, activePreference] = await Promise.all([
    getLatestFinalizeRunFromDb(),
    getActiveSnapshotSummary("sft"),
    getActiveSnapshotSummary("preference"),
  ]);
  const metrics = asObject(latestRun?.metrics_json);
  const durations = asObject(metrics.durations);
  const outputs = asObject(metrics.outputs);
  const latestSnapshotAt =
    [activeSft?.generatedAt, activePreference?.generatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const canFinalize =
    pending.total === 0 &&
    latestRun?.state !== "running" &&
    (!latestSnapshotAt ||
      !latestReviewUpdatedAt ||
      Date.parse(latestSnapshotAt) < Date.parse(latestReviewUpdatedAt));

  return {
    state:
      latestRun?.run_kind === "finalize"
        ? ((latestRun.state as ReviewFinalizeStatusView["state"]) ?? "idle")
        : "idle",
    canFinalize,
    pending,
    currentStep:
      latestRun?.run_kind === "finalize"
        ? ((latestRun.current_step as ReviewFinalizeStatusView["currentStep"]) ?? null)
        : null,
    message: latestRun?.run_kind === "finalize" ? latestRun.message : null,
    startedAt: isoString(latestRun?.started_at ?? null),
    finishedAt: isoString(latestRun?.finished_at ?? null),
    updatedAt: isoString(latestRun?.updated_at ?? null),
    durations: {
      sftMs: asNumber(durations.sftMs),
      preferenceMs: asNumber(durations.preferenceMs),
      totalMs: asNumber(durations.totalMs),
    },
    outputs: {
      sft: asString(outputs.sft),
      preference: asString(outputs.preference),
    },
  };
}
