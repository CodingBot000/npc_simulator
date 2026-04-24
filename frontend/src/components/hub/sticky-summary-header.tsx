import { DEFAULT_PLAYER_ID, DEFAULT_PLAYER_LABEL } from "@/lib/constants";
import type { ConsensusBoardEntry, NpcState } from "@/lib/types";

interface StickySummaryHeaderProps {
  visible: boolean;
  pinned: boolean;
  consensusEntries: ConsensusBoardEntry[];
  npcs: NpcState[];
  selectedNpcId: string;
  riskByNpcId: Record<string, number>;
  disabled?: boolean;
  onSelectNpc: (npcId: string) => void;
  onTogglePinned: () => void;
}

export function StickySummaryHeader({
  visible,
  pinned,
  consensusEntries,
  npcs,
  selectedNpcId,
  riskByNpcId,
  disabled = false,
  onSelectNpc,
  onTogglePinned,
}: StickySummaryHeaderProps) {
  const playerRisk =
    consensusEntries.find((entry) => entry.candidateId === DEFAULT_PLAYER_ID)?.totalPressure ?? 0;
  const highestRisk = consensusEntries.reduce(
    (maxValue, entry) => Math.max(maxValue, entry.totalPressure),
    0,
  );
  const playerRiskClassName =
    playerRisk === highestRisk ? "text-[var(--danger)]" : "text-foreground";

  return (
    <div
      className={`play-session-card pointer-events-none fixed inset-x-0 top-0 z-50 px-6 transition-all duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden={!visible}
    >
      <div
        className={`mx-auto grid min-w-[1280px] w-full max-w-[1540px] grid-cols-[minmax(0,1fr)_44px] items-center gap-4 rounded-[22px] px-4 py-3 panel-surface pointer-events-auto transition-all duration-200 ${
          visible ? "translate-y-0" : "-translate-y-2"
        }`}
      >
        <div className="flex min-w-0 items-center justify-start gap-3">
          <div className="flex shrink-0 items-center gap-3">
            <article className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--panel-border)] bg-white/18 px-3 py-2">
              <p className="truncate text-[12px] font-semibold leading-4 text-foreground">
                {DEFAULT_PLAYER_LABEL}
              </p>
              <p className={`shrink-0 text-[13px] font-semibold leading-4 ${playerRiskClassName}`}>
                {playerRisk}
              </p>
            </article>

            <span
              aria-hidden="true"
              className="text-sm font-semibold leading-4 text-[var(--ink-muted)]"
            >
              |
            </span>
          </div>

          <div className="flex min-w-0 items-center justify-start gap-2">
            <span className="shrink-0 text-[11px] font-semibold leading-4 text-[var(--ink-muted)]">
              캐릭터선택
            </span>

            <div className="flex flex-wrap items-center justify-start gap-2">
              {npcs.map((npc) => {
                const selected = npc.persona.id === selectedNpcId;
                const npcRisk = riskByNpcId[npc.persona.id] ?? 0;
                const npcRiskClassName =
                  npcRisk === highestRisk ? "text-[var(--danger)]" : "text-[var(--ink-muted)]";

                return (
                  <button
                    key={npc.persona.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectNpc(npc.persona.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-left transition ${
                      selected
                        ? "border-[var(--teal)] bg-[var(--panel-strong)] shadow-[0_10px_24px_rgba(43,152,168,0.14)]"
                        : "border-[var(--panel-border)] bg-white/18 text-foreground hover:border-[var(--teal)] hover:bg-white/24"
                    } disabled:cursor-not-allowed disabled:opacity-55`}
                  >
                    <span className="truncate text-[12px] font-semibold leading-4 text-foreground">
                      {npc.persona.name}
                    </span>
                    <span className={`shrink-0 text-[13px] font-semibold leading-4 ${npcRiskClassName}`}>
                      {npcRisk}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onTogglePinned}
          aria-label={pinned ? "고정 해제" : "상단 고정"}
          aria-pressed={pinned}
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
            pinned
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--panel-border)] bg-white/12 text-[var(--ink-muted)] hover:border-[var(--teal)] hover:text-[var(--teal)]"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${pinned ? "rotate-0" : "rotate-12"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 4h8" />
            <path d="M9 4l1.2 5.2a2 2 0 0 1-.56 1.86L7 13.7V15h10v-1.3l-2.64-2.64a2 2 0 0 1-.56-1.86L15 4" />
            <path d="M12 15v5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
