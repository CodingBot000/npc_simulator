"use client";

import { PLAYER_ACTION_LABELS } from "@/lib/constants";
import type {
  InteractionResponsePayload,
  PlayerAction,
  ChatMessage,
  NpcState,
} from "@/lib/types";
import { formatDelta, formatTimestampShort } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";

const actionOrder: PlayerAction[] = [
  "question",
  "persuade",
  "trade",
  "request",
  "empathize",
  "pressure",
];

export type InteractionInputCase =
  | "free_text_only"
  | "intent_only"
  | "draft_with_intent";

interface InteractionPanelProps {
  npc: NpcState;
  conversation: ChatMessage[];
  draft: string;
  busy: boolean;
  interactionCase: InteractionInputCase;
  lastOutcome: InteractionResponsePayload | null;
  draftWarning: string | null;
  onDraftChange: (value: string) => void;
  onInteractionCaseChange: (value: InteractionInputCase) => void;
  onSubmit: () => void;
  onAction: (action: PlayerAction) => void;
}

export function InteractionPanel({
  npc,
  conversation,
  draft,
  busy,
  interactionCase,
  lastOutcome,
  draftWarning,
  onDraftChange,
  onInteractionCaseChange,
  onSubmit,
  onAction,
}: InteractionPanelProps) {
  const latestOutcome =
    lastOutcome?.inspector.npcId === npc.persona.id ? lastOutcome : null;
  const showDraftInput = interactionCase !== "intent_only";
  const showSubmitButton = interactionCase === "free_text_only";
  const showActionButtons = interactionCase !== "free_text_only";
  const hasDraftWarning =
    interactionCase === "draft_with_intent" && Boolean(draftWarning);
  const caseOptions: Array<{
    value: InteractionInputCase;
    label: string;
    detail: string;
  }> = [
    {
      value: "free_text_only",
      label: "자유입력하기",
      detail: "자유입력 입력창과 입력 보내기 버튼만 사용합니다.",
    },
    {
      value: "intent_only",
      label: "의도만 전달하기",
      detail: "의도만 전달하는 선택 버튼만 사용합니다.",
    },
    {
      value: "draft_with_intent",
      label: "자유입력과 의도를 함께 전달하기",
      detail: "대사를 입력한 뒤 의도만 전달하는 선택 버튼을 함께 사용합니다.",
    },
  ];

  return (
    <Panel
      eyebrow="Interaction"
      title={`${npc.persona.name}와의 대화`}
      subtitle="자유 입력과 행동 버튼을 섞어서 반응 변화를 유도한다"
    >
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/55 p-4">
          <div className="scrollbar-thin max-h-[420px] space-y-3 overflow-y-auto pr-2">
            {conversation.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--panel-border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                아직 대화가 없다. 첫 질문이나 행동 버튼으로 흐름을 시작해라.
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
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">
              입력 방식 선택
            </legend>
            {caseOptions.map((item) => {
              const selected = interactionCase === item.value;

              return (
                <label
                  key={item.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-[20px] border px-4 py-3 transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]/55"
                      : "border-[var(--panel-border)] bg-white/60 hover:border-[var(--teal)] hover:bg-white"
                  } ${busy ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input
                    type="radio"
                    name="interaction-case"
                    checked={selected}
                    onChange={() => onInteractionCaseChange(item.value)}
                    disabled={busy}
                    className="mt-1 h-4 w-4 shrink-0"
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {item.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">
                      {item.detail}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {showDraftInput ? (
            <div className="rounded-[24px] bg-[var(--panel-strong)] p-4">
              <textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="예: 어제 말한 수상한 상인 얘기를 좀 더 자세히 들려줘."
                disabled={busy}
                aria-invalid={hasDraftWarning}
                className={`min-h-[146px] w-full resize-none rounded-[20px] border px-4 py-3 text-sm leading-7 outline-none transition disabled:cursor-not-allowed disabled:opacity-55 ${
                  hasDraftWarning
                    ? "border-[var(--danger)] bg-rose-50/70 focus:border-[var(--danger)]"
                    : "border-[var(--panel-border)] bg-white/70 focus:border-[var(--accent)]"
                }`}
              />
              {hasDraftWarning ? (
                <p className="mt-2 text-sm font-medium text-[var(--danger)]" role="alert">
                  {draftWarning}
                </p>
              ) : null}
              {showSubmitButton ? (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={busy}
                  className="mt-3 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "응답 생성 중..." : "자유 입력 보내기"}
                </button>
              ) : null}
            </div>
          ) : null}

          {showActionButtons ? (
            <div className="grid grid-cols-2 gap-2">
              {actionOrder.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => onAction(action)}
                  disabled={busy}
                  className="rounded-[20px] border border-[var(--panel-border)] bg-white/65 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {PLAYER_ACTION_LABELS[action]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/55 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
              Last Result
            </p>
            {latestOutcome ? (
              <div className="space-y-2 text-sm text-[var(--ink-muted)]">
                <p>
                  신뢰 {formatDelta(latestOutcome.relationshipDelta.trust)} / 친밀{" "}
                  {formatDelta(latestOutcome.relationshipDelta.affinity)} / 긴장{" "}
                  {formatDelta(latestOutcome.relationshipDelta.tension)}
                </p>
                <p>{latestOutcome.reply.text}</p>
                {latestOutcome.questUpdates.length > 0 ? (
                  <ul className="space-y-1">
                    {latestOutcome.questUpdates.map((update) => (
                      <li key={`${update.questId}-${update.to}`}>{update.note}</li>
                    ))}
                  </ul>
                ) : (
                  <p>이번 상호작용에서는 퀘스트 상태 변화가 아직 없다.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">
                최근 결과 요약은 첫 상호작용 이후 여기에 표시된다.
              </p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
