import type {
  ReviewDatasetView,
  ReviewKind,
  ReviewSourceMode,
} from "@/lib/review-types";
import { TextBlock } from "./review-dashboard-primitives";
import {
  decisionLabel,
  decisionTone,
  type ReviewItem,
} from "./review-item-model";

type ReviewModeControlsProps = {
  sourceMode: ReviewSourceMode;
  onSourceModeChange: (sourceMode: ReviewSourceMode) => void;
  kind: ReviewKind;
  onKindChange: (kind: ReviewKind) => void;
  reviewer: string;
  onReviewerChange: (reviewer: string) => void;
  humanRequiredDataset: ReviewDatasetView;
  humanReviewedDataset: ReviewDatasetView;
  llmCompletedDataset: ReviewDatasetView;
  activeDataset: ReviewDatasetView;
  items: ReviewItem[];
};

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

function sourceModeLabel(sourceMode: ReviewSourceMode) {
  switch (sourceMode) {
    case "human_required":
      return "사람 검수 필요";
    case "human_reviewed":
      return "사람 검수 완료";
    case "llm_completed":
    default:
      return "LLM 검수 완료";
  }
}

function modeDescription(sourceMode: ReviewSourceMode, kind: ReviewKind) {
  if (sourceMode === "human_required") {
    return kind === "sft"
      ? "아직 사람이 직접 판정해야 하는 SFT 응답만 따로 보여줍니다."
      : "아직 사람이 직접 판정해야 하는 pair만 따로 보여줍니다.";
  }

  if (sourceMode === "human_reviewed") {
    return kind === "sft"
      ? "사람이 이미 판정한 SFT 응답만 읽기 전용으로 다시 확인합니다."
      : "사람이 이미 판정한 pair만 읽기 전용으로 다시 확인합니다.";
  }

  return kind === "sft"
    ? "전체 LLM 판정 결과 중 추가 사람 검수 없이 통과한 응답만 읽기 전용으로 확인합니다."
    : "전체 pair 판정 결과 중 추가 사람 검수 없이 통과한 pair만 읽기 전용으로 확인합니다.";
}

export function ReviewModeControls({
  sourceMode,
  onSourceModeChange,
  kind,
  onKindChange,
  reviewer,
  onReviewerChange,
  humanRequiredDataset,
  humanReviewedDataset,
  llmCompletedDataset,
  activeDataset,
  items,
}: ReviewModeControlsProps) {
  const stats = summarize(items);
  const sourceModeOptions = [
    ["human_required", "사람 검수 필요", totalCount(humanRequiredDataset)],
    ["human_reviewed", "사람 검수 완료", totalCount(humanReviewedDataset)],
    ["llm_completed", "LLM 검수 완료", totalCount(llmCompletedDataset)],
  ] as const;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {sourceModeOptions.map(([entry, label, count]) => (
            <button
              key={entry}
              type="button"
              onClick={() => onSourceModeChange(entry)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                sourceMode === entry
                  ? "bg-[var(--teal)] text-black"
                  : "border border-white/10 bg-white/6 text-foreground/85 hover:bg-white/10"
              }`}
            >
              {label} {count}
            </button>
          ))}
        </div>

        <span
          aria-hidden="true"
          className="px-1 text-sm font-semibold text-[var(--ink-muted)]"
        >
          |
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {(["sft", "pair"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onKindChange(entry)}
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
        </div>
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
              onChange={(event) => onReviewerChange(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm outline-none placeholder:text-[var(--ink-muted)]"
              placeholder="이름"
            />
          </label>
        ) : sourceMode === "human_reviewed" ? (
          <TextBlock>
            <p className="mb-2 text-sm font-semibold text-foreground">읽기 전용</p>
            <p className="text-sm text-[var(--ink-muted)]">
              이 탭은 사람이 이미 검수한 결과를 다시 확인하는 용도입니다.
            </p>
          </TextBlock>
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
            현재 모드: {sourceModeLabel(sourceMode)} /{" "}
            {kind === "sft" ? "SFT" : "Pair / DPO"}
          </p>
          <p className="text-sm text-[var(--ink-muted)]">
            {modeDescription(sourceMode, kind)}
          </p>
        </TextBlock>
      </div>
    </>
  );
}
