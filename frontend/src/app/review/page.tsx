import { ReviewDashboard } from "@/components/review/review-dashboard";
import { buildServerApiUrl } from "@/lib/api-client";
import type { ReviewDashboardData } from "@/lib/review-types";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const response = await fetch(buildServerApiUrl("/api/review"), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("검수 데이터를 불러오지 못했습니다.");
  }

  const data = (await response.json()) as ReviewDashboardData;

  return <ReviewDashboard initialData={data} />;
}
