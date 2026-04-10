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
    <Panel eyebrow="Survivors" title={title} subtitle={subtitle} className="h-full">
      <div className="space-y-3">
        {npcs.map((npc) => {
          const selected = npc.persona.id === selectedNpcId;

          return (
            <button
              key={npc.persona.id}
              type="button"
              onClick={() => onSelect(npc.persona.id)}
              className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                selected
                  ? "border-[var(--accent)] bg-[var(--panel-strong)] shadow-[0_14px_30px_rgba(176,91,45,0.14)]"
                  : "border-[var(--panel-border)] bg-white/20 hover:border-[var(--teal)] hover:bg-white/30"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-foreground">{npc.persona.name}</p>
                  <p className="text-sm text-[var(--ink-muted)]">{npc.persona.role}</p>
                </div>
                <span className="rounded-full bg-[var(--teal-soft)] px-3 py-1 text-xs font-semibold text-[var(--teal)]">
                  {EMOTION_LABELS[npc.emotion.primary]}
                </span>
              </div>
              <p className="text-sm leading-6 text-[var(--ink-muted)]">{npc.statusLine}</p>
              <div className="mt-3 flex items-center justify-between text-xs font-medium text-[var(--ink-muted)]">
                <span>{relationshipSummary(npc.relationship)}</span>
                <span>위험도 {riskByNpcId[npc.persona.id] ?? 0}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
