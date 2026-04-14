import { NextResponse } from "next/server";
import { postInteractApiResponse } from "@/server/api/interaction-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const result = await postInteractApiResponse({
    headers: request.headers,
    body: await request.json(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
