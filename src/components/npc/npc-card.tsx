import type { NpcState } from "@/lib/types";
import { emotionLabel, relationshipSummary } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";

interface NpcCardProps {
  npc: NpcState;
}

function Meter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-white/70">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function NpcCard({ npc }: NpcCardProps) {
  return (
    <Panel
      eyebrow="Focused Survivor"
      title={`${npc.persona.name} · ${npc.persona.role}`}
      subtitle={`${relationshipSummary(npc.relationship)} · 현재 논리: ${npc.decision.biasSummary}`}
    >
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="rounded-[24px] bg-white/20 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {npc.persona.traits.map((trait) => (
                <span
                  key={trait}
                  className="rounded-full border border-[rgba(76,194,200,0.36)] bg-[rgba(76,194,200,0.18)] px-3 py-1 text-xs font-semibold text-[#d8fbfd]"
                >
                  {trait}
                </span>
              ))}
            </div>
            <p className="text-sm leading-7 text-[var(--ink-muted)]">
              {npc.persona.tone}. 지금은 <strong>{emotionLabel(npc.emotion.primary)}</strong>
              상태이며, {npc.emotion.reason}
            </p>
          </div>

          <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
              Survival Logic
            </p>
            <p className="text-sm leading-7 text-foreground">{npc.decision.survivalRationale}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Red Lines
            </p>
            <p className="mt-1 text-sm leading-7 text-[var(--ink-muted)]">
              {npc.decision.redLines.join(" · ")}
            </p>
          </div>

          <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
              Current Need
            </p>
            <p className="text-sm leading-7 text-foreground">{npc.goals.currentNeed}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Values
            </p>
            <p className="mt-1 text-sm leading-7 text-[var(--ink-muted)]">
              {npc.persona.values.join(" · ")}
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
          <Meter label="Trust" value={npc.relationship.playerTrust} color="var(--teal)" />
          <Meter
            label="Affinity"
            value={npc.relationship.playerAffinity}
            color="var(--accent)"
          />
          <Meter
            label="Tension"
            value={npc.relationship.playerTension}
            color="var(--danger)"
          />
          <div className="rounded-2xl border border-[var(--panel-border)] bg-[rgba(12,33,48,0.72)] p-4 text-sm leading-6 text-[var(--ink-muted)]">
            <p className="mb-1 font-semibold text-foreground">최근 기억 단서</p>
            <ul className="space-y-2">
              {npc.memories.slice(0, 3).map((memory) => (
                <li key={memory.id}>{memory.summary}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Panel>
  );
}
