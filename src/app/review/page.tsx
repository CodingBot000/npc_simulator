import { ReviewDashboard } from "@/components/review/review-dashboard";
import { getReviewDashboardData } from "@/server/review/review-store";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const data = await getReviewDashboardData();

  return <ReviewDashboard initialData={data} />;
}
