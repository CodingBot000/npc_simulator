import { NextResponse } from "next/server";
import {
  getReviewFinalizeStatus,
  runReviewFinalize,
} from "@/server/review/review-finalize";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getReviewFinalizeStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "finalize 상태를 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const status = await runReviewFinalize();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "finalize 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
