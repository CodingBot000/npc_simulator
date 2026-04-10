import { EMOTION_LABELS } from "@/lib/constants";
import type { NpcState } from "@/lib/types";
import { relationshipSummary } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";

interface NpcListProps {
  title: string;
  npcs: NpcState[];
  selectedNpcId: string;
  subtitle: string;
  riskByNpcId: Record<string, number>;
  onSelect: (npcId: string) => void;
}

export function NpcList({
  title,
  npcs,
  selectedNpcId,
  subtitle,
  riskByNpcId,
  onSelect,
}: NpcListProps) {
  return (
    <Panel eyebrow="Survivors" title={title} subtitle={subtitle}>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
      >
        {npcs.map((npc) => {
          const selected = npc.persona.id === selectedNpcId;

          return (
            <button
              key={npc.persona.id}
              type="button"
              onClick={() => onSelect(npc.persona.id)}
              className={`min-w-0 rounded-[22px] border px-3.5 py-2.5 text-left transition ${
                selected
                  ? "border-[var(--accent)] bg-[var(--panel-strong)] shadow-[0_14px_30px_rgba(176,91,45,0.14)]"
                  : "border-[var(--panel-border)] bg-white/20 hover:border-[var(--teal)] hover:bg-white/30"
              }`}
            >
              <div className="mb-1.5 flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-4 text-foreground">
                    {npc.persona.name}
                  </p>
                  <p className="truncate text-[11px] leading-4 text-[var(--ink-muted)]">
                    {npc.persona.role}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--teal-soft)] px-2.5 py-1 text-[11px] font-semibold leading-4 text-[var(--teal)]">
                  {EMOTION_LABELS[npc.emotion.primary]}
                </span>
              </div>
              <p
                className="overflow-hidden text-[11px] leading-4 text-[var(--ink-muted)]"
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                }}
              >
                {npc.statusLine}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium leading-4 text-[var(--ink-muted)]">
                <span className="truncate">{relationshipSummary(npc.relationship)}</span>
                <span className="shrink-0">위험도 {riskByNpcId[npc.persona.id] ?? 0}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
