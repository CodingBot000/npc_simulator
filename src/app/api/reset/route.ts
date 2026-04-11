import { NextResponse } from "next/server";
import { buildWorldSnapshot } from "@/server/engine/world-state";
import { getApiErrorStatus } from "@/server/errors";
import { getLlmProvider } from "@/server/providers/llm-provider";
import { createWorldRepository } from "@/server/store/repositories";
import { getWorldInstanceIdFromRequest } from "@/server/store/instance-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const instanceId = getWorldInstanceIdFromRequest(request);
    const repository = createWorldRepository({ instanceId });
    const [{ worldState, memoryFile, interactionLog }, runtime] = await Promise.all([
      repository.resetToSeed(),
      getLlmProvider().getStatus(),
    ]);

    return NextResponse.json(
      buildWorldSnapshot({
        worldState,
        memories: memoryFile.memories,
        interactionLog: interactionLog.entries,
        runtime,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "상태 초기화에 실패했습니다.",
      },
      { status: getApiErrorStatus(error) },
    );
  }
}
