import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDbPool } from "@server/db/postgres";
import { syncSnapshotsFromFilesToDb } from "@server/db/review-db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

process.env.NPC_SIMULATOR_ROOT ??= repoRoot;

async function main() {
  await syncSnapshotsFromFilesToDb();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool().catch(() => {});
  });
