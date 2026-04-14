import type { InteractionResponsePayload } from "@/lib/types";
import { formatDelta, formatDimensionDelta } from "@/lib/utils";

interface TurnOutcomeStripProps {
  outcome: InteractionResponsePayload;
}

function strongestChange(outcome: InteractionResponsePayload) {
  return [...outcome.pressureChanges].sort((left, right) => {
    const leftScore =
      (left.totalPressureDelta > 0 ? 1000 : 0) + Math.abs(left.totalPressureDelta);
    const rightScore =
      (right.totalPressureDelta > 0 ? 1000 : 0) + Math.abs(right.totalPressureDelta);
    return rightScore - leftScore;
  })[0] ?? null;
}

function strongestRise(outcome: InteractionResponsePayload) {
  return [...outcome.pressureChanges]
    .filter((entry) => entry.totalPressureDelta > 0)
    .sort((left, right) => right.totalPressureDelta - left.totalPressureDelta)[0] ?? null;
}

function relationshipReadout(outcome: InteractionResponsePayload) {
  const lines: string[] = [];

  if (outcome.relationshipDelta.trust !== 0) {
    lines.push(`신뢰 ${formatDelta(outcome.relationshipDelta.trust)}`);
  }
  if (outcome.relationshipDelta.affinity !== 0) {
    lines.push(`공감 ${formatDelta(outcome.relationshipDelta.affinity)}`);
  }
  if (outcome.relationshipDelta.tension !== 0) {
    lines.push(`긴장 ${formatDelta(outcome.relationshipDelta.tension)}`);
  }

  return lines.length > 0 ? lines.join(" · ") : "말은 오갔지만 관계 수치는 크게 흔들리지 않았다.";
}

export function TurnOutcomeStrip({ outcome }: TurnOutcomeStripProps) {
  const mainChange = strongestChange(outcome);
  const risingRisk = strongestRise(outcome);
  const whyLine =
    mainChange?.reasons[0] ??
    mainChange?.factors[0] ??
    outcome.inspector.structuredImpact.rationale ??
    "이번 발언은 아직 결정적인 압력 이동을 만들지 못했다.";

  return (
    <section className="space-y-3 rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            방금 결과
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            네 말이 실제로 누구를 더 위험하게 만들었는지부터 읽으면 된다.
          </p>
        </div>
        {outcome.resolution.resolved ? (
          <span className="rounded-full bg-[rgba(214,90,90,0.16)] px-3 py-1 text-xs font-semibold text-[var(--danger)]">
            결말 확정
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <article className="rounded-[20px] border border-[var(--panel-border)] bg-white/10 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal)]">
            누가 흔들렸나
          </p>
          <p className="mt-2 text-sm font-semibold text-foreground">
            {mainChange
              ? `${mainChange.candidateLabel} 쪽 판세가 가장 크게 움직였다.`
              : "아직 판세를 크게 흔들지는 못했다."}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
            {mainChange
              ? formatDimensionDelta(mainChange.dimensionDelta, { omitZero: true }) ||
                `위험도 ${formatDelta(mainChange.totalPressureDelta)}`
              : relationshipReadout(outcome)}
          </p>
        </article>

        <article className="rounded-[20px] border border-[var(--panel-border)] bg-white/10 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal)]">
            누가 더 위험해졌나
          </p>
          <p className="mt-2 text-sm font-semibold text-foreground">
            {risingRisk
              ? `${risingRisk.candidateLabel} 위험도 ${formatDelta(risingRisk.totalPressureDelta)}`
              : "이번 턴에는 즉시 치솟은 위험 대상이 없다."}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
            {risingRisk
              ? risingRisk.reasons[0] ?? "방 안의 시선이 이 사람 쪽으로 조금 더 기울었다."
              : relationshipReadout(outcome)}
          </p>
        </article>

        <article className="rounded-[20px] border border-[var(--panel-border)] bg-white/10 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal)]">
            왜 그랬나
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{whyLine}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            “{outcome.reply.text}”
          </p>
        </article>
      </div>
    </section>
  );
}
