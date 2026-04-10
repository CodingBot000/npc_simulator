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
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <article
            key={entry.candidateId}
            className={`rounded-[22px] border px-4 py-4 ${
              index === 0
                ? "border-[var(--danger)] bg-[rgba(120,32,33,0.08)]"
                : "border-[var(--panel-border)] bg-white/20"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {index + 1}. {entry.candidateLabel}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">{entry.summary}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold text-foreground">{entry.totalPressure}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  표심 {entry.topVotes} · {trendLabel[entry.trend]}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
