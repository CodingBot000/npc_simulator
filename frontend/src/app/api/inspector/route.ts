import { NextResponse } from "next/server";
import { getApiErrorStatus } from "@/server/errors";
import { createWorldRepository } from "@/server/store/repositories";
import { getWorldInstanceIdFromRequest } from "@/server/store/instance-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const instanceId = getWorldInstanceIdFromRequest(request);
    const repository = createWorldRepository({ instanceId });
    const { worldState } = await repository.readStateBundle();
    return NextResponse.json({
      inspector: worldState.lastInspector,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "감독자 정보를 불러오지 못했습니다.",
      },
      { status: getApiErrorStatus(error) },
    );
  }
}
