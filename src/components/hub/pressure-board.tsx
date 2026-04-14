import type { ConsensusBoardEntry } from "@/lib/types";
import { Panel } from "@/components/ui/panel";
import { pressureSummary } from "@/lib/utils";

const trendLabel: Record<ConsensusBoardEntry["trend"], string> = {
  up: "위험 상승",
  down: "압력 완화",
  flat: "큰 변화 없음",
};

const compactCardTextClassName = "text-xs leading-[0.625rem]";
const compactChipClassName =
  "rounded-full border border-[var(--panel-border)] bg-white/8 px-[0.21rem] py-[0.08rem] text-[var(--ink-muted)]";

function riskLevel(totalPressure: number) {
  if (totalPressure >= 90) {
    return "당장 가장 먼저 밀릴 수 있음";
  }

  if (totalPressure >= 70) {
    return "방 안의 시선이 빠르게 몰리는 중";
  }

  if (totalPressure >= 50) {
    return "위험권에 들어옴";
  }

  return "아직 결정적 고립은 아님";
}

export function PressureBoard({
  entries,
  title,
  subtitle,
}: {
  entries: ConsensusBoardEntry[];
  title: string;
  subtitle: string;
}) {
  return (
    <Panel
      eyebrow="위험도"
      title={title}
      subtitle={subtitle}
      className="play-session-card"
    >
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
      >
        {entries.map((entry, index) => (
          <article
            key={entry.candidateId}
            className={`min-w-0 rounded-[22px] border bg-white/14 px-4 py-4 ${
              index === 0
                ? "border-[var(--panel-border)] shadow-[0_18px_36px_rgba(214,90,90,0.1)]"
                : "border-[var(--panel-border)]"
            }`}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <p
                className={`truncate text-base font-semibold ${
                  index === 0 ? "text-[var(--danger)]" : "text-foreground"
                }`}
              >
                {entry.candidateLabel}
              </p>
              <div className="shrink-0 text-right">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  위험도
                </p>
                <p
                  className={`text-2xl font-semibold ${
                    index === 0 ? "text-[var(--danger)]" : "text-foreground"
                  }`}
                >
                  {entry.totalPressure}
                </p>
              </div>
              <p
                className={`col-span-2 text-[var(--ink-muted)] ${compactCardTextClassName}`}
              >
                {riskLevel(entry.totalPressure)}
              </p>
            </div>

            <p className={`mt-3 text-foreground ${compactCardTextClassName}`}>
              {entry.summary || pressureSummary(entry)}
            </p>

            <div className={`mt-3 flex flex-wrap gap-2 ${compactCardTextClassName}`}>
              <span className={compactChipClassName}>
                {trendLabel[entry.trend]}
              </span>
              <span className={compactChipClassName}>
                {entry.topVotes > 0
                  ? `${entry.topVotes}명이 먼저 지목`
                  : "아직 직접 지목은 적음"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
