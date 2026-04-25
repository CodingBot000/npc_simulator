import { ensureNpcSimulatorRoot } from "@backend-support/bootstrap";

ensureNpcSimulatorRoot(import.meta.url, "..", "..", "..");

const postgresModulePromise = import("@server/db/postgres");
const interactionApiModulePromise = import("@server/api/interaction-api");
const interactionWorkerModulePromise = import("../runtime/interaction-worker");
const worldApiModulePromise = import("@server/api/world-api");
const worldBundleModulePromise = import("../runtime/world-bundle");

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
  const [
    { postInteractApiResponse },
    { postRuntimeInteractWorkerResponse },
    {
      getInspectorApiResponse,
      getWorldApiResponse,
      resetWorldApiResponse,
    },
    { createSeedStateBundle },
  ] = await Promise.all([
    interactionApiModulePromise,
    interactionWorkerModulePromise,
    worldApiModulePromise,
    worldBundleModulePromise,
  ]);
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
    const { closeDbPool } = await postgresModulePromise;
    await closeDbPool().catch(() => {});
  });
