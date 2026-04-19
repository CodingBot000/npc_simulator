import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeTrainingEvalResources, runTrainingGoldenEvalWorker } from "./review/eval";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

process.env.NPC_SIMULATOR_ROOT ??= repoRoot;

function readRequiredOption(flag: string) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) {
    throw new Error(`missing ${flag}`);
  }
  return value;
}

function readOptionalOption(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const summary = await runTrainingGoldenEvalWorker({
    runId: readRequiredOption("--run-id"),
    bindingKey: readRequiredOption("--binding-key"),
    baselineLabel: readRequiredOption("--baseline-label"),
    baselineAdapterPath: readOptionalOption("--baseline-adapter-path"),
    casesPath: readRequiredOption("--cases"),
    provider: readRequiredOption("--provider"),
    judgeModel: readOptionalOption("--judge-model"),
  });

  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTrainingEvalResources();
  });
