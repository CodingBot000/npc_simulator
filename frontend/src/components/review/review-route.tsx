import { useEffect, useState } from "react";
import { apiGetReviewDashboard } from "@/lib/api-client";
import type { ReviewDashboardData } from "@/lib/review-types";
import { ReviewDashboard } from "@/components/review/review-dashboard";

function ReviewRouteLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <section className="panel-surface rounded-[28px] px-5 py-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
          Compact Review
        </p>
        <h1 className="display-heading text-3xl font-semibold text-foreground">
          검수 데이터를 불러오는 중
        </h1>
        <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
          백엔드 검수 API 상태를 확인하고 있습니다.
        </p>
      </section>
    </main>
  );
}

function ReviewRouteError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <section className="panel-surface rounded-[28px] px-5 py-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Compact Review
        </p>
        <h1 className="display-heading text-3xl font-semibold text-foreground">
          검수 데이터를 불러오지 못했습니다
        </h1>
        <p className="mt-2 rounded-2xl bg-rose-100 px-4 py-3 text-sm text-[var(--danger)]">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-full bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105"
        >
          다시 불러오기
        </button>
      </section>
    </main>
  );
}

export function ReviewRoute() {
  const [data, setData] = useState<ReviewDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReviewData() {
      setError(null);

      try {
        setData(
          await apiGetReviewDashboard({
            cache: "no-store",
            signal: controller.signal,
          }),
        );
      } catch (reviewError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          reviewError instanceof Error
            ? reviewError.message
            : "검수 데이터를 불러오지 못했습니다.",
        );
      }
    }

    void loadReviewData();

    return () => controller.abort();
  }, [reloadToken]);

  if (error) {
    return (
      <ReviewRouteError
        message={error}
        onRetry={() => {
          setData(null);
          setReloadToken((current) => current + 1);
        }}
      />
    );
  }

  if (!data) {
    return <ReviewRouteLoading />;
  }

  return <ReviewDashboard initialData={data} />;
}
