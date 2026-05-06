import { useEffect, useRef } from "react";
import { sourceVersion } from "virtual:npc-simulator-source-version";
import {
  formatConversationTimestamp,
  formatElapsedDuration,
  formatFailureDebugStage,
  formatReplyRewriteReason,
  formatReplyRewriteSource,
  buildVllmRewriteDiagnostics,
  SHOW_INTERACTION_FAILURE_DEBUG,
} from "@/components/hub/interaction-panel-formatters";
import type {
  ConversationMessage,
  FailureDebugEntry,
} from "@/components/hub/interaction-panel-types";
import type { NpcState } from "@/lib/types";
import { VllmRewriteDiagnosticsCard } from "@/components/hub/vllm-rewrite-diagnostics-card";

export function InteractionConversationThread({
  npc,
  conversation,
  waitingForReply,
  waitingElapsedMs,
  loadingLabel,
  conversationDebugEnabled,
  replyElapsedByMessageId,
  conversationCardClassName,
  onOpenTrace,
  onToggleConversationDebug,
}: {
  npc: NpcState;
  conversation: ConversationMessage[];
  waitingForReply: boolean;
  waitingElapsedMs: number;
  loadingLabel: string;
  conversationDebugEnabled: boolean;
  replyElapsedByMessageId: Record<string, number>;
  conversationCardClassName: string;
  onOpenTrace: () => void;
  onToggleConversationDebug: () => void;
}) {
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);

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
  }, [
    conversation.length,
    conversationDebugEnabled,
    loadingLabel,
    npc.persona.id,
    waitingForReply,
  ]);

  return (
    <div className={conversationCardClassName}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              방 안 대화
            </p>
            <span
              aria-label={`대화 UI 버전 ${sourceVersion}`}
              title="소스 변경 기준 대화 UI 버전"
              className="rounded-full border border-[var(--panel-border)] bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--ink-muted)]"
            >
              {sourceVersion}
            </span>
            {conversationDebugEnabled ? (
              <button
                type="button"
                onClick={onOpenTrace}
                className="rounded-full border border-[var(--panel-border)] bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--ink-muted)] transition hover:border-[var(--teal)] hover:bg-white/18"
              >
                처리 기록
              </button>
            ) : null}
            <button
              type="button"
              aria-pressed={conversationDebugEnabled}
              onClick={onToggleConversationDebug}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] transition ${
                conversationDebugEnabled
                  ? "border-[var(--teal)] bg-[var(--teal)] text-white hover:brightness-105"
                  : "border-[var(--panel-border)] bg-white/10 text-[var(--ink-muted)] hover:border-[var(--teal)] hover:bg-white/18"
              }`}
            >
              대화창 디버그 {conversationDebugEnabled ? "On" : "Off"}
            </button>
          </div>
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
            {conversation.map((message) => (
              <InteractionMessageCard
                key={message.id}
                message={message}
                npcName={npc.persona.name}
                conversationDebugEnabled={conversationDebugEnabled}
                replyElapsedMs={replyElapsedByMessageId[message.id]}
              />
            ))}
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
  );
}

function InteractionMessageCard({
  message,
  npcName,
  conversationDebugEnabled,
  replyElapsedMs,
}: {
  message: ConversationMessage;
  npcName: string;
  conversationDebugEnabled: boolean;
  replyElapsedMs: number | undefined;
}) {
  const replyRewriteLabel =
    message.speaker === "npc"
      ? formatReplyRewriteSource(message.replyRewriteSource)
      : null;
  const replyRewriteReason =
    message.speaker === "npc"
      ? formatReplyRewriteReason(message.replyRewriteReason)
      : null;
  const failureDebugEntries: FailureDebugEntry[] =
    message.speaker === "npc" ? message.failureDebug ?? [] : [];
  const traceEntries = message.speaker === "npc" ? message.interactionTrace ?? [] : [];
  const vllmDiagnostics =
    message.speaker === "npc"
      ? buildVllmRewriteDiagnostics({
          traceEntries,
          failureDebugEntries,
          replyRewriteSource: message.replyRewriteSource,
        })
      : null;
  const failed = message.deliveryStatus === "failed";

  return (
    <article
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
          {message.speaker === "player" ? "당신" : npcName} ·{" "}
          {formatConversationTimestamp(message.timestamp)}
          {message.speaker === "npc" && replyElapsedMs !== undefined
            ? ` · 응답 ${formatElapsedDuration(replyElapsedMs)}`
            : ""}
          {conversationDebugEnabled && replyRewriteLabel ? ` · ${replyRewriteLabel}` : ""}
        </p>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {failed ? (
            <span className="rounded-full bg-[rgba(181,43,48,0.18)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--danger)]">
              생성 실패
            </span>
          ) : null}
          {conversationDebugEnabled && message.speaker === "npc" && message.fallbackUsed ? (
            <span className="rounded-full bg-[rgba(181,43,48,0.18)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--danger)]">
              fallback
            </span>
          ) : null}
        </div>
      </div>
      {conversationDebugEnabled && vllmDiagnostics ? (
        <VllmRewriteDiagnosticsCard diagnostics={vllmDiagnostics} />
      ) : null}
      {conversationDebugEnabled && replyRewriteReason ? (
        <p className="mt-2 text-[11px] leading-5 text-[var(--danger)]">
          탈락 사유: {replyRewriteReason}
        </p>
      ) : null}
      {conversationDebugEnabled &&
      SHOW_INTERACTION_FAILURE_DEBUG &&
      failureDebugEntries.length > 0 ? (
        <div className="mt-2 space-y-2 rounded-2xl border border-[rgba(181,43,48,0.24)] bg-[rgba(181,43,48,0.08)] px-3 py-3 text-[11px] leading-5 text-[var(--danger)]">
          {failureDebugEntries.map((entry: FailureDebugEntry, index: number) => (
            <div key={`${message.id}-failure-debug-${index}`} className="space-y-1">
              <p className="font-semibold">
                디버그 ·{" "}
                {formatFailureDebugStage({
                  entry,
                  replyRewriteReason,
                })}
                {entry.sourceRef ? ` · ${entry.sourceRef}` : ""}
              </p>
              <p>원인: {entry.summary}</p>
              {entry.candidateReplyText ? <p>실패 reply: {entry.candidateReplyText}</p> : null}
              {entry.candidateSelectedActionType ? (
                <p>
                  실패 action: {entry.candidateSelectedActionType}
                  {entry.candidateSelectedActionReason
                    ? ` · ${entry.candidateSelectedActionReason}`
                    : ""}
                </p>
              ) : null}
              {entry.candidateTargetNpcId ? <p>실패 target: {entry.candidateTargetNpcId}</p> : null}
              {entry.candidateImpactTags?.length ? (
                <p>실패 tags: {entry.candidateImpactTags.join(", ")}</p>
              ) : null}
              {entry.issues?.length ? <p>세부: {entry.issues.join(" / ")}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
