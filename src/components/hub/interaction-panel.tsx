"use client";

import { PLAYER_ACTION_DESCRIPTIONS } from "@/lib/constants";
import type {
  AvailableActionDefinition,
  ChatMessage,
  InteractionResponsePayload,
  NpcState,
  PlayerAction,
  ResolutionState,
  RoundState,
} from "@/lib/types";
import { formatDelta, formatDimensionDelta, formatTimestampShort } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";

interface InteractionPanelProps {
  npc: NpcState;
  conversation: ChatMessage[];
  draft: string;
  busy: boolean;
  subtitle: string;
  placeholder: string;
  availableActions: AvailableActionDefinition[];
  targetOptions: Array<{ id: string; label: string }>;
  selectedTargetId: string | null;
  round: RoundState;
  resolution: ResolutionState;
  lastOutcome: InteractionResponsePayload | null;
  draftWarning: string | null;
  onDraftChange: (value: string) => void;
  onTargetChange: (value: string | null) => void;
  onSubmit: () => void;
  onAction: (action: PlayerAction) => void;
}

export function InteractionPanel({
  npc,
  conversation,
  draft,
  busy,
  subtitle,
  placeholder,
  availableActions,
  targetOptions,
  selectedTargetId,
  round,
  resolution,
  lastOutcome,
  draftWarning,
  onDraftChange,
  onTargetChange,
  onSubmit,
  onAction,
}: InteractionPanelProps) {
  const latestOutcome =
    lastOutcome?.inspector.npcId === npc.persona.id ? lastOutcome : null;

  return (
    <Panel
      eyebrow="Negotiation"
      title={`${npc.persona.name} 압박 조정`}
      subtitle={subtitle}
      className="min-h-[720px]"
      contentClassName="space-y-4"
    >
      <div className="grid gap-3 grid-cols-[minmax(280px,3.5fr)_minmax(0,6.5fr)]">
        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            Round
          </p>
          <p className="text-sm leading-7 text-foreground">
            {round.currentRound}/{round.maxRounds} 라운드 · 최소 확정 라운드 {round.minRoundsBeforeResolution}
          </p>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
            {round.rescueEtaLabel}
          </p>
          <p className="text-sm leading-7 text-[var(--ink-muted)]">{round.facilityStatus}</p>
          {resolution.resolved ? (
            <p className="mt-3 rounded-2xl bg-[rgba(120,32,33,0.1)] px-4 py-3 text-sm text-[var(--danger)]">
              {resolution.summary}
            </p>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            Last Shift
          </p>
          {latestOutcome ? (
            <div className="space-y-2 text-sm text-[var(--ink-muted)]">
              <p>
                신뢰 {formatDelta(latestOutcome.relationshipDelta.trust)} / 공감{" "}
                {formatDelta(latestOutcome.relationshipDelta.affinity)} / 긴장{" "}
                {formatDelta(latestOutcome.relationshipDelta.tension)}
              </p>
              <p className="leading-6 text-foreground">{latestOutcome.reply.text}</p>
              <div className="rounded-[18px] border border-[var(--panel-border)] bg-white/20 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                  Structured Impact
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {latestOutcome.inspector.structuredImpact.impactTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[var(--panel-border)] bg-[var(--panel-strong)] px-2.5 py-1 text-[11px] font-semibold text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-5">
                  {latestOutcome.inspector.structuredImpact.rationale}
                </p>
              </div>
              <div className="rounded-[18px] border border-[var(--panel-border)] bg-white/20 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                  Retrieved Evidence
                </p>
                {latestOutcome.inspector.retrievedKnowledge.length > 0 ||
                latestOutcome.inspector.retrievedMemories.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-xs leading-5">
                    {latestOutcome.inspector.retrievedKnowledge.slice(0, 3).map((entry) => (
                      <li key={entry.id}>
                        <span className="font-semibold text-foreground">근거 · {entry.title}</span>
                        {" · "}
                        {entry.summary}
                      </li>
                    ))}
                    {latestOutcome.inspector.retrievedMemories.slice(0, 2).map((entry) => (
                      <li key={entry.id}>
                        <span className="font-semibold text-foreground">기억 · </span>
                        {entry.summary}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs leading-5">이번 턴에 직접 연결된 retrieval 근거는 없다.</p>
                )}
              </div>
              <ul className="space-y-1">
                {latestOutcome.pressureChanges.length > 0 ? (
                  latestOutcome.pressureChanges.map((entry) => (
                    <li key={`${entry.candidateId}-${entry.totalPressureDelta}`}>
                      {entry.candidateLabel} 압력 {formatDelta(entry.totalPressureDelta)}
                      {" · "}
                      {formatDimensionDelta(entry.dimensionDelta, { omitZero: true })}
                    </li>
                  ))
                ) : (
                  <li>이번 발언은 즉시 눈에 띄는 압력 이동을 만들지 못했다.</li>
                )}
              </ul>
              {latestOutcome.resolution.resolved ? (
                <p className="font-semibold text-[var(--danger)]">
                  {latestOutcome.resolution.summary}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--ink-muted)]">
              최근 압력 변화는 첫 상호작용 이후 여기에 표시된다.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="shrink-0 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
          논의 대상
        </label>
        <select
          value={selectedTargetId ?? ""}
          onChange={(event) => onTargetChange(event.target.value || null)}
          disabled={busy || resolution.resolved}
          className="w-[280px] rounded-[18px] border border-[var(--panel-border)] bg-white/25 px-4 py-3 text-sm outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <option value="">직접 타깃 없음</option>
          {targetOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="min-w-0 text-xs leading-5 text-[var(--ink-muted)]">
          일부 행동은 특정 인물을 타깃으로 잡을 때 더 강하게 작동한다.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)] items-stretch">
        <div className="flex h-full min-h-[560px] flex-col rounded-[24px] border border-[var(--panel-border)] bg-white/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              Conversation
            </p>
            <p className="text-xs text-[var(--ink-muted)]">{conversation.length} turns</p>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
            {conversation.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--panel-border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                아직 공개 발언이 없다. 첫 말을 건네 방 안의 압력을 움직여라.
              </div>
            ) : (
              conversation.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[85%] rounded-[22px] px-4 py-3 ${
                    message.speaker === "player"
                      ? "ml-auto bg-[var(--teal-soft)] text-[var(--teal)]"
                      : "bg-[var(--panel-strong)] text-foreground"
                  }`}
                >
                  <p className="text-sm leading-7">{message.text}</p>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-65">
                    {message.speaker === "player" ? "Player" : npc.persona.name} ·{" "}
                    {formatTimestampShort(message.timestamp)}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] bg-white/20 p-4">
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={placeholder}
              disabled={busy || resolution.resolved}
              aria-invalid={Boolean(draftWarning)}
              className={`min-h-[220px] w-full resize-none rounded-[20px] border px-4 py-3 text-sm leading-7 outline-none transition disabled:cursor-not-allowed disabled:opacity-55 ${
                draftWarning
                  ? "border-[var(--danger)] bg-rose-50/70 focus:border-[var(--danger)]"
                  : "border-[var(--panel-border)] bg-white/20 focus:border-[var(--accent)]"
              }`}
            />
            {draftWarning ? (
              <p className="mt-2 text-sm font-medium text-[var(--danger)]" role="alert">
                {draftWarning}
              </p>
            ) : null}
            <button
              type="button"
              onClick={onSubmit}
              disabled={busy || resolution.resolved}
              className="mt-3 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "반응 생성 중..." : "자유 발언"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {availableActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onAction(action.id)}
                disabled={busy || resolution.resolved}
                title={PLAYER_ACTION_DESCRIPTIONS[action.id]}
                className="rounded-[20px] border border-[var(--panel-border)] bg-white/20 px-4 py-3 text-left text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="block">{action.label}</span>
                <span className="mt-1 block text-xs font-normal leading-5 text-[var(--ink-muted)]">
                  {action.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
