"use client";

import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { buildClientApiUrl } from "@/lib/api-client";
import type {
  PairReviewItemView,
  ReviewCandidateView,
  ReviewDashboardData,
  ReviewFinalizeStatusView,
  ReviewDatasetView,
  ReviewKind,
  ReviewSourceMode,
  SftReviewItemView,
} from "@/lib/review-types";

type ReviewItem = SftReviewItemView | PairReviewItemView;

const SFT_DECISIONS: Exclude<SftReviewItemView["decision"], null>[] = [
  "include",
  "exclude",
  "escalate",
];
const PAIR_DECISIONS: Exclude<PairReviewItemView["decision"], null>[] = [
  "include",
  "flip",
  "exclude",
  "escalate",
];

function isSftItem(item: ReviewItem): item is SftReviewItemView {
  return item.kind === "sft";
}

function decisionLabel(decision: ReviewItem["decision"]) {
  switch (decision) {
    case "include":
      return "포함";
    case "exclude":
      return "제외";
    case "escalate":
      return "보류";
    case "flip":
      return "뒤집기";
    default:
      return "미정";
  }
}

function decisionTone(decision: ReviewItem["decision"]) {
  switch (decision) {
    case "include":
      return "bg-[rgba(74,166,124,0.16)] text-[var(--success)]";
    case "exclude":
      return "bg-[rgba(214,90,90,0.16)] text-[var(--danger)]";
    case "flip":
      return "bg-[rgba(209,111,76,0.16)] text-[var(--accent)]";
    case "escalate":
      return "bg-[rgba(76,194,200,0.16)] text-[var(--teal)]";
    default:
      return "bg-white/6 text-[var(--ink-muted)]";
  }
}

function summarize(items: ReviewItem[]) {
  return items.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      if (item.status === "reviewed" || item.decision) {
        accumulator.reviewed += 1;
      } else {
        accumulator.pending += 1;
      }

      const key = item.decision ?? "undecided";
      accumulator.decisions[key] = (accumulator.decisions[key] ?? 0) + 1;
      return accumulator;
    },
    {
      total: 0,
      reviewed: 0,
      pending: 0,
      decisions: {} as Record<string, number>,
    },
  );
}

function totalCount(dataset: ReviewDatasetView) {
  return dataset.sftItems.length + dataset.pairItems.length;
}

function updateHumanItemInData(
  data: ReviewDashboardData,
  kind: ReviewKind,
  nextItem: ReviewItem,
): ReviewDashboardData {
  if (kind === "sft") {
    return {
      ...data,
      humanRequired: {
        ...data.humanRequired,
        sftItems: data.humanRequired.sftItems.map((item) =>
          item.reviewId === nextItem.reviewId ? (nextItem as SftReviewItemView) : item,
        ),
      },
    };
  }

  return {
    ...data,
    humanRequired: {
      ...data.humanRequired,
      pairItems: data.humanRequired.pairItems.map((item) =>
        item.reviewId === nextItem.reviewId ? (nextItem as PairReviewItemView) : item,
      ),
    },
  };
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "미기록";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}초`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
      {children}
    </p>
  );
}

function CardSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel-surface rounded-[28px] px-5 py-5 ${className}`}>
      {children}
    </section>
  );
}

function TextBlock({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm leading-7 text-foreground/95 ${className}`}
    >
      {children}
    </div>
  );
}

function TagRow({
  values,
  emptyLabel = "없음",
}: {
  values: string[];
  emptyLabel?: string;
}) {
  if (!values.length) {
    return <p className="text-sm text-[var(--ink-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-foreground/85"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

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

function CompactReviewCard({
  item,
  reviewer,
  readOnly,
  onItemSaved,
}: {
  item: ReviewItem;
  reviewer: string;
  readOnly: boolean;
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

      const response = await fetch(buildClientApiUrl("/api/review"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: item.kind,
          reviewId: item.reviewId,
          decision: draftDecision,
          reviewer,
          notes: draftNotes,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        setMessage(payload?.message ?? "저장하지 못했습니다.");
        return;
      }

      const payload = (await response.json()) as {
        kind: ReviewKind;
        item: ReviewItem;
      };
      onItemSaved(payload.item);
      setMessage("저장됨");
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
          {readOnly ? (
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
          ) : (
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              reviewer {reviewer || "미입력"}
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
              readOnly ? llm?.suggestedDecision ?? null : item.decision,
            )}`}
          >
            {readOnly ? "LLM 판단" : "저장됨"}:{" "}
            {readOnly ? llmStatusLabel(item) : decisionLabel(item.decision)}
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

        {readOnly ? (
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

export function ReviewDashboard({
  initialData,
}: {
  initialData: ReviewDashboardData;
}) {
  const [data, setData] = useState(initialData);
  const [sourceMode, setSourceMode] = useState<ReviewSourceMode>("human_required");
  const [kind, setKind] = useState<ReviewKind>("sft");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [reviewer, setReviewer] = useState("switch");
  const [finalizeStatus, setFinalizeStatus] = useState<ReviewFinalizeStatusView | null>(
    null,
  );
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const finalizePollRef = useRef<number | null>(null);

  const activeDataset =
    sourceMode === "human_required" ? data.humanRequired : data.llmCompleted;
  const sourceItems =
    kind === "sft" ? activeDataset.sftItems : activeDataset.pairItems;
  const items = useMemo(
    () =>
      sourceMode === "human_required" && pendingOnly
        ? sourceItems.filter((item) => item.status !== "reviewed" && !item.decision)
        : sourceItems,
    [pendingOnly, sourceItems, sourceMode],
  );
  const stats = summarize(sourceItems);
  const pendingRequiredTotal = useMemo(
    () =>
      data.humanRequired.sftItems.filter((item) => !item.decision).length +
      data.humanRequired.pairItems.filter((item) => !item.decision).length,
    [data.humanRequired.pairItems, data.humanRequired.sftItems],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFinalizeStatus() {
      const response = await fetch(buildClientApiUrl("/api/review/finalize"), {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as ReviewFinalizeStatusView;
      if (!cancelled) {
        setFinalizeStatus(payload);
      }
    }

    void loadFinalizeStatus();

    return () => {
      cancelled = true;
      if (finalizePollRef.current) {
        window.clearInterval(finalizePollRef.current);
      }
    };
  }, []);

  function handleItemSaved(nextItem: ReviewItem) {
    setData((current) => {
      const nextData = updateHumanItemInData(current, nextItem.kind, nextItem);
      const nextPending = {
        sft: nextData.humanRequired.sftItems.filter((item) => !item.decision).length,
        pair: nextData.humanRequired.pairItems.filter((item) => !item.decision).length,
      };

      setFinalizeStatus((status) =>
        status
          ? {
              ...status,
              canFinalize: nextPending.sft + nextPending.pair === 0 && status.state !== "running",
              pending: {
                sft: nextPending.sft,
                pair: nextPending.pair,
                total: nextPending.sft + nextPending.pair,
              },
            }
          : status,
      );

      return nextData;
    });
  }

  async function refreshFinalizeStatus() {
    const response = await fetch(buildClientApiUrl("/api/review/finalize"), {
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as ReviewFinalizeStatusView;
    setFinalizeStatus(payload);
  }

  async function handleFinalize() {
    setFinalizeError(null);

    if (finalizePollRef.current) {
      window.clearInterval(finalizePollRef.current);
    }

    finalizePollRef.current = window.setInterval(() => {
      void refreshFinalizeStatus();
    }, 300);

    setFinalizeStatus((current) =>
      current
        ? {
            ...current,
            state: "running",
            currentStep: "finalize_sft",
            message: "SFT finalize 실행 중",
            canFinalize: false,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : {
            state: "running",
            currentStep: "finalize_sft",
            canFinalize: false,
            pending: {
              sft: data.humanRequired.sftItems.filter((item) => !item.decision).length,
              pair: data.humanRequired.pairItems.filter((item) => !item.decision).length,
              total: pendingRequiredTotal,
            },
            message: "SFT finalize 실행 중",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            updatedAt: new Date().toISOString(),
            durations: {
              sftMs: null,
              preferenceMs: null,
              totalMs: null,
            },
            outputs: {
              sft: null,
              preference: null,
            },
          },
    );

    try {
      const response = await fetch(buildClientApiUrl("/api/review/finalize"), {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.message ?? "finalize 실행에 실패했습니다.",
        );
      }

      setFinalizeStatus(payload as ReviewFinalizeStatusView);
    } catch (error) {
      setFinalizeError(
        error instanceof Error ? error.message : "finalize 실행에 실패했습니다.",
      );
      await refreshFinalizeStatus();
    } finally {
      if (finalizePollRef.current) {
        window.clearInterval(finalizePollRef.current);
        finalizePollRef.current = null;
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--teal)]">
            Compact Review
          </p>
          <h1 className="display-heading text-4xl font-semibold text-foreground">
            검수 리스트 선택 화면
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--ink-muted)]">
            사람 검수 대상과 LLM 1차 검수 완료 리스트를 전환해서 볼 수 있습니다.
            기본 화면은 사람이 직접 판정해야 하는 항목부터 열립니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-foreground/90 transition hover:bg-white/10"
          >
            시뮬레이터로 돌아가기
          </Link>
        </div>
      </header>

      <CardSurface>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["human_required", "사람 검수 필요", totalCount(data.humanRequired)],
              ["llm_completed", "LLM 검수 완료", totalCount(data.llmCompleted)],
            ] as const).map(([entry, label, count]) => (
              <button
                key={entry}
                type="button"
                onClick={() => setSourceMode(entry)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  sourceMode === entry
                    ? "bg-[var(--teal)] text-black"
                    : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                }`}
              >
                {label} {count}
              </button>
            ))}

            {(["sft", "pair"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setKind(entry)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  kind === entry
                    ? "bg-[var(--accent)] text-white"
                    : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
                }`}
              >
                {entry === "sft"
                  ? `SFT ${activeDataset.sftItems.length}`
                  : `Pair ${activeDataset.pairItems.length}`}
              </button>
            ))}

            {sourceMode === "human_required" ? (
              <label className="ml-2 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                <input
                  type="checkbox"
                  checked={pendingOnly}
                  onChange={(event) => setPendingOnly(event.target.checked)}
                />
                대기 항목만 보기
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(stats.decisions).map(([decision, count]) => (
              <span
                key={decision}
                className={`rounded-full px-3 py-1 text-xs font-medium ${decisionTone(
                  decision as ReviewItem["decision"],
                )}`}
              >
                {decisionLabel(decision as ReviewItem["decision"])} {count}
              </span>
            ))}
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              전체 {stats.total}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              대기 {stats.pending}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
              완료 {stats.reviewed}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            {sourceMode === "human_required" ? (
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">reviewer</span>
                <input
                  value={reviewer}
                  onChange={(event) => setReviewer(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm outline-none placeholder:text-[var(--ink-muted)]"
                  placeholder="이름"
                />
              </label>
            ) : (
              <TextBlock>
                <p className="mb-2 text-sm font-semibold text-foreground">읽기 전용</p>
                <p className="text-sm text-[var(--ink-muted)]">
                  이 탭은 LLM이 이미 1차 판정한 결과를 확인하는 용도입니다.
                </p>
              </TextBlock>
            )}

            <TextBlock>
              <p className="mb-2 text-sm font-semibold text-foreground">
                현재 모드:{" "}
                {sourceMode === "human_required" ? "사람 검수 필요" : "LLM 검수 완료"} /{" "}
                {kind === "sft" ? "SFT" : "Pair / DPO"}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                {sourceMode === "human_required"
                  ? kind === "sft"
                    ? "플레이어 입력과 NPC 응답을 보고 이 응답을 학습에 넣을지 직접 결정합니다."
                    : "같은 입력에 대한 chosen / rejected를 비교해서 순서가 맞는지 직접 결정합니다."
                  : kind === "sft"
                    ? "전체 LLM 판정 결과 중 추가 사람 검수 없이 통과한 응답만 읽기 전용으로 확인합니다."
                    : "전체 pair 판정 결과 중 추가 사람 검수 없이 통과한 pair만 읽기 전용으로 확인합니다."}
              </p>
            </TextBlock>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
              <p className="text-sm font-semibold text-foreground">Finalize</p>
              <p className="text-sm text-[var(--ink-muted)]">
                사람 검수 미완료가 `0`이면 최종 학습 데이터셋을 다시 생성할 수 있습니다.
              </p>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={
                  finalizeStatus
                    ? !finalizeStatus.canFinalize
                    : pendingRequiredTotal > 0
                }
                className="rounded-full bg-[var(--teal)] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {finalizeStatus?.state === "running"
                  ? "Finalize 실행 중..."
                  : "Finalize 실행"}
              </button>
              <p className="text-xs text-[var(--ink-muted)]">
                로컬 실측: SFT 약 55ms, preference 약 47ms, 전체 약 0.1초
              </p>
            </div>

            <TextBlock>
              <p className="mb-2 text-sm font-semibold text-foreground">현재 상태</p>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                  사람 검수 미완료 {pendingRequiredTotal}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    finalizeStatus?.state === "succeeded"
                      ? "bg-[rgba(74,166,124,0.16)] text-[var(--success)]"
                      : finalizeStatus?.state === "failed"
                        ? "bg-[rgba(214,90,90,0.16)] text-[var(--danger)]"
                        : finalizeStatus?.state === "running"
                          ? "bg-[rgba(76,194,200,0.16)] text-[var(--teal)]"
                          : "bg-white/6 text-[var(--ink-muted)]"
                  }`}
                >
                  {finalizeStatus?.state === "succeeded"
                    ? "완료"
                    : finalizeStatus?.state === "failed"
                      ? "실패"
                      : finalizeStatus?.state === "running"
                        ? "실행 중"
                        : "대기"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                  단계{" "}
                  {finalizeStatus?.currentStep === "finalize_sft"
                    ? "SFT finalize"
                    : finalizeStatus?.currentStep === "finalize_preference"
                      ? "Preference finalize"
                      : "-"}
                </span>
              </div>

              <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
                <p>메시지: {finalizeError ?? finalizeStatus?.message ?? "-"}</p>
                <p>시작: {formatTimestamp(finalizeStatus?.startedAt ?? null)}</p>
                <p>완료: {formatTimestamp(finalizeStatus?.finishedAt ?? null)}</p>
                <p>
                  소요: SFT {formatDuration(finalizeStatus?.durations.sftMs ?? null)} / Preference{" "}
                  {formatDuration(finalizeStatus?.durations.preferenceMs ?? null)} / 전체{" "}
                  {formatDuration(finalizeStatus?.durations.totalMs ?? null)}
                </p>
              </div>
            </TextBlock>
          </div>
        </div>
      </CardSurface>

      {items.length ? (
        <section
          className={
            kind === "sft"
              ? "grid gap-5 xl:grid-cols-2"
              : "grid gap-5"
          }
        >
          {items.map((item) => (
            <CompactReviewCard
              key={`${item.kind}:${item.reviewId}`}
              item={item}
              reviewer={reviewer}
              readOnly={sourceMode !== "human_required"}
              onItemSaved={
                sourceMode === "human_required" ? handleItemSaved : undefined
              }
            />
          ))}
        </section>
      ) : (
        <CardSurface>
          <p className="text-sm text-[var(--ink-muted)]">
            조건에 맞는 검수 항목이 없습니다.
          </p>
        </CardSurface>
      )}
    </main>
  );
}
