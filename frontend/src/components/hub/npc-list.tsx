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
    <Panel
      eyebrow="대화 상대"
      title={title}
      subtitle={subtitle}
      className="play-session-card"
    >
      <div className="grid gap-3 grid-cols-2">
        {npcs.map((npc) => {
          const selected = npc.persona.id === selectedNpcId;

          return (
            <button
              key={npc.persona.id}
              type="button"
              onClick={() => onSelect(npc.persona.id)}
              className={`min-w-0 rounded-[22px] border px-3.5 py-3 text-left transition ${
                selected
                  ? "border-[var(--accent)] bg-[var(--panel-strong)] shadow-[0_14px_30px_rgba(176,91,45,0.14)]"
                  : "border-[var(--panel-border)] bg-white/20 hover:border-[var(--teal)] hover:bg-white/30"
              }`}
            >
              <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-5 text-foreground">
                    {npc.persona.name}
                  </p>
                  <p className="truncate text-xs leading-5 text-[var(--ink-muted)]">
                    {npc.persona.role}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {selected ? (
                    <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold leading-4 text-[var(--accent)]">
                      대화 중
                    </span>
                  ) : null}
                  <span className="shrink-0 rounded-full bg-[var(--teal-soft)] px-2.5 py-1 text-[11px] font-semibold leading-4 text-[var(--teal)]">
                    {EMOTION_LABELS[npc.emotion.primary]}
                  </span>
                </div>
              </div>
              <p
                className="overflow-hidden text-xs leading-5 text-[var(--ink-muted)]"
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                }}
              >
                {npc.statusLine}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-medium leading-4 text-[var(--ink-muted)]">
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
