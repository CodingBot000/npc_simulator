import { NextResponse } from "next/server";
import {
  getReviewFinalizeStatusApiResponse,
  postReviewFinalizeApiResponse,
} from "@/server/api/review-api";

export const runtime = "nodejs";

export async function GET() {
  const result = await getReviewFinalizeStatusApiResponse();
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST() {
  const result = await postReviewFinalizeApiResponse();
  return NextResponse.json(result.body, { status: result.status });
}
