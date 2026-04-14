import { NextResponse } from "next/server";
import { resetWorldApiResponse } from "@/server/api/world-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const result = await resetWorldApiResponse(request.headers);
  return NextResponse.json(result.body, { status: result.status });
}
