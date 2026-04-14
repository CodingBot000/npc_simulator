import { z } from "zod";
import { playerActions } from "@/lib/types";
import { interactWithNpc } from "@/server/engine/npc-engine";
import { getApiErrorStatus } from "@/server/errors";
import { getWorldInstanceIdFromHeaders, type HeaderBag } from "@/server/api/headers";
import { apiResult, type ApiResult } from "@/server/api/response";

const requestSchema = z.object({
  npcId: z.string().min(1),
  targetNpcId: z.string().min(1).nullable(),
  inputMode: z.enum(["free_text", "action"]),
  text: z.string(),
  action: z.enum(playerActions).nullable(),
  playerId: z.string().min(1),
});

export async function postInteractApiResponse(params: {
  headers?: HeaderBag;
  body: unknown;
}): Promise<ApiResult> {
  try {
    const instanceId = getWorldInstanceIdFromHeaders(params.headers);
    const payload = requestSchema.parse(params.body);
    return apiResult(200, await interactWithNpc(payload, { instanceId }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiResult(400, {
        message: "잘못된 상호작용 요청입니다.",
        issues: error.issues,
      });
    }

    return apiResult(getApiErrorStatus(error), {
      message:
        error instanceof Error
          ? error.message
          : "상호작용 처리 중 오류가 발생했습니다.",
    });
  }
}
