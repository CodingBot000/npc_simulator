import { useEffect, useRef, useState } from "react";
import type {
  AvailableActionDefinition,
  ChatMessage,
  InteractionResponsePayload,
  NpcState,
  PlayerAction,
  ResolutionState,
  RoundState,
} from "@/lib/types";
import { TurnOutcomeStrip } from "@/components/hub/turn-outcome-strip";
import { Panel } from "@/components/ui/panel";

interface InteractionPanelProps {
  npc: NpcState;
  conversation: ConversationMessage[];
  draft: string;
  busy: boolean;
  waitingForReply: boolean;
  pendingReplyStartedAtMs: number | null;
  replyElapsedByMessageId: Record<string, number>;
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
  onAction: (action: PlayerAction, inputMode: "action" | "combined") => void;
}

type PlayInputMode = "intent_only" | "free_text" | "combined";
type ConversationMessage = ChatMessage & {
  deliveryStatus?: "failed";
};

function roundStatus(round: RoundState) {
  if (round.currentRound === 0) {
    return "아직 첫 턴 전이다. 지금 시작하는 한 마디가 첫 압력 이동이 된다.";
  }

  if (round.currentRound < round.minRoundsBeforeResolution) {
    return `지금은 ${round.currentRound}라운드다. 결말 전까지 아직 흔들 여지가 남아 있다.`;
  }

  return `지금은 ${round.currentRound}라운드다. 이제 판세가 굳으면 바로 결말이 날 수 있다.`;
}

function formatConversationTimestamp(timestamp: string) {
  const source = new Date(timestamp);

  if (Number.isNaN(source.getTime())) {
    return "--.-- --:--:--";
  }

  const kst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const hour = String(kst.getUTCHours()).padStart(2, "0");
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const second = String(kst.getUTCSeconds()).padStart(2, "0");

  return `${month}.${day} ${hour}:${minute}:${second}`;
}

function formatElapsedDuration(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}분 ${String(seconds).padStart(2, "0")}초`;
  }

  return `${totalSeconds}초`;
}

function formatReplyRewriteSource(source: string | null | undefined) {
  const normalized = source?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("llama")) {
    return "llama";
  }

  if (normalized.includes("qwen")) {
    return "qwen";
  }

  if (/gpt[-_]?5\.4/u.test(normalized)) {
    return "gpt5.4";
  }

  if (/gpt[-_\w.]*nano/u.test(normalized)) {
    return "gpt-nano";
  }

  if (/gpt[-_\w.]*mini/u.test(normalized)) {
    return "gpt-mini";
  }

  const gptVersion = normalized.match(/gpt[-_]?(\d+(?:\.\d+)?)/u);
  if (gptVersion) {
    return `gpt${gptVersion[1]}`;
  }

  return null;
}

function GuideAlertModal({
  open,
  speakerName,
  targetLabel,
  onClose,
}: {
  open: boolean;
  speakerName: string;
  targetLabel: string | null;
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
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-[rgba(3,10,17,0.78)] p-8 backdrop-blur-sm">
      <button
        type="button"
        aria-label="가이드 닫기"
        onClick={onClose}
        className="absolute inset-0"
      />

      <Panel
        eyebrow="가이드"
        title="이렇게 시작하면 된다"
        subtitle="첫 턴을 열 때 필요한 순서를 여기서만 짧게 확인하면 된다."
        className="relative z-10 flex w-full max-w-[720px] flex-col"
        trailing={
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--panel-border)] bg-white/12 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/18"
          >
            닫기
          </button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              1. 먼저 말 걸 사람
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              지금은 {speakerName}의 입에서 다른 사람 이름이 나오게 만드는 턴이다.
            </p>
          </article>

          <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              2. 이번에 흔들 사람
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              {targetLabel
                ? `${targetLabel} 쪽으로 시선을 모으도록 아래 행동을 고른다.`
                : "드롭다운에서 먼저 흔들 사람을 하나 고른다."}
            </p>
          </article>

          <article className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              3. 버튼 하나로 시작
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-muted)]">
              글을 길게 쓰지 않아도 된다. 빠른 행동 버튼 하나로도 첫 턴이 열린다.
            </p>
          </article>
        </div>
      </Panel>
    </div>
  );
}

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
  draftWarning,
  onDraftChange,
  onTargetChange,
  onSubmit,
  onAction,
}: InteractionPanelProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [playInputMode, setPlayInputMode] = useState<PlayInputMode>("intent_only");
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [localWarning, setLocalWarning] = useState<string | null>(null);
  const [loadingDotCount, setLoadingDotCount] = useState(1);
  const [waitingElapsedMs, setWaitingElapsedMs] = useState(0);
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const selectedTargetLabel =
    targetOptions.find((option) => option.id === selectedTargetId)?.label ?? null;
  const isDraftConfirmed =
    playInputMode === "combined" && draftConfirmed && draft.trim().length > 0;
  const showDirectInputCard = playInputMode !== "intent_only";
  const showIntentCard = playInputMode !== "free_text";
  const inputModeDisabled = busy || resolution.resolved;
  const directInputDisabled = busy || resolution.resolved || !showDirectInputCard;
  const actionButtonsDisabled =
    busy || resolution.resolved || !showIntentCard;
  const submitButtonLabel =
    playInputMode === "combined" ? "확정" : "말하기";
  const submitButtonClassName =
    isDraftConfirmed
      ? "bg-[var(--teal)] hover:brightness-105"
      : "bg-[var(--accent)] hover:brightness-105";
  const activeWarning = localWarning ?? draftWarning;
  const loadingLabel = `답변중${".".repeat(loadingDotCount)}`;
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

  useEffect(() => {
    const viewport = conversationViewportRef.current;

    if (!viewport) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (viewport.scrollHeight > viewport.clientHeight) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [conversation.length, loadingDotCount, npc.persona.id, waitingForReply]);

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

  function actionBadgeLabel(action: AvailableActionDefinition) {
    if (action.requiresTarget) {
      return "타겟 필수";
    }

    if (action.id === "appeal") {
      return "타겟유무선택";
    }

    return null;
  }

  return (
    <>
      <GuideAlertModal
        open={guideOpen}
        speakerName={npc.persona.name}
        targetLabel={selectedTargetLabel}
        onClose={() => setGuideOpen(false)}
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
            {round.currentRound}/{round.maxRounds} 라운드 · 최소 확정 라운드 {round.minRoundsBeforeResolution}
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
          <p className="text-sm leading-7 text-[var(--ink-muted)]">{round.facilityStatus}</p>
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
          <div className={conversationCardClassName}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
                  방 안 대화
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                  방금 누구에게 뭐라고 했는지와 돌아온 말을 여기서 읽는다.
                </p>
              </div>
              <p className="text-xs text-[var(--ink-muted)]">{conversation.length}개의 발화</p>
            </div>

            <div
              ref={conversationViewportRef}
              className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-2"
            >
              {conversation.length === 0 && !waitingForReply ? (
                <div className="rounded-2xl border border-dashed border-[var(--panel-border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                  아직 공개 발언이 없다. 아래 빠른 행동이나 직접 발언으로 첫 턴을 열어라.
                </div>
              ) : (
                <>
                  {conversation.map((message) => {
                    const replyRewriteLabel =
                      message.speaker === "npc"
                        ? formatReplyRewriteSource(message.replyRewriteSource)
                        : null;
                    const failed = message.deliveryStatus === "failed";

                    return (
                      <article
                        key={message.id}
                        className={`max-w-[85%] rounded-[22px] px-4 py-3 ${
                          message.speaker === "player"
                            ? "ml-auto bg-[var(--teal-soft)] text-[var(--teal)]"
                            : failed
                              ? "bg-rose-100/80 text-[var(--danger)]"
                              : "bg-[var(--panel-strong)] text-foreground"
                        }`}
                      >
                        <p className="text-sm leading-7">{message.text}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                          <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-65">
                            {message.speaker === "player" ? "당신" : npc.persona.name} ·{" "}
                            {formatConversationTimestamp(message.timestamp)}
                            {message.speaker === "npc" &&
                            replyElapsedByMessageId[message.id] !== undefined
                              ? ` · 응답 ${formatElapsedDuration(replyElapsedByMessageId[message.id])}`
                              : ""}
                          </p>
                          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            {failed ? (
                              <span className="rounded-full bg-[rgba(181,43,48,0.18)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--danger)]">
                                생성 실패
                              </span>
                            ) : null}
                            {message.speaker === "npc" && message.fallbackUsed ? (
                              <span className="rounded-full bg-[rgba(181,43,48,0.18)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--danger)]">
                                fallback
                              </span>
                            ) : null}
                            {replyRewriteLabel ? (
                              <span className="rounded-full bg-white/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                                {replyRewriteLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  {waitingForReply ? (
                    <article
                      aria-live="polite"
                      aria-atomic="true"
                      className="max-w-[85%] rounded-[22px] bg-[var(--panel-strong)] px-4 py-3 text-foreground"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm leading-7">{loadingLabel}</p>
                        <p className="ml-auto text-right text-[11px] font-semibold tabular-nums opacity-65">
                          {formatElapsedDuration(waitingElapsedMs)}
                        </p>
                      </div>
                    </article>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
                입력 방식
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
                <label
                  className={`flex items-center gap-2 ${
                    inputModeDisabled ? "cursor-not-allowed opacity-55" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="play-input-mode"
                    checked={playInputMode === "intent_only"}
                    onChange={() => handlePlayInputModeChange("intent_only")}
                    disabled={inputModeDisabled}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span>의도만 전달</span>
                </label>
                <label
                  className={`flex items-center gap-2 ${
                    inputModeDisabled ? "cursor-not-allowed opacity-55" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="play-input-mode"
                    checked={playInputMode === "free_text"}
                    onChange={() => handlePlayInputModeChange("free_text")}
                    disabled={inputModeDisabled}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span>자유입력</span>
                </label>
                <label
                  className={`flex items-center gap-2 ${
                    inputModeDisabled ? "cursor-not-allowed opacity-55" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="play-input-mode"
                    checked={playInputMode === "combined"}
                    onChange={() => handlePlayInputModeChange("combined")}
                    disabled={inputModeDisabled}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span>모두 사용</span>
                </label>
              </div>
            </div>

            {showDirectInputCard ? (
              <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
                    자유입력
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                    버튼으로 시작한 뒤, 필요하면 아래에 직접 한 문장을 더 얹는다.
                  </p>
                </div>

                <textarea
                  value={draft}
                  onChange={(event) => handleDraftValueChange(event.target.value)}
                  placeholder={placeholder}
                  disabled={directInputDisabled}
                  aria-invalid={Boolean(activeWarning)}
                  className={`min-h-[110px] w-full resize-none rounded-[20px] border px-4 py-3 text-sm leading-7 outline-none transition disabled:cursor-not-allowed disabled:opacity-55 ${
                    activeWarning
                      ? "border-[var(--danger)] bg-rose-50/70 focus:border-[var(--danger)]"
                      : "border-[var(--panel-border)] bg-white/18 focus:border-[var(--accent)]"
                  }`}
                />
                {activeWarning ? (
                  <p className="mt-2 text-sm font-medium text-[var(--danger)]" role="alert">
                    {activeWarning}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleSubmitClick}
                  disabled={directInputDisabled}
                  className={`mt-3 w-full rounded-full px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${submitButtonClassName}`}
                >
                  {busy ? "반응을 정리하는 중..." : submitButtonLabel}
                </button>
              </div>
            ) : null}

            {showIntentCard ? (
              <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
                    의도 전달
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                    버튼 하나로 먼저 밀고, 결과를 읽은 뒤 다음 턴을 정하면 된다.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {availableActions.map((action) => {
                    const badgeLabel = actionBadgeLabel(action);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleActionClick(action.id)}
                        disabled={actionButtonsDisabled}
                        className="flex h-full flex-col justify-start rounded-[20px] border border-[var(--panel-border)] bg-white/12 px-4 py-3 text-left align-top transition hover:border-[var(--teal)] hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="block text-sm font-semibold text-foreground">
                            {action.label}
                          </span>
                          {badgeLabel ? (
                            <span
                              className={`shrink-0 whitespace-nowrap text-[11px] font-medium ${
                                action.requiresTarget
                                  ? "text-[var(--danger)]"
                                  : "text-[var(--teal)]"
                              }`}
                            >
                              {badgeLabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block whitespace-normal break-keep text-[0.2rem] leading-[0.9rem] text-[var(--ink-muted)]">
                          {action.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

          </div>
        </div>
      </Panel>
    </>
  );
}
