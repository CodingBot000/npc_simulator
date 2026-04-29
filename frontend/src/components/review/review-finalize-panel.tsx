import type { ReviewFinalizeStatusView } from "@/lib/review-types";
import { TextBlock } from "./review-dashboard-primitives";
import {
  formatDuration,
  formatTimestamp,
} from "./review-formatters";

type ReviewFinalizePanelProps = {
  status: ReviewFinalizeStatusView | null;
  error: string | null;
  pendingRequiredTotal: number;
  onFinalize: () => void;
};

export function ReviewFinalizePanel({
  status,
  error,
  pendingRequiredTotal,
  onFinalize,
}: ReviewFinalizePanelProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
        <p className="text-sm font-semibold text-foreground">Finalize</p>
        <p className="text-sm text-[var(--ink-muted)]">
          사람 검수 미완료가 `0`이면 최종 학습 데이터셋을 다시 생성할 수 있습니다.
        </p>
        <button
          type="button"
          onClick={onFinalize}
          disabled={status ? !status.canFinalize : pendingRequiredTotal > 0}
          className="rounded-full bg-[var(--teal)] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status?.state === "running" ? "Finalize 실행 중..." : "Finalize 실행"}
        </button>
        <p className="text-xs text-[var(--ink-muted)]">
          로컬 실측: SFT 약 55ms, preference 약 47ms, 전체 약 0.1초
        </p>
      </div>

      <TextBlock>
        <p className="mb-2 text-sm font-semibold text-foreground">현재 상태</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
            사람 검수 미완료 {pendingRequiredTotal}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status?.state === "succeeded"
                ? "bg-[rgba(74,166,124,0.16)] text-[var(--success)]"
                : status?.state === "failed"
                  ? "bg-[rgba(214,90,90,0.16)] text-[var(--danger)]"
                  : status?.state === "running"
                    ? "bg-[rgba(76,194,200,0.16)] text-[var(--teal)]"
                    : "bg-white/6 text-[var(--ink-muted)]"
            }`}
          >
            {status?.state === "succeeded"
              ? "완료"
              : status?.state === "failed"
                ? "실패"
                : status?.state === "running"
                  ? "실행 중"
                  : "대기"}
          </span>
          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
            단계{" "}
            {status?.currentStep === "finalize_sft"
              ? "SFT finalize"
              : status?.currentStep === "finalize_preference"
                ? "Preference finalize"
                : "-"}
          </span>
        </div>

        <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
          <p>메시지: {error ?? status?.message ?? "-"}</p>
          <p>시작: {formatTimestamp(status?.startedAt ?? null)}</p>
          <p>완료: {formatTimestamp(status?.finishedAt ?? null)}</p>
          <p>
            소요: SFT {formatDuration(status?.durations.sftMs ?? null)} / Preference{" "}
            {formatDuration(status?.durations.preferenceMs ?? null)} / 전체{" "}
            {formatDuration(status?.durations.totalMs ?? null)}
          </p>
        </div>
      </TextBlock>
    </div>
  );
}
