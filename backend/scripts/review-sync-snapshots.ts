import { ensureNpcSimulatorRoot } from "@backend-support/bootstrap";

ensureNpcSimulatorRoot(import.meta.url, "..", "..");

const postgresModulePromise = import("@server/db/postgres");
const reviewDbModulePromise = import("@server/db/review-db");

async function main() {
  const { syncSnapshotsFromFilesToDb } = await reviewDbModulePromise;
  await syncSnapshotsFromFilesToDb();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closeDbPool } = await postgresModulePromise;
    await closeDbPool().catch(() => {});
  });
