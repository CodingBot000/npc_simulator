import { ensureNpcSimulatorRoot } from "@backend-support/bootstrap";

ensureNpcSimulatorRoot(import.meta.url, "..", "..");

const postgresModulePromise = import("@server/db/postgres");
const reviewTrainingModulePromise = import("./review/training");

async function main() {
  const { runReviewTrainingWorker } = await reviewTrainingModulePromise;
  const runIdIndex = process.argv.indexOf("--run-id");
  const runId =
    runIdIndex >= 0 ? process.argv[runIdIndex + 1] : process.argv[2] ?? null;

  if (!runId) {
    throw new Error("missing --run-id for review training worker");
  }

  await runReviewTrainingWorker(runId);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  const { closeDbPool } = await postgresModulePromise;
  await closeDbPool().catch(() => {});
});
