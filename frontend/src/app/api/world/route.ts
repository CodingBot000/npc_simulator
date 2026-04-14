import { NextResponse } from "next/server";
import { getWorldSnapshot } from "@/server/engine/world-state";
import { getApiErrorStatus } from "@/server/errors";
import { getWorldInstanceIdFromRequest } from "@/server/store/instance-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const instanceId = getWorldInstanceIdFromRequest(request);
    return NextResponse.json(await getWorldSnapshot({ instanceId }));
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "월드 데이터를 불러오지 못했습니다.",
      },
      { status: getApiErrorStatus(error) },
    );
  }
}
