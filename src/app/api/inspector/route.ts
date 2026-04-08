import { NextResponse } from "next/server";
import { createWorldRepository } from "@/server/store/repositories";

export const runtime = "nodejs";

export async function GET() {
  try {
    const repository = createWorldRepository();
    const worldState = await repository.readWorldState();
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
      { status: 500 },
    );
  }
}
