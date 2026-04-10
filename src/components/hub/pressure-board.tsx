import type { ConsensusBoardEntry } from "@/lib/types";
import { Panel } from "@/components/ui/panel";

const trendLabel: Record<ConsensusBoardEntry["trend"], string> = {
  up: "상승",
  down: "하락",
  flat: "유지",
};

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
    <Panel eyebrow="Consensus" title={title} subtitle={subtitle}>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
      >
        {entries.map((entry, index) => (
          <article
            key={entry.candidateId}
            className={`min-w-0 rounded-[18px] border bg-white/20 px-3 py-2 ${
              index === 0 ? "border-[var(--danger)]" : "border-[var(--panel-border)]"
            }`}
          >
            <div className="min-w-0">
              <div className="mb-1 flex items-start justify-between gap-1.5">
                <p
                  className={`truncate text-[13px] font-semibold leading-4 ${
                    index === 0 ? "text-[var(--danger)]" : "text-foreground"
                  }`}
                >
                  {index + 1}. {entry.candidateLabel}
                </p>
                <p
                  className={`shrink-0 text-sm font-semibold leading-4 ${
                    index === 0 ? "text-[var(--danger)]" : "text-foreground"
                  }`}
                >
                  {entry.totalPressure}
                </p>
              </div>
              <p className="truncate text-[11px] leading-4 text-[var(--ink-muted)]">
                {entry.summary}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                표심 {entry.topVotes} · {trendLabel[entry.trend]}
              </p>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
