import { useEffect, useState } from "react";
import { InteractionConversationThread } from "@/components/hub/interaction-conversation-thread";
import { InteractionControls } from "@/components/hub/interaction-controls";
import { InteractionGuideModal } from "@/components/hub/interaction-guide-modal";
import {
  buildInteractionTraceTurns,
  roundStatus,
} from "@/components/hub/interaction-panel-formatters";
import type {
  InteractionPanelProps,
  PlayInputMode,
} from "@/components/hub/interaction-panel-types";
import { InteractionTraceModal } from "@/components/hub/interaction-trace-modal";
import { TurnOutcomeStrip } from "@/components/hub/turn-outcome-strip";
import { Panel } from "@/components/ui/panel";
import type { PlayerAction } from "@/lib/types";

export function InteractionPanel({
  npc,
  conversation,
  draft,
  busy,
  waitingForReply,
  pendingReplyStartedAtMs,
  replyElapsedByMessageId,
  subtitle,
  placeholder,
  availableActions,
  targetOptions,
  selectedTargetId,
  round,
  resolution,
  lastOutcome,
  conversationDebugEnabled,
  draftWarning,
  onDraftChange,
  onTargetChange,
  onSubmit,
  onAction,
}: InteractionPanelProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [traceModalOpen, setTraceModalOpen] = useState(false);
  const [playInputMode, setPlayInputMode] = useState<PlayInputMode>("intent_only");
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [localWarning, setLocalWarning] = useState<string | null>(null);
  const [loadingDotCount, setLoadingDotCount] = useState(1);
  const [waitingElapsedMs, setWaitingElapsedMs] = useState(0);

  const selectedTargetLabel =
    targetOptions.find((option) => option.id === selectedTargetId)?.label ?? null;
  const isDraftConfirmed =
    playInputMode === "combined" && draftConfirmed && draft.trim().length > 0;
  const showDirectInputCard = playInputMode !== "intent_only";
  const showIntentCard = playInputMode !== "free_text";
  const inputModeDisabled = busy || resolution.resolved;
  const directInputDisabled = busy || resolution.resolved || !showDirectInputCard;
  const actionButtonsDisabled = busy || resolution.resolved || !showIntentCard;
  const submitButtonLabel = playInputMode === "combined" ? "확정" : "말하기";
  const submitButtonClassName = isDraftConfirmed
    ? "bg-[var(--teal)] hover:brightness-105"
    : "bg-[var(--accent)] hover:brightness-105";
  const activeWarning = localWarning ?? draftWarning;
  const loadingLabel = `답변중${".".repeat(loadingDotCount)}`;
  const traceTurns = buildInteractionTraceTurns(conversation, replyElapsedByMessageId);
  const conversationCardClassName =
    playInputMode === "combined"
      ? "flex h-[820px] min-h-0 flex-col overflow-hidden rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4"
      : "flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4";

  useEffect(() => {
    if (!waitingForReply) {
      setLoadingDotCount(1);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setLoadingDotCount((current) => (current >= 5 ? 1 : current + 1));
    }, 420);

    return () => window.clearInterval(intervalId);
  }, [waitingForReply]);

  useEffect(() => {
    if (!waitingForReply || pendingReplyStartedAtMs === null) {
      setWaitingElapsedMs(0);
      return undefined;
    }

    const updateElapsed = () => {
      setWaitingElapsedMs(Date.now() - pendingReplyStartedAtMs);
    };

    updateElapsed();

    const intervalId = window.setInterval(() => {
      updateElapsed();
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [pendingReplyStartedAtMs, waitingForReply]);

  function handleDraftValueChange(value: string) {
    setDraftConfirmed(false);
    setLocalWarning(null);
    onDraftChange(value);
  }

  function handlePlayInputModeChange(nextMode: PlayInputMode) {
    setPlayInputMode(nextMode);
    setDraftConfirmed(false);
    setLocalWarning(null);
  }

  function handleActionClick(action: PlayerAction) {
    if (playInputMode === "combined") {
      if (!draft.trim() || !isDraftConfirmed) {
        setLocalWarning("대화를 입력하고 확정해주세요");
        return;
      }
    }

    setLocalWarning(null);
    onAction(action, playInputMode === "combined" ? "combined" : "action");
  }

  function handleSubmitClick() {
    if (playInputMode === "combined") {
      if (!draft.trim()) {
        setLocalWarning("발언 내용을 입력하세요");
        return;
      }

      setDraftConfirmed(true);
      setLocalWarning(null);
      return;
    }

    setLocalWarning(null);
    onSubmit();
  }

  return (
    <>
      <InteractionGuideModal
        open={guideOpen}
        speakerName={npc.persona.name}
        targetLabel={selectedTargetLabel}
        onClose={() => setGuideOpen(false)}
      />
      <InteractionTraceModal
        open={traceModalOpen}
        turns={traceTurns}
        onClose={() => setTraceModalOpen(false)}
      />

      <Panel
        eyebrow="플레이"
        eyebrowTrailing={
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="rounded-full border border-[var(--panel-border)] bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-normal text-foreground transition hover:border-[var(--teal)] hover:bg-white/18"
          >
            가이드 보기
          </button>
        }
        title={`${npc.persona.name}에게 말을 건네기`}
        subtitle={subtitle}
        className="play-session-card"
        contentClassName="space-y-4"
      >
        <div className="grid gap-3 grid-cols-2">
          <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
              지금 상황
            </p>
            <p className="text-sm leading-7 text-foreground">{roundStatus(round)}</p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              현재 {npc.persona.role} {npc.persona.name}을 설득 중이다.
            </p>
            <p className="text-sm leading-7 text-[var(--ink-muted)]">
              {round.currentRound}/{round.maxRounds} 라운드 · 최소 확정 라운드{" "}
              {round.minRoundsBeforeResolution}
            </p>
          </div>

          <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
              이번 턴 목표
            </p>
            <p className="text-sm leading-7 text-foreground">
              {selectedTargetLabel
                ? `${selectedTargetLabel} 쪽으로 시선을 조금 더 몰아가라.`
                : "먼저 누구를 흔들지 정하고, 아래 행동 버튼으로 첫 압력을 만든다."}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              {round.rescueEtaLabel}
            </p>
            <p className="text-sm leading-7 text-[var(--ink-muted)]">
              {round.facilityStatus}
            </p>
            {resolution.resolved ? (
              <p className="mt-3 rounded-2xl bg-[rgba(120,32,33,0.1)] px-4 py-3 text-sm text-[var(--danger)]">
                {resolution.summary}
              </p>
            ) : null}
          </div>
        </div>

        {lastOutcome ? <TurnOutcomeStrip outcome={lastOutcome} /> : null}

        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
                이번에 흔들 사람
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                타깃이 필요한 행동은 여기서 고른 사람 쪽으로 압력을 더 민다.
              </p>
            </div>
            <select
              value={selectedTargetId ?? ""}
              onChange={(event) => onTargetChange(event.target.value || null)}
              disabled={busy || resolution.resolved}
              className="w-[320px] rounded-[18px] border border-[var(--panel-border)] bg-white/18 px-4 py-3 text-sm outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <option value="">직접 흔들 사람 없음</option>
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-stretch">
          <InteractionConversationThread
            npc={npc}
            conversation={conversation}
            waitingForReply={waitingForReply}
            waitingElapsedMs={waitingElapsedMs}
            loadingLabel={loadingLabel}
            conversationDebugEnabled={conversationDebugEnabled}
            replyElapsedByMessageId={replyElapsedByMessageId}
            conversationCardClassName={conversationCardClassName}
            onOpenTrace={() => setTraceModalOpen(true)}
          />

          <InteractionControls
            playInputMode={playInputMode}
            inputModeDisabled={inputModeDisabled}
            draft={draft}
            placeholder={placeholder}
            directInputDisabled={directInputDisabled}
            activeWarning={activeWarning}
            submitButtonClassName={submitButtonClassName}
            submitButtonLabel={submitButtonLabel}
            busy={busy}
            showDirectInputCard={showDirectInputCard}
            showIntentCard={showIntentCard}
            actionButtonsDisabled={actionButtonsDisabled}
            availableActions={availableActions}
            onPlayInputModeChange={handlePlayInputModeChange}
            onDraftValueChange={handleDraftValueChange}
            onSubmitClick={handleSubmitClick}
            onActionClick={handleActionClick}
          />
        </div>
      </Panel>
    </>
  );
}

