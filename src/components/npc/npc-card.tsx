import { useEffect, useState } from "react";
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

function TraitBadge({ trait }: { trait: string }) {
  return (
    <span className="rounded-full border border-[rgba(76,194,200,0.36)] bg-[rgba(76,194,200,0.18)] px-3 py-1 text-xs font-semibold text-[#d8fbfd]">
      {trait}
    </span>
  );
}

function SummaryChips({ npc }: { npc: NpcState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-[var(--teal-soft)] px-3 py-1 text-xs font-semibold text-[var(--teal)]">
        {emotionLabel(npc.emotion.primary)}
      </span>
      {npc.persona.traits.slice(0, 2).map((trait) => (
        <TraitBadge key={trait} trait={trait} />
      ))}
      {npc.persona.traits.length > 2 ? (
        <span className="rounded-full border border-[var(--panel-border)] bg-white/10 px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          +{npc.persona.traits.length - 2}
        </span>
      ) : null}
    </div>
  );
}

function OverviewGrid({ npc }: { npc: NpcState }) {
  const latestMemory = npc.memories[0] ?? null;

  return (
    <div className="grid gap-4 grid-cols-2">
      <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          지금 상태
        </p>
        <p className="text-sm leading-7 text-foreground">{npc.statusLine}</p>
        <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">{npc.emotion.reason}</p>
      </div>

      <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          지금 원하는 것
        </p>
        <p className="text-sm leading-7 text-foreground">{npc.goals.currentNeed}</p>
      </div>

      <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
          최근 남은 기억
        </p>
        {latestMemory ? (
          <p className="text-sm leading-7 text-[var(--ink-muted)]">{latestMemory.summary}</p>
        ) : (
          <p className="text-sm leading-7 text-[var(--ink-muted)]">
            아직 이 인물에게 새로 남은 기억 단서는 없다.
          </p>
        )}
      </div>

      <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          살아남으려는 논리
        </p>
        <p className="text-sm leading-7 text-[var(--ink-muted)]">
          {npc.decision.survivalRationale}
        </p>
      </div>
    </div>
  );
}

function RelationshipSection({ npc }: { npc: NpcState }) {
  return (
    <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
        당신과의 거리
      </p>
      <div className="grid gap-4 grid-cols-3">
        <Meter label="신뢰" value={npc.relationship.playerTrust} color="var(--teal)" />
        <Meter
          label="호감"
          value={npc.relationship.playerAffinity}
          color="var(--accent)"
        />
        <Meter
          label="긴장"
          value={npc.relationship.playerTension}
          color="var(--danger)"
        />
      </div>
    </div>
  );
}

function DetailSections({ npc }: { npc: NpcState }) {
  return (
    <div className="grid gap-5 border-t border-[var(--panel-border)] pt-5 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px]">
      <section className="space-y-4 border-r border-[var(--panel-border)] pr-5">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            말투
          </p>
          <p className="text-sm leading-7 text-[var(--ink-muted)]">{npc.persona.tone}</p>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            중요하게 여기는 것
          </p>
          <p className="text-sm leading-7 text-[var(--ink-muted)]">
            {npc.persona.values.join(" · ")}
          </p>
        </div>
      </section>

      <section className="space-y-4 border-r border-[var(--panel-border)] pr-5">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            넘기 힘든 선
          </p>
          <p className="text-sm leading-7 text-[var(--ink-muted)]">
            {npc.decision.redLines.join(" · ")}
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            드러난 성향
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {npc.persona.traits.map((trait) => (
              <TraitBadge key={trait} trait={trait} />
            ))}
          </div>
        </div>
      </section>

      <aside className="space-y-4 pl-1">
        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4 text-sm leading-6 text-[var(--ink-muted)]">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
            기억 조각
          </p>
          <ul className="space-y-2">
            {npc.memories.slice(0, 4).map((memory) => (
              <li key={memory.id}>{memory.summary}</li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function DetailModal({
  npc,
  open,
  onClose,
}: {
  npc: NpcState;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
      <button
        type="button"
        aria-label="세부 정보 닫기"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(3,10,17,0.72)] backdrop-blur-sm"
      />

      <Panel
        eyebrow="집중 보기"
        title={`${npc.persona.name} · ${npc.persona.role}`}
        subtitle={`${relationshipSummary(npc.relationship)} · 현재 논리: ${npc.decision.biasSummary}`}
        className="play-session-card relative z-10 flex max-h-[calc(100vh-3rem)] w-full max-w-[1160px] flex-col overflow-hidden"
        trailing={
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--panel-border)] bg-white/15 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/20"
          >
            닫기
          </button>
        }
        contentClassName="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto pr-2"
      >
        <SummaryChips npc={npc} />
        <OverviewGrid npc={npc} />
        <RelationshipSection npc={npc} />
        <DetailSections npc={npc} />
      </Panel>
    </div>
  );
}

export function NpcCard({ npc }: NpcCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <Panel
        eyebrow="상황"
        title={`${npc.persona.name} · ${npc.persona.role}`}
        subtitle={`${relationshipSummary(npc.relationship)} · 현재 논리: ${npc.decision.biasSummary}`}
        className="play-session-card"
        trailing={
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="rounded-full border border-[var(--panel-border)] bg-white/15 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/20"
          >
            세부 열기
          </button>
        }
      >
        <div className="space-y-5">
          <SummaryChips npc={npc} />
          <OverviewGrid npc={npc} />
          <RelationshipSection npc={npc} />
        </div>
      </Panel>

      <DetailModal npc={npc} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </>
  );
}
