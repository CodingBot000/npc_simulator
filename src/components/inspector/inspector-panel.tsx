import { Panel } from "@/components/ui/panel";
import type { InspectorPayload, NpcState } from "@/lib/types";

interface InspectorPanelProps {
  inspector: InspectorPayload | null;
  npc: NpcState;
  open: boolean;
}

export function InspectorPanel({
  inspector,
  npc,
  open,
}: InspectorPanelProps) {
  if (!open) {
    return null;
  }

  const activeInspector = inspector?.npcId === npc.persona.id ? inspector : inspector;

  return (
    <Panel
      eyebrow="Thin Inspector"
      title="감독자 모드"
      subtitle="기억, 감정, 의도, 후보 행동, 선택 이유"
      className="h-full"
    >
      {activeInspector ? (
        <div className="space-y-4 text-sm text-[var(--ink-muted)]">
          <section className="rounded-[22px] bg-[var(--panel-strong)] p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Retrieved Memories
            </p>
            <ul className="space-y-2 leading-6">
              {activeInspector.retrievedMemories.map((memory) => (
                <li key={memory.id}>{memory.summary}</li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3 rounded-[22px] border border-[var(--panel-border)] bg-white/55 p-4">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
                Emotion
              </p>
              <p className="leading-6 text-foreground">
                {activeInspector.emotion.primary} · {activeInspector.emotion.reason}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
                Intent
              </p>
              <p className="leading-6 text-foreground">{activeInspector.intent.summary}</p>
              <p className="mt-1">{activeInspector.intent.leverage}</p>
            </div>
          </section>

          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/55 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Candidate Actions
            </p>
            <ul className="space-y-3">
              {activeInspector.candidateActions.map((action) => (
                <li key={action.type}>
                  <p className="font-semibold text-foreground">{action.label}</p>
                  <p className="leading-6">{action.reason}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[22px] bg-[rgba(43,103,107,0.08)] p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Selected Action
            </p>
            <p className="font-semibold text-foreground">
              {activeInspector.selectedAction.type}
            </p>
            <p className="mt-1 leading-6">{activeInspector.selectedActionReason}</p>
          </section>
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-[var(--panel-border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
          아직 감독자 데이터가 없다. 첫 상호작용 이후 내부 판단 근거가 여기에 쌓인다.
        </div>
      )}
    </Panel>
  );
}
