import {
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  formatElapsedClock,
  formatTimestamp,
} from "./review-formatters";
import { TextBlock } from "./review-dashboard-primitives";

export function trainingActionButtonClassName(
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

export function PromotionSlotGuideModal({
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

export function TrainingExecutionGuideModal({
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

export function BlockingExecutionOverlay({
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
