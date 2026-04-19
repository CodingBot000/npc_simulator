import { z } from "zod";
import { parseInteractionRequestPayload } from "@server/api/interaction-api";
import { apiResult, type ApiResult } from "@server/api/response";
import { getApiErrorStatus } from "@server/errors";
import { runInteractionTurn } from "@server/engine/npc-engine";
import { normalizeBundle } from "./world-bundle";

const workerRequestSchema = z.object({
  request: z.unknown(),
  bundle: z.object({
    worldState: z.unknown(),
    memoryFile: z.unknown().optional(),
    interactionLog: z.unknown().optional(),
  }),
});

export async function postRuntimeInteractWorkerResponse(
  body: unknown,
): Promise<ApiResult> {
  try {
    const payload = workerRequestSchema.parse(body);
    const request = parseInteractionRequestPayload(payload.request);
    const bundle = normalizeBundle(
      payload.bundle as Parameters<typeof normalizeBundle>[0],
    );
    const result = await runInteractionTurn(bundle, request);

    return apiResult(200, {
      nextBundle: result.nextBundle,
      cleanupExportPaths: result.cleanupExportPaths,
      reply: result.reply,
      relationshipDelta: result.relationshipDelta,
      pressureChanges: result.pressureChanges,
      eventLogEntry: result.eventLogEntry,
      inspector: result.inspector,
      resolution: result.resolution,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiResult(400, {
        message: "잘못된 interaction worker 요청입니다.",
        issues: error.issues,
      });
    }

    return apiResult(getApiErrorStatus(error), {
      message:
        error instanceof Error
          ? error.message
          : "interaction worker 처리 중 오류가 발생했습니다.",
    });
  }
}
