import { useEffect } from "react";
import {
  formatConversationTimestamp,
  formatJudgeBoolean,
  formatTraceDuration,
  formatTraceStatus,
} from "@/components/hub/interaction-panel-formatters";
import type { InteractionTraceTurn } from "@/components/hub/interaction-panel-types";
import { Panel } from "@/components/ui/panel";

export function InteractionTraceModal({
  open,
  turns,
  onClose,
}: {
  open: boolean;
  turns: InteractionTraceTurn[];
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
        aria-label="처리 기록 닫기"
        onClick={onClose}
        className="absolute inset-0"
      />

      <Panel
        eyebrow="디버그"
        title="턴 처리 기록"
        subtitle="각 NPC 답변마다 어느 단계가 얼마나 걸렸는지 본다."
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-[1120px] flex-col overflow-hidden md:max-h-[86vh]"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
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
        <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-2">
          {turns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--panel-border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              아직 기록된 대화가 없다.
            </div>
          ) : (
            turns.map((turn) => {
              const slowestStage =
                turn.traceEntries
                  .filter((entry) => entry.stage !== "turn_total")
                  .sort((left, right) => right.durationMs - left.durationMs)[0] ?? null;

              return (
                <article
                  key={`${turn.npcMessage.id}-trace`}
                  className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
                        {formatConversationTimestamp(turn.npcMessage.timestamp)}
                      </p>
                      {turn.playerMessage ? (
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                          당신: {turn.playerMessage.text}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm leading-7 text-foreground">
                        {turn.npcMessage.text}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-[var(--ink-muted)]">
                      {turn.frontendElapsedMs !== null ? (
                        <p>프론트 총 응답 {formatTraceDuration(turn.frontendElapsedMs)}</p>
                      ) : null}
                      {slowestStage ? (
                        <p>
                          최장 단계 {slowestStage.label} ·{" "}
                          {formatTraceDuration(slowestStage.durationMs)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {turn.npcMessage.replyJudge ? (
                    <div className="mt-3 rounded-2xl border border-[var(--panel-border)] bg-[rgba(76,194,200,0.08)] px-3 py-3 text-[12px] leading-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-foreground">LLM Judge</p>
                        <p className="text-[var(--ink-muted)]">
                          {turn.npcMessage.replyJudge.sourceRef ?? "judge"} ·{" "}
                          {turn.npcMessage.replyJudge.durationMs !== null
                            ? formatTraceDuration(turn.npcMessage.replyJudge.durationMs)
                            : "n/a"}
                        </p>
                      </div>
                      <p className="mt-1 break-words text-[var(--ink-muted)]">
                        status={turn.npcMessage.replyJudge.status} · aligned=
                        {formatJudgeBoolean(turn.npcMessage.replyJudge.aligned)} · target=
                        {formatJudgeBoolean(turn.npcMessage.replyJudge.targetMaintained)} · fatal=
                        {formatJudgeBoolean(turn.npcMessage.replyJudge.fatalMismatch)}
                        {turn.npcMessage.replyJudge.confidence !== null
                          ? ` · confidence=${turn.npcMessage.replyJudge.confidence}`
                          : ""}
                      </p>
                      {turn.npcMessage.replyJudge.reason ? (
                        <p className="mt-1 break-words text-[var(--ink-muted)]">
                          {turn.npcMessage.replyJudge.reason}
                        </p>
                      ) : null}
                      {turn.npcMessage.replyJudge.error ? (
                        <p className="mt-1 break-words text-[var(--danger)]">
                          {turn.npcMessage.replyJudge.error}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {turn.traceEntries.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--ink-muted)]">
                      이 턴에는 단계 기록이 없다.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {turn.traceEntries.map((entry, index) => (
                        <div
                          key={`${turn.npcMessage.id}-trace-stage-${index}`}
                          className="grid grid-cols-[minmax(0,1.6fr)_84px_96px_minmax(0,2fr)] gap-3 rounded-2xl border border-[var(--panel-border)] bg-[rgba(255,255,255,0.04)] px-3 py-3 text-[12px] leading-5"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{entry.label}</p>
                            <p className="text-[var(--ink-muted)]">{entry.stage}</p>
                          </div>
                          <div>
                            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                              {formatTraceStatus(entry.status)}
                            </span>
                          </div>
                          <div className="text-right font-semibold text-foreground">
                            {formatTraceDuration(entry.durationMs)}
                          </div>
                          <div className="min-w-0 break-words text-[var(--ink-muted)]">
                            <p>
                              +{formatTraceDuration(entry.startedAtMs)} ~ +
                              {formatTraceDuration(entry.finishedAtMs)}
                            </p>
                            {entry.detail ? <p className="mt-1">{entry.detail}</p> : null}
                            {entry.sourceRef ? <p className="mt-1">{entry.sourceRef}</p> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

