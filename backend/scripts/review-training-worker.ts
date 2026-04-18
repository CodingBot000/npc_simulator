import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDbPool } from "@server/db/postgres";
import { runReviewTrainingWorker } from "./review/training";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

process.env.NPC_SIMULATOR_ROOT ??= repoRoot;

async function main() {
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
  await closeDbPool().catch(() => {});
});
