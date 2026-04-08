import { NextResponse } from "next/server";
import { getWorldSnapshot } from "@/server/engine/world-state";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getWorldSnapshot());
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "월드 데이터를 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
