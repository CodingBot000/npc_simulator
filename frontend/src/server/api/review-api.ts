import { z } from "zod";
import { apiResult, type ApiResult } from "@/server/api/response";
import {
  getReviewFinalizeStatus,
  runReviewFinalize,
} from "@/server/review/review-finalize";
import {
  getReviewDashboardData,
  updateReviewDecision,
} from "@/server/review/review-store";

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

export async function getReviewDashboardApiResponse(): Promise<ApiResult> {
  try {
    return apiResult(200, await getReviewDashboardData());
  } catch (error) {
    return apiResult(500, {
      message:
        error instanceof Error ? error.message : "검수 데이터를 불러오지 못했습니다.",
    });
  }
}

export async function patchReviewDecisionApiResponse(
  body: unknown,
): Promise<ApiResult> {
  try {
    const payload = requestSchema.parse(body);
    return apiResult(200, await updateReviewDecision(payload));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiResult(400, {
        message: "잘못된 검수 저장 요청입니다.",
        issues: error.issues,
      });
    }

    return apiResult(500, {
      message:
        error instanceof Error ? error.message : "검수 결과를 저장하지 못했습니다.",
    });
  }
}

export async function getReviewFinalizeStatusApiResponse(): Promise<ApiResult> {
  try {
    return apiResult(200, await getReviewFinalizeStatus());
  } catch (error) {
    return apiResult(500, {
      message:
        error instanceof Error
          ? error.message
          : "finalize 상태를 불러오지 못했습니다.",
    });
  }
}

export async function postReviewFinalizeApiResponse(): Promise<ApiResult> {
  try {
    return apiResult(200, await runReviewFinalize());
  } catch (error) {
    return apiResult(500, {
      message:
        error instanceof Error ? error.message : "finalize 실행에 실패했습니다.",
    });
  }
}
