import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDbPool } from "@server/db/postgres";
import {
  syncReviewLlmFirstPassFromFilesToDb,
  syncReviewQueueFromFilesToDb,
} from "@server/db/review-db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

process.env.NPC_SIMULATOR_ROOT ??= repoRoot;

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function main() {
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
    await closeDbPool().catch(() => {});
  });
