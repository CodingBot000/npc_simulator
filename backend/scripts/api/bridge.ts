import path from "node:path";
import { fileURLToPath } from "node:url";
import { postInteractApiResponse } from "@server/api/interaction-api";
import { postRuntimeInteractWorkerResponse } from "../runtime/interaction-worker";
import { closeDbPool } from "@server/db/postgres";
import {
  getInspectorApiResponse,
  getWorldApiResponse,
  resetWorldApiResponse,
} from "@server/api/world-api";
import { createSeedStateBundle } from "../runtime/world-bundle";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

process.env.NPC_SIMULATOR_ROOT ??= repoRoot;

interface BridgeInput {
  headers?: Record<string, string | null | undefined>;
  body?: unknown;
}

async function readInput(): Promise<BridgeInput> {
  process.stdin.setEncoding("utf8");

  let raw = "";

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw) as BridgeInput;
}

async function main() {
  const operation = process.argv[2];
  const input = await readInput();

  switch (operation) {
    case "world":
      return getWorldApiResponse(input.headers);
    case "reset":
      return resetWorldApiResponse(input.headers);
    case "interact":
      return postInteractApiResponse({
        headers: input.headers,
        body: input.body,
      });
    case "runtime-interact-worker":
      return postRuntimeInteractWorkerResponse(input.body);
    case "inspector":
      return getInspectorApiResponse(input.headers);
    case "runtime-seed-bundle":
      return {
        status: 200,
        body: createSeedStateBundle(),
      };
    default:
      return {
        status: 400,
        body: {
          message: `unknown bridge operation: ${operation ?? "missing"}`,
        },
      };
  }
}

main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stdout.write(
      `${JSON.stringify({
        status: 500,
        body: {
          message:
            error instanceof Error
              ? error.message
              : "bridge execution failed",
        },
      })}\n`,
    );
    process.exitCode = 0;
  })
  .finally(async () => {
    await closeDbPool().catch(() => {});
  });
