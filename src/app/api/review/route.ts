import { NextResponse } from "next/server";
import { z } from "zod";
import { updateReviewDecision } from "@/server/review/review-store";

export const runtime = "nodejs";

const sftSchema = z.object({
  kind: z.literal("sft"),
  reviewId: z.string().min(1),
  decision: z.enum(["include", "exclude", "escalate"]).nullable(),
  reviewer: z.string().optional().nullable(),
  notes: z.string().optional(),
});

const pairSchema = z.object({
  kind: z.literal("pair"),
  reviewId: z.string().min(1),
  decision: z.enum(["include", "flip", "exclude", "escalate"]).nullable(),
  reviewer: z.string().optional().nullable(),
  notes: z.string().optional(),
});

const requestSchema = z.union([sftSchema, pairSchema]);

export async function PATCH(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const result = await updateReviewDecision(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "잘못된 검수 저장 요청입니다.", issues: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "검수 결과를 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
