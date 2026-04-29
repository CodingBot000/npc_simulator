import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  apiGetReviewFinalizeStatus,
  apiRunReviewFinalize,
} from "@/lib/api-client";
import type {
  PairReviewItemView,
  ReviewDashboardData,
  ReviewDatasetView,
  ReviewFinalizeStatusView,
  ReviewKind,
  ReviewSourceMode,
  SftReviewItemView,
} from "@/lib/review-types";
import {
  CardSurface,
  TextBlock,
} from "./review-dashboard-primitives";
import { formatTimestamp } from "./review-formatters";
import { ReviewFinalizePanel } from "./review-finalize-panel";
import { CompactReviewCard } from "./review-item-card";
import { type ReviewItem } from "./review-item-model";
import { ReviewModeControls } from "./review-mode-controls";
import {
  persistReviewer,
  readStoredReviewer,
} from "./reviewer-storage";
import { ShadowInvalidCaseCard } from "./review-shadow-invalid-card";
import { ReviewTrainingPanel } from "./review-training-panel";
import { useReviewTraining } from "./use-review-training";

function isHumanReviewed(item: ReviewItem) {
  return item.decision !== null;
}

function filterDatasetByReviewedState(
  dataset: ReviewDatasetView,
  reviewed: boolean,
): ReviewDatasetView {
  return {
    sftItems: dataset.sftItems.filter((item) => isHumanReviewed(item) === reviewed),
    pairItems: dataset.pairItems.filter((item) => isHumanReviewed(item) === reviewed),
  };
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

export function ReviewDashboard({
  initialData,
}: {
  initialData: ReviewDashboardData;
}) {
  const [data, setData] = useState(initialData);
  const [sourceMode, setSourceMode] = useState<ReviewSourceMode>("human_required");
  const [kind, setKind] = useState<ReviewKind>("sft");
  const [reviewer, setReviewer] = useState(readStoredReviewer);
  const [finalizeStatus, setFinalizeStatus] = useState<ReviewFinalizeStatusView | null>(
    null,
  );
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const finalizePollRef = useRef<number | null>(null);
  const training = useReviewTraining({ reviewer });

  useEffect(() => {
    persistReviewer(reviewer);
  }, [reviewer]);

  const humanRequiredDataset = useMemo(
    () => filterDatasetByReviewedState(data.humanRequired, false),
    [data.humanRequired],
  );
  const humanReviewedDataset = useMemo(
    () => filterDatasetByReviewedState(data.humanRequired, true),
    [data.humanRequired],
  );
  const activeDataset = useMemo(() => {
    switch (sourceMode) {
      case "human_required":
        return humanRequiredDataset;
      case "human_reviewed":
        return humanReviewedDataset;
      case "llm_completed":
      default:
        return data.llmCompleted;
    }
  }, [data.llmCompleted, humanRequiredDataset, humanReviewedDataset, sourceMode]);
  const items = kind === "sft" ? activeDataset.sftItems : activeDataset.pairItems;
  const pendingRequiredTotal = useMemo(
    () =>
      data.humanRequired.sftItems.filter((item) => !item.decision).length +
      data.humanRequired.pairItems.filter((item) => !item.decision).length,
    [data.humanRequired.pairItems, data.humanRequired.sftItems],
  );
  useEffect(() => {
    let cancelled = false;

    async function loadFinalizeStatus() {
      try {
        const payload = await apiGetReviewFinalizeStatus({
          cache: "no-store",
        });

        if (!cancelled) {
          setFinalizeStatus(payload);
        }
      } catch {
        return;
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

    void training.refreshTrainingStatus();
  }

  async function refreshFinalizeStatus() {
    try {
      setFinalizeStatus(
        await apiGetReviewFinalizeStatus({
          cache: "no-store",
        }),
      );
    } catch {
      return;
    }
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
      setFinalizeStatus(await apiRunReviewFinalize());
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
      await training.refreshTrainingStatus();
    }
  }

  return (
    <>
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
          <a
            href="/"
            className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-foreground/90 transition hover:bg-white/10"
          >
            시뮬레이터로 돌아가기
          </a>
        </div>
      </header>

      <CardSurface>
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
            <p className="text-sm font-semibold text-foreground">Shadow invalid_json</p>
            <p className="text-sm text-[var(--ink-muted)]">
              local structured shadow 모델이 JSON 형식을 못 지킨 케이스만 따로 모아 본다.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[rgba(209,111,76,0.16)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
                총 {data.shadowInvalidJson.total}
              </span>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--ink-muted)]">
                최신 export {formatTimestamp(data.shadowInvalidJson.latestExportedAt)}
              </span>
            </div>
          </div>

          {data.shadowInvalidJson.cases.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {data.shadowInvalidJson.cases.map((item) => (
                <ShadowInvalidCaseCard
                  key={`${item.exportPath ?? "shadow"}:${item.turnIndex ?? "turn"}:${item.npcId}`}
                  item={item}
                />
              ))}
            </div>
          ) : (
            <TextBlock>
              아직 export된 episode 중에서 `shadowComparison.status=invalid_json`로 수집된 케이스가 없습니다.
              shadow compare를 켠 상태로 episode를 몇 번 더 export하면 여기에 최신 실패 케이스가 쌓입니다.
            </TextBlock>
          )}
        </div>
      </CardSurface>

      <CardSurface>
        <div className="flex flex-col gap-4">
          <ReviewModeControls
            sourceMode={sourceMode}
            onSourceModeChange={setSourceMode}
            kind={kind}
            onKindChange={setKind}
            reviewer={reviewer}
            onReviewerChange={setReviewer}
            humanRequiredDataset={humanRequiredDataset}
            humanReviewedDataset={humanReviewedDataset}
            llmCompletedDataset={data.llmCompleted}
            activeDataset={activeDataset}
            items={items}
          />

          <ReviewFinalizePanel
            status={finalizeStatus}
            error={finalizeError}
            pendingRequiredTotal={pendingRequiredTotal}
            onFinalize={handleFinalize}
          />

          <ReviewTrainingPanel controller={training} />
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
              key={item.reviewId}
              item={item}
              reviewer={reviewer}
              sourceMode={sourceMode}
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
    </>
  );
}
