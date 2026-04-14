interface QuickStartHintsProps {
  speakerName: string;
  targetLabel: string | null;
}

export function QuickStartHints({
  speakerName,
  targetLabel,
}: QuickStartHintsProps) {
  return (
    <section className="rounded-[24px] border border-[var(--panel-border)] bg-[rgba(76,194,200,0.1)] px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
        이렇게 시작하면 된다
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">1. 먼저 말 걸 사람</p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
            지금은 {speakerName}의 입에서 다른 사람 이름이 나오게 만드는 턴이다.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">2. 이번에 흔들 사람</p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
            {targetLabel
              ? `${targetLabel} 쪽으로 시선을 모으도록 아래 행동을 고른다.`
              : "드롭다운에서 먼저 흔들 사람을 하나 고른다."}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">3. 버튼 하나로 시작</p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
            글을 길게 쓰지 않아도 된다. 빠른 행동 버튼 하나로도 첫 턴이 열린다.
          </p>
        </div>
      </div>
    </section>
  );
}
