import path from "node:path";
import { fileURLToPath } from "node:url";
import { postInteractApiResponse } from "@/server/api/interaction-api";
import {
  getReviewDashboardApiResponse,
  getReviewFinalizeStatusApiResponse,
  patchReviewDecisionApiResponse,
  postReviewFinalizeApiResponse,
} from "@/server/api/review-api";
import {
  getInspectorApiResponse,
  getWorldApiResponse,
  resetWorldApiResponse,
} from "@/server/api/world-api";

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
      return postInteractApiResponse(input);
    case "inspector":
      return getInspectorApiResponse(input.headers);
    case "review-dashboard":
      return getReviewDashboardApiResponse();
    case "review-update":
      return patchReviewDecisionApiResponse(input.body);
    case "review-finalize-status":
      return getReviewFinalizeStatusApiResponse();
    case "review-finalize-run":
      return postReviewFinalizeApiResponse();
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
  });
