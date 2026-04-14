import { NextResponse } from "next/server";
import { getInspectorApiResponse } from "@/server/api/world-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const result = await getInspectorApiResponse(request.headers);
  return NextResponse.json(result.body, { status: result.status });
}
