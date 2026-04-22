import { Panel } from "@/components/ui/panel";
import type {
  RoundState,
  ScenarioScoringSnapshot,
  WorldMeta,
} from "@/lib/types";

interface MissionBriefCardProps {
  busy: boolean;
  round: RoundState;
  scoring: ScenarioScoringSnapshot;
  world: WorldMeta;
  onRestart: () => void;
}

function roundStatusLabel(round: RoundState) {
  if (round.currentRound === 0) {
    return "아직 첫 발언 전";
  }

  if (round.currentRound < round.minRoundsBeforeResolution) {
    return `${round.currentRound}라운드 진행 중`;
  }

  return "이제 결말이 날 수 있는 구간";
}

function resolutionRuleText(scoring: ScenarioScoringSnapshot) {
  return [
    `최소 ${scoring.minRoundsBeforeResolution}라운드 이후`,
    `1위와 2위의 압력차가 ${scoring.leadGapThreshold} 이상이 되거나`,
    `한 후보가 ${scoring.instantConsensusVotes}표를 모으거나`,
    `${scoring.maxRounds}라운드에 도달하면 결말이 난다.`,
  ].join(" ");
}

export function MissionBriefCard({
  busy,
  round,
  scoring,
  world,
  onRestart,
}: MissionBriefCardProps) {
  return (
    <Panel
      eyebrow="임무"
      title="네가 아닌 다른 한 명이 남겨지게 만들어라"
      subtitle="사람을 고르고, 말을 던지고, 압력 변화를 읽어라."
      className="play-session-card"
      trailing={
        <button
          type="button"
          onClick={onRestart}
          disabled={busy}
          className="rounded-full bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "정리 중..." : "처음부터 다시"}
        </button>
      }
      contentClassName="space-y-4"
    >
      <div className="grid gap-3 grid-cols-3">
        <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            목표
          </p>
          <p className="mt-2 text-sm leading-7 text-foreground">
            네가 아니라 다른 한 사람이 밸브실에 남도록 판세를 움직여라.
            <br />
            <span className="text-[var(--ink-muted)]">
              종료조건: {resolutionRuleText(scoring)}
            </span>
          </p>
        </article>

        <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            방법
          </p>
          <p className="mt-2 text-sm leading-7 text-foreground">
            말 걸 사람을 고르고, 흔들 대상을 정한 뒤, 한 문장이나 행동 버튼으로 압력을 민다.
          </p>
        </article>

        <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            제한
          </p>
          <p className="mt-2 text-sm leading-7 text-foreground">
            최소 {round.minRoundsBeforeResolution}라운드 전에는 결말이 나지 않는다. 섣불리 몰아도 바로 끝나지 않는다.
          </p>
        </article>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-[var(--ink-muted)]">
        <span className="rounded-full border border-[var(--panel-border)] bg-white/10 px-3 py-1.5">
          {world.location} · {world.time}
        </span>
        <span className="rounded-full border border-[var(--panel-border)] bg-white/10 px-3 py-1.5">
          {roundStatusLabel(round)}
        </span>
        <span className="rounded-full border border-[var(--panel-border)] bg-white/10 px-3 py-1.5">
          {round.facilityStatus}
        </span>
        <span className="rounded-full border border-[var(--panel-border)] bg-white/10 px-3 py-1.5">
          {round.rescueEtaLabel}
        </span>
      </div>
    </Panel>
  );
}
