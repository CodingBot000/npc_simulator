import { buildWorldSnapshot, getWorldSnapshot } from "@/server/engine/world-state";
import { getApiErrorStatus } from "@/server/errors";
import { getLlmProvider } from "@/server/providers/llm-provider";
import { createWorldRepository } from "@/server/store/repositories";
import { getWorldInstanceIdFromHeaders, type HeaderBag } from "@/server/api/headers";
import { apiResult, type ApiResult } from "@/server/api/response";

export async function getWorldApiResponse(
  headers?: HeaderBag,
): Promise<ApiResult> {
  try {
    const instanceId = getWorldInstanceIdFromHeaders(headers);
    return apiResult(200, await getWorldSnapshot({ instanceId }));
  } catch (error) {
    return apiResult(getApiErrorStatus(error), {
      message:
        error instanceof Error ? error.message : "월드 데이터를 불러오지 못했습니다.",
    });
  }
}

export async function resetWorldApiResponse(
  headers?: HeaderBag,
): Promise<ApiResult> {
  try {
    const instanceId = getWorldInstanceIdFromHeaders(headers);
    const repository = createWorldRepository({ instanceId });
    const [{ worldState, memoryFile, interactionLog }, runtime] = await Promise.all([
      repository.resetToSeed(),
      getLlmProvider().getStatus(),
    ]);

    return apiResult(
      200,
      buildWorldSnapshot({
        worldState,
        memories: memoryFile.memories,
        interactionLog: interactionLog.entries,
        runtime,
      }),
    );
  } catch (error) {
    return apiResult(getApiErrorStatus(error), {
      message:
        error instanceof Error ? error.message : "상태 초기화에 실패했습니다.",
    });
  }
}

export async function getInspectorApiResponse(
  headers?: HeaderBag,
): Promise<ApiResult> {
  try {
    const instanceId = getWorldInstanceIdFromHeaders(headers);
    const repository = createWorldRepository({ instanceId });
    const { worldState } = await repository.readStateBundle();
    return apiResult(200, {
      inspector: worldState.lastInspector,
    });
  } catch (error) {
    return apiResult(getApiErrorStatus(error), {
      message:
        error instanceof Error ? error.message : "감독자 정보를 불러오지 못했습니다.",
    });
  }
}
