import { NextResponse } from "next/server";
import { getWorldApiResponse } from "@/server/api/world-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const result = await getWorldApiResponse(request.headers);
  return NextResponse.json(result.body, { status: result.status });
}
