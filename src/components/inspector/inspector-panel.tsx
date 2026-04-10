import { Panel } from "@/components/ui/panel";
import type { InspectorPayload, NpcState } from "@/lib/types";
import { formatDimensionDelta } from "@/lib/utils";

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
      subtitle="기억, 편향, 압력 변화, 희생 후보 이동"
      className="h-full"
    >
      {activeInspector ? (
        <div className="space-y-4 text-sm text-[var(--ink-muted)]">
          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Retrieved Memories
            </p>
            <ul className="space-y-2 leading-6">
              {activeInspector.retrievedMemories.map((memory) => (
                <li key={memory.id}>{memory.summary}</li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3 rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
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
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
                Leading Sacrifice Candidate
              </p>
              <p className="leading-6 text-foreground">
                {activeInspector.leadingCandidateLabel ?? "아직 결정적 선두 없음"}
              </p>
            </div>
          </section>

          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
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

          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Pressure Shifts
            </p>
            <ul className="space-y-2 leading-6">
              {activeInspector.pressureChanges.length > 0 ? (
                activeInspector.pressureChanges.map((entry) => (
                  <li key={`${entry.candidateId}-${entry.totalPressureDelta}`}>
                    <span className="font-semibold text-foreground">{entry.candidateLabel}</span>
                    {" · "}
                    {entry.totalPressureDelta >= 0 ? "+" : ""}
                    {entry.totalPressureDelta}
                    {" · "}
                    {formatDimensionDelta(entry.dimensionDelta, { omitZero: true })}
                    {" · "}
                    {entry.reasons.join(" ")}
                    {entry.factors.length > 0 ? (
                      <>
                        {" "}
                        {"("}
                        {entry.factors.join(" / ")}
                        {")"}
                      </>
                    ) : null}
                  </li>
                ))
              ) : (
                <li>이번 턴에는 눈에 띄는 압력 이동이 없었다.</li>
              )}
            </ul>
          </section>

          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
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
          아직 감독자 데이터가 없다. 첫 상호작용 이후 내부 판단과 압력 이동이 여기에 쌓인다.
        </div>
      )}
    </Panel>
  );
}
