import {
  useState,
  useTransition,
} from "react";
import { apiUpdateReviewDecision } from "@/lib/api-client";
import type {
  PairReviewItemView,
  ReviewCandidateView,
  ReviewDecisionRequest,
  ReviewKind,
  ReviewMutationResult,
  ReviewSourceMode,
  SftReviewItemView,
} from "@/lib/review-types";
import {
  CardSurface,
  SectionLabel,
  TagRow,
  TextBlock,
} from "./review-dashboard-primitives";
import { formatTimestamp } from "./review-formatters";
import {
  PAIR_DECISIONS,
  SFT_DECISIONS,
  decisionLabel,
  decisionTone,
  isSftItem,
  type ReviewItem,
} from "./review-item-model";

function CandidateCompactBlock({
  label,
  candidate,
  tone,
}: {
  label: string;
  candidate: ReviewCandidateView;
  tone: string;
}) {
  return (
    <div className={`rounded-[24px] border px-4 py-4 ${tone}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/90">
          {label}
        </p>
        <span className="rounded-full bg-black/20 px-2.5 py-1 text-[11px] text-foreground/80">
          action {candidate.selectedAction ?? "없음"}
        </span>
      </div>

      <p className="text-sm leading-7 text-foreground/95">{candidate.replyText}</p>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            impact tags
          </p>
          <TagRow values={candidate.impactTags} />
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          target: {candidate.targetNpcId ?? "없음"}
        </p>
      </div>
    </div>
  );
}

function DecisionHelp({ kind }: { kind: ReviewKind }) {
  const lines =
    kind === "sft"
      ? [
          ["include", "이 응답을 학습에 넣는다"],
          ["exclude", "이 응답을 학습에서 뺀다"],
          ["escalate", "지금 확정하지 않고 보류한다"],
        ]
      : [
          ["include", "chosen / rejected 순서가 맞다"],
          ["flip", "rejected 쪽이 더 낫다"],
          ["exclude", "pair 자체를 버린다"],
          ["escalate", "지금 확정하지 않고 보류한다"],
        ];

  return (
    <div className="flex flex-wrap gap-2">
      {lines.map(([decision, description]) => (
        <div
          key={decision}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs"
        >
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${decisionTone(
              decision as ReviewItem["decision"],
            )}`}
          >
            {decisionLabel(decision as ReviewItem["decision"])}
          </span>
          <span className="text-[var(--ink-muted)]">{description}</span>
        </div>
      ))}
    </div>
  );
}

function llmStatusLabel(item: ReviewItem) {
  const llm = item.llmFirstPass;
  if (!llm) {
    return "없음";
  }

  return decisionLabel(llm.suggestedDecision);
}

export function CompactReviewCard({
  item,
  reviewer,
  sourceMode,
  readOnly,
  writeDisabledMessage,
  onItemSaved,
}: {
  item: ReviewItem;
  reviewer: string;
  sourceMode: ReviewSourceMode;
  readOnly: boolean;
  writeDisabledMessage?: string | null;
  onItemSaved?: (item: ReviewItem) => void;
}) {
  const [draftDecision, setDraftDecision] = useState<ReviewItem["decision"]>(
    item.decision ?? null,
  );
  const [draftNotes, setDraftNotes] = useState(item.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decisionOptions =
    item.kind === "sft" ? SFT_DECISIONS : PAIR_DECISIONS;
  const llm = item.llmFirstPass;

  function handleSave() {
    if (!onItemSaved) {
      return;
    }

    startTransition(async () => {
      setMessage(null);
      const requestBody: ReviewDecisionRequest =
        item.kind === "sft"
          ? {
              kind: "sft",
              reviewId: item.reviewId,
              decision: draftDecision as SftReviewItemView["decision"],
              reviewer,
              notes: draftNotes,
            }
          : {
              kind: "pair",
              reviewId: item.reviewId,
              decision: draftDecision as PairReviewItemView["decision"],
              reviewer,
              notes: draftNotes,
            };

      try {
        const payload: ReviewMutationResult = await apiUpdateReviewDecision(
          requestBody,
        );
        onItemSaved(payload.item);
        setMessage("저장됨");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
      }
    });
  }

  return (
    <CardSurface>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
            {item.kind === "sft" ? "SFT" : "Pair / DPO"}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">
            {item.prompt.npcId} / turn {item.prompt.turnIndex ?? "-"}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            target {item.prompt.targetNpcId ?? "없음"} · {item.prompt.scenarioId}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sourceMode === "llm_completed" ? (
            <>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                LLM {llm?.provider ?? "unknown"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
                  llm?.suggestedDecision ?? null,
                )}`}
              >
                추천: {llmStatusLabel(item)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                confidence {llm?.confidence ?? "-"}
              </span>
            </>
          ) : sourceMode === "human_reviewed" ? (
            <>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                reviewer {item.reviewer ?? "없음"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
                  item.decision,
                )}`}
              >
                사람 검수: {decisionLabel(item.decision)}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              reviewer {reviewer || "미입력"}
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
              sourceMode === "llm_completed" ? llm?.suggestedDecision ?? null : item.decision,
            )}`}
          >
            {sourceMode === "llm_completed" ? "LLM 판단" : "저장됨"}:{" "}
            {sourceMode === "llm_completed"
              ? llmStatusLabel(item)
              : decisionLabel(item.decision)}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <SectionLabel>Player Input</SectionLabel>
          <TextBlock>{item.prompt.playerText}</TextBlock>
        </div>

        {isSftItem(item) ? (
          <div className="space-y-4">
            <div>
              <SectionLabel>Reply</SectionLabel>
              <TextBlock>{item.candidate.replyText}</TextBlock>
            </div>

            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <TextBlock>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  selected action
                </p>
                <p className="mt-2 text-base font-semibold text-foreground">
                  {item.candidate.selectedAction ?? "없음"}
                </p>
              </TextBlock>

              <TextBlock>
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  structured impact
                </p>
                <TagRow values={item.candidate.impactTags} />
                <p className="mt-3 text-xs text-[var(--ink-muted)]">
                  target: {item.candidate.targetNpcId ?? "없음"}
                </p>
              </TextBlock>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <CandidateCompactBlock
              label="Chosen"
              candidate={item.chosen}
              tone="border-[rgba(74,166,124,0.28)] bg-[rgba(74,166,124,0.08)]"
            />
            <CandidateCompactBlock
              label="Rejected"
              candidate={item.rejected}
              tone="border-[rgba(214,90,90,0.28)] bg-[rgba(214,90,90,0.08)]"
            />
          </div>
        )}

        {sourceMode === "llm_completed" ? (
          <TextBlock>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              llm first pass
            </p>
            <p className="mt-2 text-sm text-foreground">
              추천 {llmStatusLabel(item)} / confidence {llm?.confidence ?? "-"}
              {llm?.preferenceStrength !== null &&
              llm?.preferenceStrength !== undefined
                ? ` / strength ${llm.preferenceStrength}`
                : ""}
            </p>
            <div className="mt-3">
              <TagRow values={llm?.reasons ?? []} emptyLabel="LLM 메모 없음" />
            </div>
          </TextBlock>
        ) : sourceMode === "human_reviewed" ? (
          <TextBlock>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              human review
            </p>
            <p className="mt-2 text-sm text-foreground">
              reviewer {item.reviewer ?? "없음"} / decision {decisionLabel(item.decision)}
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              reviewed at {formatTimestamp(item.reviewedAt)}
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              notes {item.notes || "없음"}
            </p>
          </TextBlock>
        ) : readOnly ? (
          <TextBlock>
            <p className="text-sm text-[var(--ink-muted)]">
              {writeDisabledMessage ?? "현재 조건에서는 검수 결정을 변경할 수 없습니다."}
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              저장된 판단: {decisionLabel(item.decision)} / 마지막 저장:{" "}
              {formatTimestamp(item.reviewedAt)}
            </p>
          </TextBlock>
        ) : (
          <>
            <div>
              <SectionLabel>Decision</SectionLabel>
              <DecisionHelp kind={item.kind} />
            </div>

            <div className="flex flex-wrap gap-2">
              {decisionOptions.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => setDraftDecision(decision)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    draftDecision === decision
                      ? "bg-[var(--accent)] text-white"
                      : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                  }`}
                >
                  {decisionLabel(decision)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDraftDecision(null)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  draftDecision === null
                    ? "bg-white/14 text-white"
                    : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                }`}
              >
                미정
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || !reviewer.trim()}
                className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {isPending ? "저장 중..." : "결정 저장"}
              </button>
              <p className="text-sm text-[var(--ink-muted)]">
                선택값: {decisionLabel(draftDecision)}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                마지막 저장: {formatTimestamp(item.reviewedAt)}
              </p>
              {message ? <p className="text-sm text-[var(--teal)]">{message}</p> : null}
            </div>
          </>
        )}

        <details className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            근거 / 메모 펼치기
          </summary>

          <div className="mt-4 space-y-4">
            {isSftItem(item) ? (
              <>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    action reason
                  </p>
                  <p className="mt-2">
                    {item.candidate.selectedActionReason || "설명 없음"}
                  </p>
                </TextBlock>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    impact rationale
                  </p>
                  <p className="mt-2">{item.candidate.rationale || "설명 없음"}</p>
                </TextBlock>
                {item.judge ? (
                  <TextBlock>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      judge summary
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      verdict {item.judge.verdict ?? "-"} / weighted {item.weightedJudgeScore ?? "-"}
                    </p>
                    <div className="mt-3">
                      <TagRow values={item.judge.reasons} emptyLabel="judge 메모 없음" />
                    </div>
                  </TextBlock>
                ) : null}
                {llm ? (
                  <TextBlock>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      llm recommendation
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      provider {llm.provider ?? "-"} / 추천 {llmStatusLabel(item)} / confidence{" "}
                      {llm.confidence ?? "-"}
                    </p>
                    <div className="mt-3">
                      <TagRow values={llm.reasons} emptyLabel="LLM 메모 없음" />
                    </div>
                  </TextBlock>
                ) : null}
              </>
            ) : (
              <>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    chosen rationale
                  </p>
                  <p className="mt-2">{item.chosen.rationale || "설명 없음"}</p>
                </TextBlock>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    rejected rationale
                  </p>
                  <p className="mt-2">{item.rejected.rationale || "설명 없음"}</p>
                </TextBlock>
                <TextBlock>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    pair hints
                  </p>
                  <TagRow values={item.pairReason} emptyLabel="pair 힌트 없음" />
                </TextBlock>
                {llm ? (
                  <TextBlock>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      llm recommendation
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      provider {llm.provider ?? "-"} / 추천 {llmStatusLabel(item)} / confidence{" "}
                      {llm.confidence ?? "-"} / strength {llm.preferenceStrength ?? "-"}
                    </p>
                    <div className="mt-3">
                      <TagRow values={llm.reasons} emptyLabel="LLM 메모 없음" />
                    </div>
                  </TextBlock>
                ) : null}
              </>
            )}

            <TextBlock>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                evidence snapshot
              </p>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    memories
                  </p>
                  <TagRow
                    values={item.prompt.retrievedMemorySummaries}
                    emptyLabel="기억 근거 없음"
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    knowledge
                  </p>
                  <TagRow
                    values={item.prompt.retrievedKnowledgeTitles}
                    emptyLabel="지식 근거 없음"
                  />
                </div>
              </div>
            </TextBlock>

            {readOnly ? null : (
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">notes</span>
                <textarea
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm leading-7 outline-none placeholder:text-[var(--ink-muted)]"
                  placeholder="필요하면 짧게 메모"
                />
              </label>
            )}

            <p className="text-sm text-[var(--ink-muted)]">
              기존 reviewer: {item.reviewer ?? "없음"} / 기존 decision: {decisionLabel(item.decision)}
            </p>
          </div>
        </details>
      </div>
    </CardSurface>
  );
}
