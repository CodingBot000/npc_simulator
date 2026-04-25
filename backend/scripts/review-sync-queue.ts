import { ensureNpcSimulatorRoot } from "@backend-support/bootstrap";

ensureNpcSimulatorRoot(import.meta.url, "..", "..");

const postgresModulePromise = import("@server/db/postgres");
const reviewDbModulePromise = import("@server/db/review-db");

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function main() {
  const {
    syncReviewLlmFirstPassFromFilesToDb,
    syncReviewQueueFromFilesToDb,
  } = await reviewDbModulePromise;
  const mode = readOption("--mode") ?? "review-queue";
  const params = {
    sftJsonPath: readOption("--sft-json"),
    pairJsonPath: readOption("--pair-json"),
    sftJsonlPath: readOption("--sft-jsonl"),
    pairJsonlPath: readOption("--pair-jsonl"),
  };

  if (mode === "review-queue") {
    await syncReviewQueueFromFilesToDb(params);
    return;
  }

  if (mode === "llm-first-pass") {
    await syncReviewLlmFirstPassFromFilesToDb(params);
    return;
  }

  throw new Error(`unsupported --mode '${mode}'`);
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
