import { NextResponse } from "next/server";
import { getWorldSnapshot } from "@/server/engine/world-state";
import { createWorldRepository } from "@/server/store/repositories";

export const runtime = "nodejs";

export async function POST() {
  try {
    const repository = createWorldRepository();
    await repository.resetToSeed();
    return NextResponse.json(await getWorldSnapshot());
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "상태 초기화에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
