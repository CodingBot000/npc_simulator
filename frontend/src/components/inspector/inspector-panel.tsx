import { Panel } from "@/components/ui/panel";
import type {
  InspectorPayload,
  LlmInteractionResult,
  NpcState,
  ShadowComparisonPayload,
} from "@/lib/types";
import { formatDimensionDelta } from "@/lib/utils";

interface InspectorPanelProps {
  inspector: InspectorPayload | null;
  npc: NpcState;
  open: boolean;
}

function formatDuration(durationMs: number | null) {
  if (durationMs == null) {
    return "time n/a";
  }

  return `${durationMs}ms`;
}

function formatImpactTags(tags: string[]) {
  return tags.length > 0 ? tags.join(", ") : "없음";
}

function formatTarget(targetNpcId: string | null) {
  return targetNpcId ?? "없음";
}

function shadowStatusClassName(status: ShadowComparisonPayload["status"]) {
  if (status === "parsed") {
    return "border-[rgba(74,166,124,0.28)] bg-[rgba(74,166,124,0.16)] text-[var(--success)]";
  }

  if (status === "invalid_json") {
    return "border-[rgba(176,91,45,0.32)] bg-[rgba(176,91,45,0.16)] text-[var(--accent)]";
  }

  return "border-[rgba(214,90,90,0.28)] bg-[rgba(214,90,90,0.16)] text-[var(--danger)]";
}

interface ComparisonResultCardProps {
  label: string;
  meta: string;
  result: LlmInteractionResult;
  targetNpcId: string | null;
}

function ComparisonResultCard({
  label,
  meta,
  result,
  targetNpcId,
}: ComparisonResultCardProps) {
  return (
    <div className="rounded-[18px] border border-[var(--panel-border)] bg-black/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--teal)]">
        {label}
      </p>
      <p className="mt-1 text-xs leading-5">{meta}</p>
      <div className="mt-3 space-y-3 text-sm leading-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Reply
          </p>
          <p className="mt-1 text-foreground">{result.reply.text}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Emotion
          </p>
          <p className="mt-1 text-foreground">
            {result.emotion.primary} · {result.emotion.reason}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Intent
          </p>
          <p className="mt-1 text-foreground">{result.intent.summary}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Selected Action
          </p>
          <p className="mt-1 text-foreground">{result.selectedAction.type}</p>
          <p>{result.selectedAction.reason}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Structured Impact
          </p>
          <p className="mt-1 text-foreground">
            {formatImpactTags(result.structuredImpact.impactTags)}
          </p>
          <p>
            confidence {result.structuredImpact.confidence} · target{" "}
            {formatTarget(targetNpcId)}
          </p>
        </div>
      </div>
    </div>
  );
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
  const activeResult: LlmInteractionResult | null = activeInspector
    ? {
        reply: {
          text: activeInspector.replyText,
        },
        emotion: activeInspector.emotion,
        intent: activeInspector.intent,
        candidateActions: activeInspector.candidateActions,
        selectedAction: activeInspector.selectedAction,
        structuredImpact: activeInspector.structuredImpact,
      }
    : null;
  const shadowComparison = activeInspector?.shadowComparison ?? null;
  const shadowResult = shadowComparison?.result ?? null;
  const selectedActionSummary =
    shadowComparison?.status === "parsed" && shadowResult
      ? shadowResult.selectedAction.type === activeInspector?.selectedAction.type
        ? `selectedAction 일치 · ${shadowResult.selectedAction.type}`
        : `selectedAction 차이 · active ${activeInspector?.selectedAction.type} / shadow ${shadowResult.selectedAction.type}`
      : null;
  const targetSummary =
    shadowComparison?.status === "parsed" && shadowResult
      ? shadowResult.structuredImpact.targetNpcId === activeInspector?.targetNpcId
        ? `targetNpcId 일치 · ${formatTarget(shadowResult.structuredImpact.targetNpcId)}`
        : `targetNpcId 차이 · active ${formatTarget(activeInspector?.targetNpcId ?? null)} / shadow ${formatTarget(shadowResult.structuredImpact.targetNpcId)}`
      : null;

  return (
    <Panel
      eyebrow="Thin Inspector"
      title="감독자 모드"
      subtitle="기억, 편향, 압력 변화, 희생 후보 이동"
      className="h-full flex flex-col overflow-hidden"
      contentClassName="flex-1 min-h-0"
    >
      {activeInspector ? (
        <div className="scrollbar-thin h-full space-y-4 overflow-y-auto pr-2 text-sm text-[var(--ink-muted)]">
          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Retrieved Memories
            </p>
            <ul className="space-y-2 leading-6">
              {activeInspector.retrievedMemories.length > 0 ? (
                activeInspector.retrievedMemories.map((memory) => (
                  <li key={memory.id}>
                    <span className="font-semibold text-foreground">
                      score {memory.score}
                    </span>
                    {" · "}
                    {memory.summary}
                    <span className="block text-xs">
                      {memory.matchReasons.join(" / ")}
                    </span>
                  </li>
                ))
              ) : (
                <li>이번 입력과 강하게 맞물린 기억은 없다.</li>
              )}
            </ul>
          </section>

          <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Retrieved Knowledge
            </p>
            <ul className="space-y-3 leading-6">
              {activeInspector.retrievedKnowledge.length > 0 ? (
                activeInspector.retrievedKnowledge.map((evidence) => (
                  <li key={evidence.id}>
                    <p className="font-semibold text-foreground">
                      {evidence.title} · score {evidence.score}
                    </p>
                    <p>{evidence.summary}</p>
                    <p className="text-xs">
                      {evidence.sourceType} · {evidence.matchReasons.join(" / ")}
                    </p>
                  </li>
                ))
              ) : (
                <li>이번 입력에 회수된 구조화 근거는 없다.</li>
              )}
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
                Structured Impact
              </p>
              <p className="leading-6 text-foreground">
                {activeInspector.structuredImpact.impactTags.join(", ")}
              </p>
              <p className="mt-1">
                confidence {activeInspector.structuredImpact.confidence} ·{" "}
                {activeInspector.structuredImpact.rationale}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
                Leading Sacrifice Candidate
              </p>
              <p className="leading-6 text-foreground">
                {activeInspector.leaderBefore?.candidateLabel ?? "없음"} →{" "}
                {activeInspector.leadingCandidateLabel ?? "아직 결정적 선두 없음"}
              </p>
            </div>
          </section>

          {shadowComparison && activeResult ? (
            <section className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
                    Shadow Compare
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    현재 적용 결과와 shadow 모델 결과를 나란히 본다.
                  </p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${shadowStatusClassName(shadowComparison.status)}`}
                >
                  {shadowComparison.status}
                </span>
              </div>

              <div className="mt-3 space-y-2 text-xs leading-5">
                <p>
                  {shadowComparison.label} · {formatDuration(shadowComparison.durationMs)}
                </p>
                {shadowComparison.sourceRef ? (
                  <p className="break-all">{shadowComparison.sourceRef}</p>
                ) : null}
                {selectedActionSummary ? <p>{selectedActionSummary}</p> : null}
                {targetSummary ? <p>{targetSummary}</p> : null}
              </div>

              {shadowComparison.status === "parsed" && shadowResult ? (
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <ComparisonResultCard
                    label="Active Turn Output"
                    meta="현재 게임 진행에 반영된 결과"
                    result={activeResult}
                    targetNpcId={activeInspector.targetNpcId}
                  />
                  <ComparisonResultCard
                    label={shadowComparison.label}
                    meta={`shadow 실행 결과 · ${formatDuration(shadowComparison.durationMs)}`}
                    result={shadowResult}
                    targetNpcId={shadowResult.structuredImpact.targetNpcId}
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="leading-6 text-foreground">
                    {shadowComparison.error ?? "Shadow 결과를 구조화 JSON으로 읽지 못했다."}
                  </p>
                  {shadowComparison.rawOutput ? (
                    <pre className="max-h-56 overflow-auto rounded-[18px] border border-[var(--panel-border)] bg-black/15 p-4 text-xs leading-5 text-foreground whitespace-pre-wrap">
                      {shadowComparison.rawOutput}
                    </pre>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

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
            <p className="mt-3 text-xs leading-5">
              Episode {activeInspector.episodeId}
              {activeInspector.datasetExportedAt
                ? ` · dataset exported ${activeInspector.datasetExportedAt}`
                : " · dataset pending"}
            </p>
            {activeInspector.exportPaths.richTrace ? (
              <p className="mt-1 text-xs leading-5">
                {activeInspector.exportPaths.richTrace}
              </p>
            ) : null}
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
