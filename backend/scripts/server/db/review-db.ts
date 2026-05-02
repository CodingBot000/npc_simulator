import { PIPELINE_FILES, readJsonlFile } from "@server/db/review-db-core";

export {
  ensureSnapshotsSeededFromFiles,
  getActiveSnapshotSummary,
  syncSnapshotsFromFilesToDb,
} from "@server/db/review-snapshot-db";
export { upsertEpisodeExportToDb } from "@server/db/review-episode-export-db";
export { getReviewFinalizeStatusFromDb } from "@server/db/review-finalize-status-db";
export {
  exportReviewQueueFilesFromDb,
  getHumanReviewRawDataFromDb,
  getLatestReviewUpdatedAtFromDb,
  getPendingReviewCountsFromDb,
  getSourceTaskKeysFromDb,
  updateReviewDecisionInDb,
} from "@server/db/review-human-review-db";
export {
  seedReviewTasksFromFiles,
  syncReviewLlmFirstPassFromFilesToDb,
  syncReviewQueueFromFilesToDb,
} from "@server/db/review-queue-db";
export {
  appendTrainingRunEventInDb,
  appendTrainingRunLogChunkInDb,
  createFinalizeRunInDb,
  createTrainingRunInDb,
  getLatestFinalizeRunFromDb,
  getLatestSuccessfulTrainingRun,
  getTrainingRunByFingerprint,
  getTrainingRunSpecFromDb,
  getTrainingRunViewsFromDb,
  getTrainingStatusFromDb,
  listTrainingRunsFromDb,
  registerTrainingArtifactInDb,
  updateFinalizeRunInDb,
  updateTrainingRunRemoteDeploymentInDb,
  updateTrainingRunStateInDb,
} from "@server/db/review-training-run-db";
export type { TrainingRunSpecRecord } from "@server/db/review-training-run-db";

export async function loadPipelineCompletedRawData() {
  const [judgedSftRaw, judgedPairRaw] = await Promise.all([
    readJsonlFile(PIPELINE_FILES.judgedSft),
    readJsonlFile(PIPELINE_FILES.judgedPairs),
  ]);

  return {
    judgedSftRaw,
    judgedPairRaw,
  };
}
