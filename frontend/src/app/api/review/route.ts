import { NextResponse } from "next/server";
import {
  getReviewDashboardApiResponse,
  patchReviewDecisionApiResponse,
} from "@/server/api/review-api";

export const runtime = "nodejs";

export async function GET() {
  const result = await getReviewDashboardApiResponse();
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(request: Request) {
  const result = await patchReviewDecisionApiResponse(await request.json());
  return NextResponse.json(result.body, { status: result.status });
}
