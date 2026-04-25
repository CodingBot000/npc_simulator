import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  apiGetReviewFinalizeStatus,
  apiGetReviewTrainingStatus,
  apiPromoteReviewTrainingRun,
  apiRunReviewFinalize,
  apiRunReviewTraining,
  apiRunReviewTrainingEvaluation,
  apiUpdateReviewDecision,
  apiUpdateReviewTrainingDecision,
} from "@/lib/api-client";
import type {
  PairReviewItemView,
  ReviewCandidateView,
  ReviewDashboardData,
  ReviewDecisionRequest,
  ReviewDatasetView,
  ReviewFinalizeStatusView,
  ReviewKind,
  ReviewShadowInvalidCaseView,
  ReviewSourceMode,
  ReviewTrainingBindingKey,
  ReviewTrainingDecisionRequest,
  ReviewTrainingKind,
  ReviewTrainingRequest,
  ReviewTrainingRunView,
  ReviewTrainingRunActionRequest,
  ReviewTrainingStatusView,
  ReviewMutationResult,
  SftReviewItemView,
} from "@/lib/review-types";

type ReviewItem = SftReviewItemView | PairReviewItemView;

const SFT_DECISIONS: Exclude<SftReviewItemView["decision"], null>[] = [
  "include",
  "exclude",
  "escalate",
];
const PAIR_DECISIONS: Exclude<PairReviewItemView["decision"], null>[] = [
  "include",
  "flip",
  "exclude",
  "escalate",
];
const TRAINING_BINDING_KEYS: ReviewTrainingBindingKey[] = [
  "default",
  "doctor",
  "supervisor",
  "director",
];

function isSftItem(item: ReviewItem): item is SftReviewItemView {
  return item.kind === "sft";
}

function decisionLabel(decision: ReviewItem["decision"]) {
  switch (decision) {
    case "include":
      return "포함";
    case "exclude":
      return "제외";
    case "escalate":
      return "보류";
    case "flip":
      return "뒤집기";
    default:
      return "미정";
  }
}

function decisionTone(decision: ReviewItem["decision"]) {
  switch (decision) {
    case "include":
      return "bg-[rgba(74,166,124,0.16)] text-[var(--success)]";
    case "exclude":
      return "bg-[rgba(214,90,90,0.16)] text-[var(--danger)]";
    case "flip":
      return "bg-[rgba(209,111,76,0.16)] text-[var(--accent)]";
    case "escalate":
      return "bg-[rgba(76,194,200,0.16)] text-[var(--teal)]";
    default:
      return "bg-white/6 text-[var(--ink-muted)]";
  }
}

function summarize(items: ReviewItem[]) {
  return items.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      if (item.status === "reviewed" || item.decision) {
        accumulator.reviewed += 1;
      } else {
        accumulator.pending += 1;
      }

      const key = item.decision ?? "undecided";
      accumulator.decisions[key] = (accumulator.decisions[key] ?? 0) + 1;
      return accumulator;
    },
    {
      total: 0,
      reviewed: 0,
      pending: 0,
      decisions: {} as Record<string, number>,
    },
  );
}

function totalCount(dataset: ReviewDatasetView) {
  return dataset.sftItems.length + dataset.pairItems.length;
}

function isHumanReviewed(item: ReviewItem) {
  return item.decision !== null;
}

function filterDatasetByReviewedState(
  dataset: ReviewDatasetView,
  reviewed: boolean,
): ReviewDatasetView {
  return {
    sftItems: dataset.sftItems.filter((item) => isHumanReviewed(item) === reviewed),
    pairItems: dataset.pairItems.filter((item) => isHumanReviewed(item) === reviewed),
  };
}

function updateHumanItemInData(
  data: ReviewDashboardData,
  kind: ReviewKind,
  nextItem: ReviewItem,
): ReviewDashboardData {
  if (kind === "sft") {
    return {
      ...data,
      humanRequired: {
        ...data.humanRequired,
        sftItems: data.humanRequired.sftItems.map((item) =>
          item.reviewId === nextItem.reviewId ? (nextItem as SftReviewItemView) : item,
        ),
      },
    };
  }

  return {
    ...data,
    humanRequired: {
      ...data.humanRequired,
      pairItems: data.humanRequired.pairItems.map((item) =>
        item.reviewId === nextItem.reviewId ? (nextItem as PairReviewItemView) : item,
      ),
    },
  };
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "미기록";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}초`;
}

function formatElapsedClock(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "-";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
      {children}
    </p>
  );
}

function CardSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel-surface rounded-[28px] px-5 py-5 ${className}`}>
      {children}
    </section>
  );
}

function TextBlock({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm leading-7 text-foreground/95 ${className}`}
    >
      {children}
    </div>
  );
}

function ShadowInvalidCaseCard({
  item,
}: {
  item: ReviewShadowInvalidCaseView;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[rgba(209,111,76,0.16)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
          invalid_json
        </span>
        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] text-[var(--ink-muted)]">
          turn {item.turnIndex ?? "-"}
        </span>
        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] text-[var(--ink-muted)]">
          {item.npcId}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-muted)]">
        <p>
          episode {item.episodeId ?? "-"} · {formatTimestamp(item.exportedAt)}
        </p>
        <p>
          source {item.shadowLabel ?? "-"} · {formatDuration(item.durationMs)}
        </p>
        {item.sourceRef ? <p className="break-all">{item.sourceRef}</p> : null}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
            Player Input
          </p>
          <TextBlock>{item.playerText || "-"}</TextBlock>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
            Active Reply
          </p>
          <TextBlock>{item.activeReplyText || "-"}</TextBlock>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            Shadow Error
          </p>
          <TextBlock>{item.error || "-"}</TextBlock>
        </div>

        <details className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Raw Output 보기
          </summary>
          <TextBlock className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">
            {item.rawOutput || "-"}
          </TextBlock>
        </details>

        {item.exportPath ? (
          <p className="text-xs leading-5 text-[var(--ink-muted)]">{item.exportPath}</p>
        ) : null}
      </div>
    </div>
  );
}

function trainingActionButtonClassName(
  tone: "sft" | "dpo" | "eval" | "accept" | "reject" | "promote",
) {
  const baseClassName =
    "w-full rounded-full border px-5 py-2.5 text-sm font-semibold transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:-translate-y-0.5 active:translate-y-[1px] active:scale-[0.985] disabled:translate-y-0 disabled:scale-100 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-[rgba(255,255,255,0.04)] disabled:text-white/35 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:brightness-100 disabled:active:translate-y-0 disabled:active:scale-100";

  switch (tone) {
    case "sft":
      return `${baseClassName} border-[rgba(209,111,76,0.36)] bg-[rgba(209,111,76,0.92)] text-white shadow-[0_10px_24px_rgba(209,111,76,0.24)] hover:bg-[rgba(209,111,76,1)] hover:shadow-[0_14px_28px_rgba(209,111,76,0.34)] active:bg-[rgba(182,90,56,1)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.22)] focus-visible:ring-[rgba(209,111,76,0.5)]`;
    case "dpo":
      return `${baseClassName} border-[rgba(76,194,200,0.38)] bg-[rgba(76,194,200,0.92)] text-black shadow-[0_10px_24px_rgba(76,194,200,0.22)] hover:bg-[rgba(91,214,220,1)] hover:shadow-[0_14px_28px_rgba(76,194,200,0.32)] active:bg-[rgba(54,167,174,1)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.18)] focus-visible:ring-[rgba(76,194,200,0.5)]`;
    case "eval":
      return `${baseClassName} border-white/18 bg-white/7 text-foreground shadow-[0_10px_22px_rgba(0,0,0,0.12)] hover:border-white/30 hover:bg-white/13 hover:shadow-[0_14px_26px_rgba(0,0,0,0.18)] active:bg-white/16 active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.2)] focus-visible:ring-white/35`;
    case "accept":
      return `${baseClassName} border-[rgba(74,166,124,0.26)] bg-[rgba(74,166,124,0.18)] text-[var(--success)] shadow-[0_8px_18px_rgba(74,166,124,0.12)] hover:border-[rgba(74,166,124,0.42)] hover:bg-[rgba(74,166,124,0.28)] hover:shadow-[0_12px_24px_rgba(74,166,124,0.18)] active:bg-[rgba(74,166,124,0.34)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.18)] focus-visible:ring-[rgba(74,166,124,0.45)]`;
    case "reject":
      return `${baseClassName} border-[rgba(214,90,90,0.26)] bg-[rgba(214,90,90,0.18)] text-[var(--danger)] shadow-[0_8px_18px_rgba(214,90,90,0.12)] hover:border-[rgba(214,90,90,0.42)] hover:bg-[rgba(214,90,90,0.28)] hover:shadow-[0_12px_24px_rgba(214,90,90,0.18)] active:bg-[rgba(214,90,90,0.34)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.18)] focus-visible:ring-[rgba(214,90,90,0.45)]`;
    case "promote":
      return `${baseClassName} border-[rgba(76,194,200,0.34)] bg-[rgba(76,194,200,0.18)] text-[var(--teal)] shadow-[0_8px_18px_rgba(76,194,200,0.12)] hover:border-[rgba(76,194,200,0.5)] hover:bg-[rgba(76,194,200,0.28)] hover:shadow-[0_12px_24px_rgba(76,194,200,0.18)] active:bg-[rgba(76,194,200,0.34)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.18)] focus-visible:ring-[rgba(76,194,200,0.45)]`;
  }
}

function GuideModalFrame({
  open,
  onClose,
  closeAriaLabel,
  eyebrow,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  closeAriaLabel: string;
  eyebrow: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,10,17,0.78)] p-4 backdrop-blur-sm sm:p-6">
      <button
        type="button"
        aria-label={closeAriaLabel}
        onClick={onClose}
        className="absolute inset-0"
      />

      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#08131a] px-5 py-5 text-left shadow-2xl sm:max-h-[calc(100vh-3rem)] sm:px-6 sm:py-6">
        <div className="mb-5 shrink-0 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
              {eyebrow}
            </p>
            <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
            <div className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">{description}</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-white/10"
          >
            닫기
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

function PromotionSlotGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <GuideModalFrame
      open={open}
      onClose={onClose}
      closeAriaLabel="model promotion slot guide 닫기"
      eyebrow="Model Promotion Slot Guide"
      title="슬롯별 의미"
      description="학습 결과를 어떤 runtime adapter slot에 Model Promotion 할지 정하는 선택이다."
    >
      <div className="space-y-3">
        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">default</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            기본 응답 경로에서 우선 쓰는 공용 adapter 슬롯이다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">doctor</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            의사 NPC에 붙일 전용 adapter 슬롯이다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">supervisor</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            감독관 NPC에 붙일 전용 adapter 슬롯이다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">director</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            소장 NPC에 붙일 전용 adapter 슬롯이다.
          </p>
        </TextBlock>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-left">
        <p className="text-sm font-semibold text-foreground">예시</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-[var(--ink-muted)]">
          <li>전체적으로 무난한 SFT 결과면 `default` slot으로 Model Promotion 한다.</li>
          <li>
            특정 캐릭터 말투만 유독 좋아졌으면 `doctor`, `supervisor`, `director` 같은
            캐릭터별 slot으로 Model Promotion 한다.
          </li>
        </ul>
      </div>
    </GuideModalFrame>
  );
}

function TrainingExecutionGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <GuideModalFrame
      open={open}
      onClose={onClose}
      closeAriaLabel="training execution guide 닫기"
      eyebrow="Training Execution Guide"
      title="버튼별 실행 가이드"
      description={
        <>
          이 영역은 서비스 이용자용이 아니라 개발 중인 운영자가 학습 run을 관리하는 control
          plane이다. 각 버튼은 현재 화면에 표시된 <code>runId</code> 와 선택된{" "}
          <code>Model Promotion Slot</code> 을 기준으로 동작한다.
        </>
      }
    >
      <div className="space-y-3">
        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">새로운 SFT Base 생성</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            finalized SFT 데이터셋으로 새 base adapter를 만든다. 새 데이터 회차를 시작할 때
            가장 먼저 보는 버튼이다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">기존 SFT Base로 DPO 진행</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            현재 선택된 성공 SFT base와 finalized preference 데이터셋을 바탕으로 후속
            미세조정을 수행한다. 새 데이터셋 회차라면 보통 새로운 SFT Base 생성 뒤에
            실행한다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">Golden-set Evaluation 실행</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            현재 표시된 성공 run을 선택된 <code>Model Promotion Slot</code> 의 baseline과
            비교한다. 학습이 성공한 뒤에만 실행하는 검증 단계다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">채택 / 반려</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Golden-set Evaluation 결과를 보고 운영자가 최종 결정을 남긴다. 채택은 Model
            Promotion 후보 확정, 반려는 이번 run을 runtime 후보에서 제외하는 의미다.
          </p>
        </TextBlock>

        <TextBlock className="text-left">
          <p className="text-sm font-semibold text-foreground">Model Promotion</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            채택된 run의 adapter를 선택된 slot에 Model Promotion 한다. 이 단계부터 live
            runtime 경로에 영향이 간다.
          </p>
        </TextBlock>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-left">
        <p className="text-sm font-semibold text-foreground">권장 실행 순서</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-7 text-[var(--ink-muted)]">
          <li>review finalize를 끝내서 학습 대상 데이터셋을 고정한다.</li>
          <li>새로운 SFT Base를 생성한다.</li>
          <li>DPO가 필요하면 성공한 SFT base를 parent로 삼아 이어서 진행한다.</li>
          <li>성공한 run에 대해 Golden-set Evaluation을 실행한다.</li>
          <li>평가 결과를 보고 채택 또는 반려를 기록한다.</li>
          <li>채택된 run만 선택한 slot으로 Model Promotion 한다.</li>
        </ol>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-left">
        <p className="text-sm font-semibold text-foreground">순서 유의사항</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-[var(--ink-muted)]">
          <li>
            Golden-set Evaluation은 학습이 성공한 뒤에만 의미가 있다. 평가를 먼저 누르면 안
            된다.
          </li>
          <li>
            채택 / 반려는 Golden-set Evaluation이 끝난 run에 대해서만 결정한다. 새 학습을 안
            돌렸어도 화면에 잡힌 기존 latest run에 대해 다시 누를 수 있다.
          </li>
          <li>
            Model Promotion은 채택된 run만 가능하다. 아무 학습 없이 빈 상태에서 누르는
            버튼이 아니다.
          </li>
          <li>
            DPO는 독립 시작점이 아니다. 보통 새 회차에서는 새로운 SFT Base 생성 다음에
            실행하고, 예외적으로는 이미 존재하는 성공 SFT base를 의도적으로 재사용할 때만
            바로 진행한다.
          </li>
          <li>
            현재 선택한 <code>Model Promotion Slot</code> 은 Golden-set Evaluation의 비교
            기준과 Model Promotion 대상 둘 다에 영향을 준다.
          </li>
        </ul>
      </div>
    </GuideModalFrame>
  );
}

function BlockingExecutionOverlay({
  open,
  title,
  message,
  runId,
  step,
  startedAt,
}: {
  open: boolean;
  title: string;
  message: string;
  runId: string | null;
  step: string | null;
  startedAt: string | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearInterval(interval);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const elapsedMs = Number.isNaN(startedAtMs) ? null : Math.max(0, nowMs - startedAtMs);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(3,10,17,0.84)] p-4 backdrop-blur-sm sm:p-6">
      <div className="w-full max-w-[520px] rounded-[28px] border border-white/10 bg-[#08131a] px-6 py-6 shadow-2xl">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
          Execution In Progress
        </p>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-3 w-3 rounded-full bg-[var(--teal)] shadow-[0_0_18px_rgba(76,194,200,0.7)] animate-pulse" />
          <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        </div>
        <p className="mt-4 text-sm leading-7 text-[var(--ink-muted)]">{message}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">경과 시간</p>
            <p className="mt-2 text-xl font-semibold text-foreground">
              {formatElapsedClock(elapsedMs)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">현재 단계</p>
            <p className="mt-2 text-sm font-semibold text-foreground">{step ?? "-"}</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm leading-7 text-[var(--ink-muted)]">
          <p>runId: {runId ?? "요청 전송 중"}</p>
          <p>startedAt: {formatTimestamp(startedAt)}</p>
          <p>이 작업이 끝날 때까지 다른 조작은 잠시 막혀 있습니다.</p>
        </div>
      </div>
    </div>
  );
}

function basenameFromPath(path: string | null) {
  if (!path) {
    return "-";
  }

  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function describeTrainingRunOrigin(run: ReviewTrainingRunView) {
  if (run.trainingBackend === "together_serverless_lora") {
    return "Together serverless LoRA run";
  }

  if (run.trainingBackend === "smoke") {
    return "smoke run";
  }

  if (
    run.runId.startsWith("real-eval-import-") ||
    run.message?.toLowerCase().includes("imported")
  ) {
    return "검증용 import run";
  }

  if (run.kind === "dpo") {
    return "후속 DPO run";
  }

  return "실학습 run";
}

function describeTrainingRunStage(run: ReviewTrainingRunView) {
  if (run.promotion.isPromoted) {
    return "Model Promotion 완료";
  }

  if (run.decision.state === "accepted") {
    return "채택 완료";
  }

  if (run.decision.state === "rejected") {
    return "반려 완료";
  }

  if (run.evaluation.state === "succeeded") {
    return "Golden-set Evaluation 완료";
  }

  if (run.evaluation.state === "running") {
    return "Golden-set Evaluation 실행 중";
  }

  if (run.state === "running") {
    return "학습 실행 중";
  }

  if (run.state === "failed") {
    return "실패";
  }

  if (run.state === "succeeded") {
    return "학습 완료";
  }

  return "상태 미확인";
}

function dpoExecutionModeLabel(mode: ReviewTrainingStatusView["dpo"]["executionMode"]) {
  switch (mode) {
    case "needs_new_sft":
      return "새 SFT Base 필요";
    case "reuse_existing_sft":
      return "기존 성공 SFT Base 재사용";
    case "unsupported":
      return "현재 미지원";
    case "together_serverless_lora":
      return "Together serverless LoRA";
    case "local_peft":
      return "로컬 PEFT";
    case "smoke":
      return "smoke";
    default:
      return "판단 불가";
  }
}

function dpoFingerprintRelationLabel(
  relation: ReviewTrainingStatusView["dpo"]["sftFingerprintRelation"],
) {
  switch (relation) {
    case "match":
      return "finalized SFT fingerprint 일치";
    case "mismatch":
      return "finalized SFT fingerprint 불일치";
    default:
      return "finalized SFT fingerprint 확인 불가";
  }
}

function TrainingRunDetailCard({
  eyebrow,
  run,
  emptyMessage,
  messageOverride,
  note,
  action,
}: {
  eyebrow: string;
  run: ReviewTrainingRunView | null;
  emptyMessage: ReactNode;
  messageOverride?: string | null;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-foreground/80">{eyebrow}</p>
          {run ? (
            <>
              <p className="text-lg font-semibold text-foreground">
                {run.kind.toUpperCase()} · {describeTrainingRunOrigin(run)} ·{" "}
                {describeTrainingRunStage(run)}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                dataset {run.sourceDatasetVersion ?? "-"} · canonical{" "}
                {run.remoteModelName
                  ? run.remoteModelName
                  : basenameFromPath(run.adapterPath)}{" "}
                · runtime{" "}
                {run.remoteModelName
                  ? run.remoteModelName
                  : basenameFromPath(run.runtimeArtifactPath)}
              </p>
              <p className="mt-2 break-all font-mono text-[11px] text-[var(--ink-muted)]">
                runId {run.runId}
              </p>
            </>
          ) : (
            <div className="text-sm leading-7 text-[var(--ink-muted)]">{emptyMessage}</div>
          )}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {note ? (
        <div className="mt-4 rounded-2xl border border-[rgba(209,111,76,0.24)] bg-[rgba(209,111,76,0.1)] px-4 py-3 text-sm leading-7 text-[var(--accent)]">
          {note}
        </div>
      ) : null}

      {run ? (
        <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
          <p>runId: {run.runId}</p>
          <p>kind: {run.kind}</p>
          <p>training backend: {run.trainingBackend ?? "-"}</p>
          <p>state: {run.state}</p>
          <p>step: {run.currentStep ?? "-"}</p>
          <p>message: {messageOverride ?? run.message ?? "-"}</p>
          <p>dataset dir: {run.datasetDir ?? "-"}</p>
          <p>adapter: {run.adapterPath ?? "-"}</p>
          <p>log: {run.logPath ?? "-"}</p>
          <p>startedAt: {formatTimestamp(run.startedAt ?? null)}</p>
          <p>finishedAt: {formatTimestamp(run.finishedAt ?? null)}</p>
          <p>updatedAt: {formatTimestamp(run.updatedAt ?? null)}</p>
          <p>source dataset version: {run.sourceDatasetVersion ?? "-"}</p>
          <p>base model: {run.baseModelId ?? "-"}</p>
          <p>fingerprint: {run.fingerprint ?? "-"}</p>
          <p>source fingerprint: {run.sourceFingerprint ?? "-"}</p>
          <p>parent run: {run.parentRunId ?? "-"}</p>
          <p>runtime artifact: {run.runtimeArtifactPath ?? "-"}</p>
          <p>runtime kind: {run.runtimeArtifactKind ?? "-"}</p>
          <p>remote provider: {run.remoteProvider ?? "-"}</p>
          <p>remote job: {run.remoteJobId ?? "-"}</p>
          <p>remote training file: {run.remoteTrainingFileId ?? "-"}</p>
          <p>remote validation file: {run.remoteValidationFileId ?? "-"}</p>
          <p>remote model: {run.remoteModelName ?? "-"}</p>
          <p>
            소요: build {formatDuration(run.durations.buildMs ?? null)} / train{" "}
            {formatDuration(run.durations.trainMs ?? null)} / 전체{" "}
            {formatDuration(run.durations.totalMs ?? null)}
          </p>
          <p>
            eval: {run.evaluation.state ?? "idle"} / slot {run.evaluation.bindingKey ?? "-"}
          </p>
          <p>eval benchmark: {run.evaluation.benchmarkId ?? "-"}</p>
          <p>eval baseline: {run.evaluation.baselineLabel ?? "-"}</p>
          <p>
            eval message: {run.evaluation.message ?? run.evaluation.recommendation ?? "-"}
          </p>
          <p>eval summary: {run.evaluation.summaryPath ?? "-"}</p>
          <p>
            eval startedAt: {formatTimestamp(run.evaluation.startedAt ?? null)} / finishedAt{" "}
            {formatTimestamp(run.evaluation.finishedAt ?? null)}
          </p>
          <p>
            winner: baseline {run.evaluation.winnerCounts?.baseline ?? "-"} / candidate{" "}
            {run.evaluation.winnerCounts?.candidate ?? "-"} / tie{" "}
            {run.evaluation.winnerCounts?.tie ?? "-"}
          </p>
          <p>
            score: N {run.evaluation.baselineNaturalness ?? "-"} →{" "}
            {run.evaluation.candidateNaturalness ?? "-"} / P{" "}
            {run.evaluation.baselinePersonaFit ?? "-"} →{" "}
            {run.evaluation.candidatePersonaFit ?? "-"} / A{" "}
            {run.evaluation.baselineAntiMeta ?? "-"} →{" "}
            {run.evaluation.candidateAntiMeta ?? "-"}
          </p>
          <p>eval confidence: {run.evaluation.confidence ?? "-"}</p>
          <p>
            decision: {run.decision.state ?? "pending"} / reviewer {run.decision.reviewer ?? "-"}
          </p>
          <p>decision notes: {run.decision.notes ?? "-"}</p>
          <p>decidedAt: {formatTimestamp(run.decision.decidedAt ?? null)}</p>
          <p>
            model promotion:{" "}
            {run.promotion.isPromoted
              ? `${run.promotion.bindingKey ?? "-"} @ ${formatTimestamp(
                  run.promotion.promotedAt ?? null,
                )}`
              : "미적용"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TagRow({
  values,
  emptyLabel = "없음",
}: {
  values: string[];
  emptyLabel?: string;
}) {
  if (!values.length) {
    return <p className="text-sm text-[var(--ink-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-foreground/85"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function CandidateCompactBlock({
  label,
  candidate,
  tone,
}: {
  label: string;
  candidate: ReviewCandidateView;
  tone: string;
}) {
  return (
    <div className={`rounded-[24px] border px-4 py-4 ${tone}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/90">
          {label}
        </p>
        <span className="rounded-full bg-black/20 px-2.5 py-1 text-[11px] text-foreground/80">
          action {candidate.selectedAction ?? "없음"}
        </span>
      </div>

      <p className="text-sm leading-7 text-foreground/95">{candidate.replyText}</p>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            impact tags
          </p>
          <TagRow values={candidate.impactTags} />
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          target: {candidate.targetNpcId ?? "없음"}
        </p>
      </div>
    </div>
  );
}

function DecisionHelp({ kind }: { kind: ReviewKind }) {
  const lines =
    kind === "sft"
      ? [
          ["include", "이 응답을 학습에 넣는다"],
          ["exclude", "이 응답을 학습에서 뺀다"],
          ["escalate", "지금 확정하지 않고 보류한다"],
        ]
      : [
          ["include", "chosen / rejected 순서가 맞다"],
          ["flip", "rejected 쪽이 더 낫다"],
          ["exclude", "pair 자체를 버린다"],
          ["escalate", "지금 확정하지 않고 보류한다"],
        ];

  return (
    <div className="flex flex-wrap gap-2">
      {lines.map(([decision, description]) => (
        <div
          key={decision}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs"
        >
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${decisionTone(
              decision as ReviewItem["decision"],
            )}`}
          >
            {decisionLabel(decision as ReviewItem["decision"])}
          </span>
          <span className="text-[var(--ink-muted)]">{description}</span>
        </div>
      ))}
    </div>
  );
}

function llmStatusLabel(item: ReviewItem) {
  const llm = item.llmFirstPass;
  if (!llm) {
    return "없음";
  }

  return decisionLabel(llm.suggestedDecision);
}

function CompactReviewCard({
  item,
  reviewer,
  sourceMode,
  readOnly,
  onItemSaved,
}: {
  item: ReviewItem;
  reviewer: string;
  sourceMode: ReviewSourceMode;
  readOnly: boolean;
  onItemSaved?: (item: ReviewItem) => void;
}) {
  const [draftDecision, setDraftDecision] = useState<ReviewItem["decision"]>(
    item.decision ?? null,
  );
  const [draftNotes, setDraftNotes] = useState(item.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decisionOptions =
    item.kind === "sft" ? SFT_DECISIONS : PAIR_DECISIONS;
  const llm = item.llmFirstPass;

  function handleSave() {
    if (!onItemSaved) {
      return;
    }

    startTransition(async () => {
      setMessage(null);
      const requestBody: ReviewDecisionRequest =
        item.kind === "sft"
          ? {
              kind: "sft",
              reviewId: item.reviewId,
              decision: draftDecision as SftReviewItemView["decision"],
              reviewer,
              notes: draftNotes,
            }
          : {
              kind: "pair",
              reviewId: item.reviewId,
              decision: draftDecision as PairReviewItemView["decision"],
              reviewer,
              notes: draftNotes,
            };

      try {
        const payload: ReviewMutationResult = await apiUpdateReviewDecision(
          requestBody,
        );
        onItemSaved(payload.item);
        setMessage("저장됨");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
      }
    });
  }

  return (
    <CardSurface>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
            {item.kind === "sft" ? "SFT" : "Pair / DPO"}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">
            {item.prompt.npcId} / turn {item.prompt.turnIndex ?? "-"}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            target {item.prompt.targetNpcId ?? "없음"} · {item.prompt.scenarioId}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sourceMode === "llm_completed" ? (
            <>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                LLM {llm?.provider ?? "unknown"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
                  llm?.suggestedDecision ?? null,
                )}`}
              >
                추천: {llmStatusLabel(item)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                confidence {llm?.confidence ?? "-"}
              </span>
            </>
          ) : sourceMode === "human_reviewed" ? (
            <>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                reviewer {item.reviewer ?? "없음"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
                  item.decision,
                )}`}
              >
                사람 검수: {decisionLabel(item.decision)}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              reviewer {reviewer || "미입력"}
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
              sourceMode === "llm_completed" ? llm?.suggestedDecision ?? null : item.decision,
            )}`}
          >
            {sourceMode === "llm_completed" ? "LLM 판단" : "저장됨"}:{" "}
            {sourceMode === "llm_completed"
              ? llmStatusLabel(item)
              : decisionLabel(item.decision)}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <SectionLabel>Player Input</SectionLabel>
          <TextBlock>{item.prompt.playerText}</TextBlock>
        </div>

        {isSftItem(item) ? (
          <div className="space-y-4">
            <div>
              <SectionLabel>Reply</SectionLabel>
              <TextBlock>{item.candidate.replyText}</TextBlock>
            </div>

            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <TextBlock>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  selected action
                </p>
                <p className="mt-2 text-base font-semibold text-foreground">
                  {item.candidate.selectedAction ?? "없음"}
                </p>
              </TextBlock>

              <TextBlock>
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  structured impact
                </p>
                <TagRow values={item.candidate.impactTags} />
                <p className="mt-3 text-xs text-[var(--ink-muted)]">
                  target: {item.candidate.targetNpcId ?? "없음"}
                </p>
              </TextBlock>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <CandidateCompactBlock
              label="Chosen"
              candidate={item.chosen}
              tone="border-[rgba(74,166,124,0.28)] bg-[rgba(74,166,124,0.08)]"
            />
            <CandidateCompactBlock
              label="Rejected"
              candidate={item.rejected}
              tone="border-[rgba(214,90,90,0.28)] bg-[rgba(214,90,90,0.08)]"
            />
          </div>
        )}

        {sourceMode === "llm_completed" ? (
          <TextBlock>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              llm first pass
            </p>
            <p className="mt-2 text-sm text-foreground">
              추천 {llmStatusLabel(item)} / confidence {llm?.confidence ?? "-"}
              {llm?.preferenceStrength !== null &&
              llm?.preferenceStrength !== undefined
                ? ` / strength ${llm.preferenceStrength}`
                : ""}
            </p>
            <div className="mt-3">
              <TagRow values={llm?.reasons ?? []} emptyLabel="LLM 메모 없음" />
            </div>
          </TextBlock>
        ) : sourceMode === "human_reviewed" ? (
          <TextBlock>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              human review
            </p>
            <p className="mt-2 text-sm text-foreground">
              reviewer {item.reviewer ?? "없음"} / decision {decisionLabel(item.decision)}
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              reviewed at {formatTimestamp(item.reviewedAt)}
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              notes {item.notes || "없음"}
            </p>
          </TextBlock>
        ) : (
          <>
            <div>
              <SectionLabel>Decision</SectionLabel>
              <DecisionHelp kind={item.kind} />
            </div>

            <div className="flex flex-wrap gap-2">
              {decisionOptions.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => setDraftDecision(decision)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    draftDecision === decision
                      ? "bg-[var(--accent)] text-white"
                      : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                  }`}
                >
                  {decisionLabel(decision)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDraftDecision(null)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  draftDecision === null
                    ? "bg-white/14 text-white"
                    : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                }`}
              >
                미정
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || !reviewer.trim()}
                className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {isPending ? "저장 중..." : "결정 저장"}
              </button>
              <p className="text-sm text-[var(--ink-muted)]">
                선택값: {decisionLabel(draftDecision)}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                마지막 저장: {formatTimestamp(item.reviewedAt)}
              </p>
              {message ? <p className="text-sm text-[var(--teal)]">{message}</p> : null}
            </div>
          </>
        )}

        <details className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            근거 / 메모 펼치기
          </summary>

          <div className="mt-4 space-y-4">
            {isSftItem(item) ? (
              <>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    action reason
                  </p>
                  <p className="mt-2">
                    {item.candidate.selectedActionReason || "설명 없음"}
                  </p>
                </TextBlock>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    impact rationale
                  </p>
                  <p className="mt-2">{item.candidate.rationale || "설명 없음"}</p>
                </TextBlock>
                {item.judge ? (
                  <TextBlock>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      judge summary
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      verdict {item.judge.verdict ?? "-"} / weighted {item.weightedJudgeScore ?? "-"}
                    </p>
                    <div className="mt-3">
                      <TagRow values={item.judge.reasons} emptyLabel="judge 메모 없음" />
                    </div>
                  </TextBlock>
                ) : null}
                {llm ? (
                  <TextBlock>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      llm recommendation
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      provider {llm.provider ?? "-"} / 추천 {llmStatusLabel(item)} / confidence{" "}
                      {llm.confidence ?? "-"}
                    </p>
                    <div className="mt-3">
                      <TagRow values={llm.reasons} emptyLabel="LLM 메모 없음" />
                    </div>
                  </TextBlock>
                ) : null}
              </>
            ) : (
              <>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    chosen rationale
                  </p>
                  <p className="mt-2">{item.chosen.rationale || "설명 없음"}</p>
                </TextBlock>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    rejected rationale
                  </p>
                  <p className="mt-2">{item.rejected.rationale || "설명 없음"}</p>
                </TextBlock>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    pair hints
                  </p>
                  <TagRow values={item.pairReason} emptyLabel="pair 힌트 없음" />
                </TextBlock>
                {llm ? (
                  <TextBlock>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      llm recommendation
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      provider {llm.provider ?? "-"} / 추천 {llmStatusLabel(item)} / confidence{" "}
                      {llm.confidence ?? "-"} / strength {llm.preferenceStrength ?? "-"}
                    </p>
                    <div className="mt-3">
                      <TagRow values={llm.reasons} emptyLabel="LLM 메모 없음" />
                    </div>
                  </TextBlock>
                ) : null}
              </>
            )}

            <TextBlock>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                evidence snapshot
              </p>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    memories
                  </p>
                  <TagRow
                    values={item.prompt.retrievedMemorySummaries}
                    emptyLabel="기억 근거 없음"
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    knowledge
                  </p>
                  <TagRow
                    values={item.prompt.retrievedKnowledgeTitles}
                    emptyLabel="지식 근거 없음"
                  />
                </div>
              </div>
            </TextBlock>

            {readOnly ? null : (
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">notes</span>
                <textarea
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm leading-7 outline-none placeholder:text-[var(--ink-muted)]"
                  placeholder="필요하면 짧게 메모"
                />
              </label>
            )}

            <p className="text-sm text-[var(--ink-muted)]">
              기존 reviewer: {item.reviewer ?? "없음"} / 기존 decision: {decisionLabel(item.decision)}
            </p>
          </div>
        </details>
      </div>
    </CardSurface>
  );
}

export function ReviewDashboard({
  initialData,
}: {
  initialData: ReviewDashboardData;
}) {
  const [data, setData] = useState(initialData);
  const [sourceMode, setSourceMode] = useState<ReviewSourceMode>("human_required");
  const [kind, setKind] = useState<ReviewKind>("sft");
  const [reviewer, setReviewer] = useState("switch");
  const [finalizeStatus, setFinalizeStatus] = useState<ReviewFinalizeStatusView | null>(
    null,
  );
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const finalizePollRef = useRef<number | null>(null);
  const [trainingStatus, setTrainingStatus] = useState<ReviewTrainingStatusView | null>(
    null,
  );
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingBindingKey, setTrainingBindingKey] =
    useState<ReviewTrainingBindingKey>("default");
  const [promotionGuideOpen, setPromotionGuideOpen] = useState(false);
  const [trainingExecutionGuideOpen, setTrainingExecutionGuideOpen] = useState(false);
  const [currentActionRunId, setCurrentActionRunId] = useState<string | null>(null);
  const [pendingTrainingLaunch, setPendingTrainingLaunch] = useState<{
    kind: ReviewTrainingKind;
    startedAt: string;
  } | null>(null);
  const trainingPollRef = useRef<number | null>(null);

  const humanRequiredDataset = useMemo(
    () => filterDatasetByReviewedState(data.humanRequired, false),
    [data.humanRequired],
  );
  const humanReviewedDataset = useMemo(
    () => filterDatasetByReviewedState(data.humanRequired, true),
    [data.humanRequired],
  );
  const activeDataset = useMemo(() => {
    switch (sourceMode) {
      case "human_required":
        return humanRequiredDataset;
      case "human_reviewed":
        return humanReviewedDataset;
      case "llm_completed":
      default:
        return data.llmCompleted;
    }
  }, [data.llmCompleted, humanRequiredDataset, humanReviewedDataset, sourceMode]);
  const items = kind === "sft" ? activeDataset.sftItems : activeDataset.pairItems;
  const stats = summarize(items);
  const pendingRequiredTotal = useMemo(
    () =>
      data.humanRequired.sftItems.filter((item) => !item.decision).length +
      data.humanRequired.pairItems.filter((item) => !item.decision).length,
    [data.humanRequired.pairItems, data.humanRequired.sftItems],
  );
  const latestHistoricalRun = trainingStatus?.latestRun ?? null;
  const currentActionRun = useMemo(() => {
    if (!trainingStatus) {
      return null;
    }

    if (currentActionRunId) {
      if (trainingStatus.activeRun?.runId === currentActionRunId) {
        return trainingStatus.activeRun;
      }
      if (trainingStatus.latestRun?.runId === currentActionRunId) {
        return trainingStatus.latestRun;
      }
      return null;
    }

    return trainingStatus.activeRun ?? null;
  }, [currentActionRunId, trainingStatus]);
  const isHistoricalReoperation =
    currentActionRun !== null &&
    latestHistoricalRun !== null &&
    currentActionRun.runId === latestHistoricalRun.runId &&
    trainingStatus?.activeRun === null;
  const canUseHistoricalRun =
    trainingStatus?.activeRun === null &&
    latestHistoricalRun !== null &&
    currentActionRun?.runId !== latestHistoricalRun.runId;
  const blockingExecutionState = useMemo(() => {
    if (trainingStatus?.activeRun?.state === "running") {
      return {
        title:
          trainingStatus.activeRun.kind === "sft"
            ? "새로운 SFT Base 생성 중"
            : "기존 SFT Base로 DPO 진행 중",
        message:
          trainingStatus.activeRun.message ??
          "학습 작업을 실행 중입니다. 완료될 때까지 잠시 기다려 주세요.",
        runId: trainingStatus.activeRun.runId,
        step: trainingStatus.activeRun.currentStep,
        startedAt: trainingStatus.activeRun.startedAt,
      };
    }

    if (trainingStatus?.latestRun?.evaluation.state === "running") {
      return {
        title: "Golden-set Evaluation 실행 중",
        message:
          trainingStatus.latestRun.evaluation.message ??
          "Golden-set Evaluation을 진행 중입니다. 완료될 때까지 잠시 기다려 주세요.",
        runId: trainingStatus.latestRun.runId,
        step: "golden_eval",
        startedAt: trainingStatus.latestRun.evaluation.startedAt,
      };
    }

    if (pendingTrainingLaunch) {
      return {
        title:
          pendingTrainingLaunch.kind === "sft"
            ? "새로운 SFT Base 생성 시작 중"
            : "기존 SFT Base로 DPO 진행 시작 중",
        message: "실행 요청을 전송하고 있습니다. 잠시만 기다려 주세요.",
        runId: null,
        step: "launching",
        startedAt: pendingTrainingLaunch.startedAt,
      };
    }

    return null;
  }, [pendingTrainingLaunch, trainingStatus]);

  useEffect(() => {
    let cancelled = false;

    async function loadFinalizeStatus() {
      try {
        const payload = await apiGetReviewFinalizeStatus({
          cache: "no-store",
        });

        if (!cancelled) {
          setFinalizeStatus(payload);
        }
      } catch {
        return;
      }
    }

    void loadFinalizeStatus();

    return () => {
      cancelled = true;
      if (finalizePollRef.current) {
        window.clearInterval(finalizePollRef.current);
      }
      if (trainingPollRef.current) {
        window.clearInterval(trainingPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTrainingStatus() {
      try {
        const payload = await apiGetReviewTrainingStatus({
          cache: "no-store",
        });

        if (!cancelled) {
          setTrainingStatus(payload);
        }
      } catch {
        return;
      }
    }

    void loadTrainingStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const shouldPoll =
      trainingStatus?.activeRun?.state === "running" ||
      trainingStatus?.latestRun?.evaluation.state === "running";

    if (shouldPoll) {
      if (!trainingPollRef.current) {
        trainingPollRef.current = window.setInterval(() => {
          void refreshTrainingStatus();
        }, 2000);
      }
      return;
    }

    if (trainingPollRef.current) {
      window.clearInterval(trainingPollRef.current);
      trainingPollRef.current = null;
    }
  }, [trainingStatus?.activeRun?.state, trainingStatus?.latestRun?.evaluation.state]);

  useEffect(() => {
    if (!currentActionRunId && trainingStatus?.activeRun?.runId) {
      setCurrentActionRunId(trainingStatus.activeRun.runId);
      return;
    }

    if (
      currentActionRunId &&
      trainingStatus &&
      trainingStatus.activeRun?.runId !== currentActionRunId &&
      trainingStatus.latestRun?.runId !== currentActionRunId
    ) {
      setCurrentActionRunId(trainingStatus.activeRun?.runId ?? null);
    }
  }, [currentActionRun, currentActionRunId, trainingStatus]);

  function handleItemSaved(nextItem: ReviewItem) {
    setData((current) => {
      const nextData = updateHumanItemInData(current, nextItem.kind, nextItem);
      const nextPending = {
        sft: nextData.humanRequired.sftItems.filter((item) => !item.decision).length,
        pair: nextData.humanRequired.pairItems.filter((item) => !item.decision).length,
      };

      setFinalizeStatus((status) =>
        status
          ? {
              ...status,
              canFinalize: nextPending.sft + nextPending.pair === 0 && status.state !== "running",
              pending: {
                sft: nextPending.sft,
                pair: nextPending.pair,
                total: nextPending.sft + nextPending.pair,
              },
            }
          : status,
      );

      return nextData;
    });

    void refreshTrainingStatus();
  }

  async function refreshFinalizeStatus() {
    try {
      setFinalizeStatus(
        await apiGetReviewFinalizeStatus({
          cache: "no-store",
        }),
      );
    } catch {
      return;
    }
  }

  async function handleFinalize() {
    setFinalizeError(null);

    if (finalizePollRef.current) {
      window.clearInterval(finalizePollRef.current);
    }

    finalizePollRef.current = window.setInterval(() => {
      void refreshFinalizeStatus();
    }, 300);

    setFinalizeStatus((current) =>
      current
        ? {
            ...current,
            state: "running",
            currentStep: "finalize_sft",
            message: "SFT finalize 실행 중",
            canFinalize: false,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : {
            state: "running",
            currentStep: "finalize_sft",
            canFinalize: false,
            pending: {
              sft: data.humanRequired.sftItems.filter((item) => !item.decision).length,
              pair: data.humanRequired.pairItems.filter((item) => !item.decision).length,
              total: pendingRequiredTotal,
            },
            message: "SFT finalize 실행 중",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            updatedAt: new Date().toISOString(),
            durations: {
              sftMs: null,
              preferenceMs: null,
              totalMs: null,
            },
            outputs: {
              sft: null,
              preference: null,
            },
          },
    );

    try {
      setFinalizeStatus(await apiRunReviewFinalize());
    } catch (error) {
      setFinalizeError(
        error instanceof Error ? error.message : "finalize 실행에 실패했습니다.",
      );
      await refreshFinalizeStatus();
    } finally {
      if (finalizePollRef.current) {
        window.clearInterval(finalizePollRef.current);
        finalizePollRef.current = null;
      }
      await refreshTrainingStatus();
    }
  }

  async function refreshTrainingStatus() {
    try {
      setTrainingStatus(
        await apiGetReviewTrainingStatus({
          cache: "no-store",
        }),
      );
    } catch {
      return;
    }
  }

  async function handleTraining(kind: ReviewTrainingKind) {
    setTrainingError(null);
    setPendingTrainingLaunch({
      kind,
      startedAt: new Date().toISOString(),
    });

    try {
      const requestBody: ReviewTrainingRequest = { kind };
      const nextStatus = await apiRunReviewTraining(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(nextStatus.activeRun?.runId ?? nextStatus.latestRun?.runId ?? null);
      setPendingTrainingLaunch(null);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "학습 실행에 실패했습니다.",
      );
      setPendingTrainingLaunch(null);
      await refreshTrainingStatus();
    }
  }

  async function handleTrainingEvaluation() {
    if (!currentActionRun) {
      return;
    }

    setTrainingError(null);

    try {
      const requestBody: ReviewTrainingRunActionRequest = {
        runId: currentActionRun.runId,
        bindingKey: trainingBindingKey,
      };
      const nextStatus = await apiRunReviewTrainingEvaluation(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(currentActionRun.runId);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "Golden-set Evaluation 실행에 실패했습니다.",
      );
      await refreshTrainingStatus();
    }
  }

  async function handleTrainingDecision(decision: "accepted" | "rejected") {
    if (!currentActionRun) {
      return;
    }

    setTrainingError(null);

    try {
      const requestBody: ReviewTrainingDecisionRequest = {
        runId: currentActionRun.runId,
        decision,
        reviewer,
        notes: "",
      };
      const nextStatus = await apiUpdateReviewTrainingDecision(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(currentActionRun.runId);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "학습 채택 여부 저장에 실패했습니다.",
      );
      await refreshTrainingStatus();
    }
  }

  async function handleTrainingPromotion() {
    if (!currentActionRun) {
      return;
    }

    setTrainingError(null);

    try {
      const requestBody: ReviewTrainingRunActionRequest = {
        runId: currentActionRun.runId,
        bindingKey: trainingBindingKey,
      };
      const nextStatus = await apiPromoteReviewTrainingRun(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(currentActionRun.runId);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "Model Promotion에 실패했습니다.",
      );
      await refreshTrainingStatus();
    }
  }

  return (
    <>
      <PromotionSlotGuideModal
        open={promotionGuideOpen}
        onClose={() => setPromotionGuideOpen(false)}
      />
      <TrainingExecutionGuideModal
        open={trainingExecutionGuideOpen}
        onClose={() => setTrainingExecutionGuideOpen(false)}
      />
      <BlockingExecutionOverlay
        open={blockingExecutionState !== null}
        title={blockingExecutionState?.title ?? ""}
        message={blockingExecutionState?.message ?? ""}
        runId={blockingExecutionState?.runId ?? null}
        step={blockingExecutionState?.step ?? null}
        startedAt={blockingExecutionState?.startedAt ?? null}
      />

      <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--teal)]">
            Compact Review
          </p>
          <h1 className="display-heading text-4xl font-semibold text-foreground">
            검수 리스트 선택 화면
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--ink-muted)]">
            사람 검수 대상과 LLM 1차 검수 완료 리스트를 전환해서 볼 수 있습니다.
            기본 화면은 사람이 직접 판정해야 하는 항목부터 열립니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/"
            className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-foreground/90 transition hover:bg-white/10"
          >
            시뮬레이터로 돌아가기
          </a>
        </div>
      </header>

      <CardSurface>
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
            <p className="text-sm font-semibold text-foreground">Shadow invalid_json</p>
            <p className="text-sm text-[var(--ink-muted)]">
              local structured shadow 모델이 JSON 형식을 못 지킨 케이스만 따로 모아 본다.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[rgba(209,111,76,0.16)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
                총 {data.shadowInvalidJson.total}
              </span>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                최신 export {formatTimestamp(data.shadowInvalidJson.latestExportedAt)}
              </span>
            </div>
          </div>

          {data.shadowInvalidJson.cases.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {data.shadowInvalidJson.cases.map((item) => (
                <ShadowInvalidCaseCard
                  key={`${item.exportPath ?? "shadow"}:${item.turnIndex ?? "turn"}:${item.npcId}`}
                  item={item}
                />
              ))}
            </div>
          ) : (
            <TextBlock>
              아직 export된 episode 중에서 `shadowComparison.status=invalid_json`로 수집된 케이스가 없습니다.
              shadow compare를 켠 상태로 episode를 몇 번 더 export하면 여기에 최신 실패 케이스가 쌓입니다.
            </TextBlock>
          )}
        </div>
      </CardSurface>

      <CardSurface>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {([
                ["human_required", "사람 검수 필요", totalCount(humanRequiredDataset)],
                ["human_reviewed", "사람 검수 완료", totalCount(humanReviewedDataset)],
                ["llm_completed", "LLM 검수 완료", totalCount(data.llmCompleted)],
              ] as const).map(([entry, label, count]) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setSourceMode(entry)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    sourceMode === entry
                      ? "bg-[var(--teal)] text-black"
                      : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                  }`}
                >
                  {label} {count}
                </button>
              ))}
            </div>

            <span
              aria-hidden="true"
              className="px-1 text-sm font-semibold text-[var(--ink-muted)]"
            >
              |
            </span>

            <div className="flex flex-wrap items-center gap-2">
              {(["sft", "pair"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setKind(entry)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    kind === entry
                      ? "bg-[var(--accent)] text-white"
                      : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                  }`}
                >
                  {entry === "sft"
                    ? `SFT ${activeDataset.sftItems.length}`
                    : `Pair ${activeDataset.pairItems.length}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(stats.decisions).map(([decision, count]) => (
              <span
                key={decision}
                className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
                  decision as ReviewItem["decision"],
                )}`}
              >
                {decisionLabel(decision as ReviewItem["decision"])} {count}
              </span>
            ))}
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              전체 {stats.total}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              대기 {stats.pending}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              완료 {stats.reviewed}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            {sourceMode === "human_required" ? (
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">reviewer</span>
                <input
                  value={reviewer}
                  onChange={(event) => setReviewer(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm outline-none placeholder:text-[var(--ink-muted)]"
                  placeholder="이름"
                />
              </label>
            ) : sourceMode === "human_reviewed" ? (
              <TextBlock>
                <p className="mb-2 text-sm font-semibold text-foreground">읽기 전용</p>
                <p className="text-sm text-[var(--ink-muted)]">
                  이 탭은 사람이 이미 검수한 결과를 다시 확인하는 용도입니다.
                </p>
              </TextBlock>
            ) : (
              <TextBlock>
                <p className="mb-2 text-sm font-semibold text-foreground">읽기 전용</p>
                <p className="text-sm text-[var(--ink-muted)]">
                  이 탭은 LLM이 이미 1차 판정한 결과를 확인하는 용도입니다.
                </p>
              </TextBlock>
            )}

            <TextBlock>
              <p className="mb-2 text-sm font-semibold text-foreground">
                현재 모드:{" "}
                {sourceMode === "human_required"
                  ? "사람 검수 필요"
                  : sourceMode === "human_reviewed"
                    ? "사람 검수 완료"
                    : "LLM 검수 완료"}{" "}
                / {kind === "sft" ? "SFT" : "Pair / DPO"}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                {sourceMode === "human_required"
                  ? kind === "sft"
                    ? "아직 사람이 직접 판정해야 하는 SFT 응답만 따로 보여줍니다."
                    : "아직 사람이 직접 판정해야 하는 pair만 따로 보여줍니다."
                  : sourceMode === "human_reviewed"
                    ? kind === "sft"
                      ? "사람이 이미 판정한 SFT 응답만 읽기 전용으로 다시 확인합니다."
                      : "사람이 이미 판정한 pair만 읽기 전용으로 다시 확인합니다."
                    : kind === "sft"
                      ? "전체 LLM 판정 결과 중 추가 사람 검수 없이 통과한 응답만 읽기 전용으로 확인합니다."
                      : "전체 pair 판정 결과 중 추가 사람 검수 없이 통과한 pair만 읽기 전용으로 확인합니다."}
              </p>
            </TextBlock>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
              <p className="text-sm font-semibold text-foreground">Finalize</p>
              <p className="text-sm text-[var(--ink-muted)]">
                사람 검수 미완료가 `0`이면 최종 학습 데이터셋을 다시 생성할 수 있습니다.
              </p>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={
                  finalizeStatus
                    ? !finalizeStatus.canFinalize
                    : pendingRequiredTotal > 0
                }
                className="rounded-full bg-[var(--teal)] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {finalizeStatus?.state === "running"
                  ? "Finalize 실행 중..."
                  : "Finalize 실행"}
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
                    finalizeStatus?.state === "succeeded"
                      ? "bg-[rgba(74,166,124,0.16)] text-[var(--success)]"
                      : finalizeStatus?.state === "failed"
                        ? "bg-[rgba(214,90,90,0.16)] text-[var(--danger)]"
                        : finalizeStatus?.state === "running"
                          ? "bg-[rgba(76,194,200,0.16)] text-[var(--teal)]"
                          : "bg-white/6 text-[var(--ink-muted)]"
                  }`}
                >
                  {finalizeStatus?.state === "succeeded"
                    ? "완료"
                    : finalizeStatus?.state === "failed"
                      ? "실패"
                      : finalizeStatus?.state === "running"
                        ? "실행 중"
                        : "대기"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                  단계{" "}
                  {finalizeStatus?.currentStep === "finalize_sft"
                    ? "SFT finalize"
                    : finalizeStatus?.currentStep === "finalize_preference"
                      ? "Preference finalize"
                      : "-"}
                </span>
              </div>

              <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
                <p>메시지: {finalizeError ?? finalizeStatus?.message ?? "-"}</p>
                <p>시작: {formatTimestamp(finalizeStatus?.startedAt ?? null)}</p>
                <p>완료: {formatTimestamp(finalizeStatus?.finishedAt ?? null)}</p>
                <p>
                  소요: SFT {formatDuration(finalizeStatus?.durations.sftMs ?? null)} / Preference{" "}
                  {formatDuration(finalizeStatus?.durations.preferenceMs ?? null)} / 전체{" "}
                  {formatDuration(finalizeStatus?.durations.totalMs ?? null)}
                </p>
              </div>
            </TextBlock>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
              <p className="text-sm font-semibold text-foreground">Training</p>
              <p className="text-sm text-[var(--ink-muted)]">
                finalize가 최신 상태일 때만 로컬 Llama 3.1 SFT / DPO 학습을 시작할 수 있습니다.
              </p>
              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="block text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    Model Promotion Slot
                  </span>
                  <button
                    type="button"
                    onClick={() => setPromotionGuideOpen(true)}
                    className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-white/10"
                  >
                    가이드 보기
                  </button>
                </div>
                <select
                  value={trainingBindingKey}
                  onChange={(event) =>
                    setTrainingBindingKey(event.target.value as ReviewTrainingBindingKey)
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-foreground outline-none"
                >
                  {TRAINING_BINDING_KEYS.map((bindingKey) => (
                    <option key={bindingKey} value={bindingKey}>
                      {bindingKey}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setTrainingExecutionGuideOpen(true)}
                  className="inline-flex items-center rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-white/20 hover:bg-white/6 hover:text-foreground"
                >
                  실행 가이드보기
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm leading-7 text-[var(--ink-muted)]">
                {currentActionRun ? (
                  isHistoricalReoperation ? (
                    <>
                      현재는 <span className="font-semibold text-foreground">기존 run 재조작 모드</span>
                      다. 아래 평가/채택/반려/Model Promotion 버튼은 새 run이 아니라{" "}
                      <span className="font-semibold text-foreground">{currentActionRun.runId}</span>에
                      적용된다.
                    </>
                  ) : (
                    <>
                      현재 조작 대상은{" "}
                      <span className="font-semibold text-foreground">{currentActionRun.runId}</span>
                      다. 아래 버튼은 이 run을 기준으로 동작한다.
                    </>
                  )
                ) : latestHistoricalRun ? (
                  <>
                    새 run이 아직 없어 평가/채택/반려/Model Promotion 버튼을 잠가 두었습니다.
                    기존 run을 다시 조작하시려면 오른쪽 정보 패널의{" "}
                    <span className="font-semibold text-foreground">
                      기존 run 기록 (latest historical run)
                    </span>{" "}
                    카드에서 명시적으로 현재 조작 대상으로 선택하셔야 합니다. 모바일에서는 같은 카드가
                    버튼 영역 아래쪽에 보입니다.
                  </>
                ) : (
                  <>아직 생성된 training run이 없어 조작 대상이 비어 있다.</>
                )}
              </div>
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void handleTraining("sft")}
                    disabled={!trainingStatus?.sft.canStart}
                    className={trainingActionButtonClassName("sft")}
                  >
                    새로운 SFT Base 생성
                  </button>
                  <p className="px-1 text-xs leading-6 text-[var(--ink-muted)]">
                    새 SFT 완료 후에는 그 결과가 이후 DPO parent가 됩니다.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void handleTraining("dpo")}
                    disabled={!trainingStatus?.dpo.canStart}
                    className={trainingActionButtonClassName("dpo")}
                  >
                    기존 SFT Base로 DPO 진행
                  </button>
                  <p className="px-1 text-xs leading-6 text-[var(--ink-muted)]">
                    지금 누르면 현재 parent SFT run(
                    <span className="font-mono text-[11px] text-foreground">
                      {trainingStatus?.dpo.parentRunId ?? "-"}
                    </span>
                    )을 그대로 사용합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTrainingEvaluation()}
                  disabled={
                    !currentActionRun ||
                    currentActionRun.state !== "succeeded" ||
                    currentActionRun.evaluation.state === "running"
                  }
                  className={trainingActionButtonClassName("eval")}
                >
                  Golden-set Evaluation 실행
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTrainingDecision("accepted")}
                    disabled={
                      !currentActionRun ||
                      currentActionRun.evaluation.state !== "succeeded"
                    }
                    className={trainingActionButtonClassName("accept")}
                  >
                    채택
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTrainingDecision("rejected")}
                    disabled={
                      !currentActionRun ||
                      currentActionRun.evaluation.state !== "succeeded"
                    }
                    className={trainingActionButtonClassName("reject")}
                  >
                    반려
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTrainingPromotion()}
                  disabled={
                    !currentActionRun ||
                    currentActionRun.decision.state !== "accepted"
                  }
                  className={trainingActionButtonClassName("promote")}
                >
                  Model Promotion
                </button>
              </div>
            </div>

            <TextBlock>
              <p className="mb-2 text-sm font-semibold text-foreground">학습 상태</p>
              <div className="space-y-4 text-sm text-[var(--ink-muted)]">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                      SFT
                    </p>
                    <p>dataset version: {trainingStatus?.sft.dataset.datasetVersion ?? "-"}</p>
                    <p>row count: {trainingStatus?.sft.dataset.rowCount ?? "-"}</p>
                    <p>
                      상태:{" "}
                      {trainingStatus?.sft.canStart
                        ? "실행 가능"
                        : trainingStatus?.sft.alreadyTrained
                          ? "이미 학습됨"
                          : "대기"}
                    </p>
                    <p>
                      메시지: {trainingStatus?.sft.blockingIssues[0] ?? "문제 없음"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--teal)]">
                      DPO
                    </p>
                    <p>dataset version: {trainingStatus?.dpo.dataset.datasetVersion ?? "-"}</p>
                    <p>row count: {trainingStatus?.dpo.dataset.rowCount ?? "-"}</p>
                    <p>
                      DPO 실행 방식: {dpoExecutionModeLabel(trainingStatus?.dpo.executionMode ?? null)}
                    </p>
                    <p>
                      현재 사용될 parent SFT: {trainingStatus?.dpo.parentRunId ?? "-"}
                    </p>
                    <p>
                      판단 근거:{" "}
                      {dpoFingerprintRelationLabel(trainingStatus?.dpo.sftFingerprintRelation ?? null)}
                    </p>
                    <p>
                      parent SFT run: {trainingStatus?.dpo.parentRunId ?? "-"}
                    </p>
                    <p>
                      메시지: {trainingStatus?.dpo.blockingIssues[0] ?? "문제 없음"}
                    </p>
                  </div>
                </div>

                <TrainingRunDetailCard
                  eyebrow="현재 조작 대상"
                  run={currentActionRun}
                  messageOverride={trainingError ?? currentActionRun?.message ?? null}
                  emptyMessage={
                    latestHistoricalRun ? (
                      <>
                        아직 현재 조작 대상으로 잡힌 새 run이 없습니다. 과거 run을 다시
                        조작하시려면 오른쪽 정보 패널의{" "}
                        <span className="font-semibold text-foreground">
                          기존 run 기록 (latest historical run)
                        </span>{" "}
                        카드에서 명시적으로 선택하셔야 합니다. 모바일에서는 같은 카드가 아래쪽에
                        보입니다.
                      </>
                    ) : (
                      <>아직 생성된 training run이 없다.</>
                    )
                  }
                  note={
                    isHistoricalReoperation ? (
                      <>
                        기존 run 재조작 모드다. 현재 표시된 `채택 / 반려 / Model Promotion`은
                        새로 만든 run이 아니라 latest historical run에 다시 적용된다.
                      </>
                    ) : null
                  }
                />
                <TrainingRunDetailCard
                  eyebrow="기존 run 기록 (latest historical run)"
                  run={latestHistoricalRun}
                  emptyMessage={<>아직 기록된 latest historical run이 없다.</>}
                  action={
                    canUseHistoricalRun ? (
                      <button
                        type="button"
                        onClick={() => setCurrentActionRunId(latestHistoricalRun?.runId ?? null)}
                        className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-white/10"
                      >
                        이 run을 현재 조작 대상으로 사용
                      </button>
                    ) : isHistoricalReoperation ? (
                      <button
                        type="button"
                        onClick={() => setCurrentActionRunId(null)}
                        className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-white/20 hover:bg-white/6 hover:text-foreground"
                      >
                        현재 조작 대상 해제
                      </button>
                    ) : null
                  }
                  note={
                    trainingStatus?.activeRun ? (
                      <>지금은 새 run이 실행 중이라 historical run 재조작 선택을 잠시 숨긴 상태다.</>
                    ) : currentActionRun === null ? (
                      <>현재 조작 대상이 비어 있으므로 이 card는 조회 전용이다.</>
                    ) : null
                  }
                />
              </div>
            </TextBlock>
          </div>
        </div>
      </CardSurface>

      {items.length ? (
        <section
          className={
            kind === "sft"
              ? "grid gap-5 xl:grid-cols-2"
              : "grid gap-5"
          }
        >
          {items.map((item) => (
            <CompactReviewCard
              key={item.reviewId}
              item={item}
              reviewer={reviewer}
              sourceMode={sourceMode}
              readOnly={sourceMode !== "human_required"}
              onItemSaved={
                sourceMode === "human_required" ? handleItemSaved : undefined
              }
            />
          ))}
        </section>
      ) : (
        <CardSurface>
          <p className="text-sm text-[var(--ink-muted)]">
            조건에 맞는 검수 항목이 없습니다.
          </p>
        </CardSurface>
      )}
      </main>
    </>
  );
}
