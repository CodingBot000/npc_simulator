import { useEffect } from "react";
import { Panel } from "@/components/ui/panel";

export function InteractionGuideModal({
  open,
  speakerName,
  targetLabel,
  onClose,
}: {
  open: boolean;
  speakerName: string;
  targetLabel: string | null;
  onClose: () => void;
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
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-[rgba(3,10,17,0.78)] p-4 backdrop-blur-sm md:p-8">
      <button
        type="button"
        aria-label="가이드 닫기"
        onClick={onClose}
        className="absolute inset-0"
      />

      <Panel
        eyebrow="가이드"
        title="이렇게 시작하면 된다"
        subtitle="첫 턴을 열 때 필요한 순서를 여기서만 짧게 확인하면 된다."
        className="relative z-10 flex w-full max-w-[720px] flex-col"
        trailing={
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--panel-border)] bg-white/12 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/18"
          >
            닫기
          </button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              1. 먼저 말 걸 사람
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              지금은 {speakerName}의 입에서 다른 사람 이름이 나오게 만드는 턴이다.
            </p>
          </article>

          <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              2. 이번에 흔들 사람
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              {targetLabel
                ? `${targetLabel} 쪽으로 시선을 모으도록 아래 행동을 고른다.`
                : "드롭다운에서 먼저 흔들 사람을 하나 고른다."}
            </p>
          </article>

          <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              3. 버튼 하나로 시작
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              글을 길게 쓰지 않아도 된다. 빠른 행동 버튼 하나로도 첫 턴이 열린다.
            </p>
          </article>
        </div>
      </Panel>
    </div>
  );
}

