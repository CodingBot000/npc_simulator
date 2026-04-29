import { useState } from "react";
import type { ReviewTrainingBindingKey } from "@/lib/review-types";
import { TextBlock } from "./review-dashboard-primitives";
import {
  BlockingExecutionOverlay,
  PromotionSlotGuideModal,
  TrainingExecutionGuideModal,
  trainingActionButtonClassName,
} from "./review-training-modals";
import {
  TrainingRunDetailCard,
  dpoExecutionModeLabel,
  dpoFingerprintRelationLabel,
} from "./review-training-run-card";
import type { ReviewTrainingController } from "./use-review-training";

const TRAINING_BINDING_KEYS: ReviewTrainingBindingKey[] = [
  "default",
  "doctor",
  "supervisor",
  "director",
];

export function ReviewTrainingPanel({
  controller,
}: {
  controller: ReviewTrainingController;
}) {
  const [promotionGuideOpen, setPromotionGuideOpen] = useState(false);
  const [trainingExecutionGuideOpen, setTrainingExecutionGuideOpen] = useState(false);
  const {
    blockingExecutionState,
    canUseHistoricalRun,
    currentActionRun,
    handleTraining,
    handleTrainingDecision,
    handleTrainingEvaluation,
    handleTrainingPromotion,
    isHistoricalReoperation,
    latestHistoricalRun,
    setCurrentActionRunId,
    setTrainingBindingKey,
    trainingBindingKey,
    trainingError,
    trainingStatus,
  } = controller;

  return (
    <>
      <PromotionSlotGuideModal
        open={promotionGuideOpen}
        onClose={() => setPromotionGuideOpen(false)}
      />
      <TrainingExecutionGuideModal
        open={trainingExecutionGuideOpen}
        onClose={() => setTrainingExecutionGuideOpen(false)}
      />
      <BlockingExecutionOverlay
        open={blockingExecutionState !== null}
        title={blockingExecutionState?.title ?? ""}
        message={blockingExecutionState?.message ?? ""}
        runId={blockingExecutionState?.runId ?? null}
        step={blockingExecutionState?.step ?? null}
        startedAt={blockingExecutionState?.startedAt ?? null}
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
          <p className="text-sm font-semibold text-foreground">Training</p>
          <p className="text-sm text-[var(--ink-muted)]">
            finalize가 최신 상태일 때만 로컬 Llama 3.1 SFT / DPO 학습을 시작할 수 있습니다.
          </p>
          <label className="block">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="block text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                Model Promotion Slot
              </span>
              <button
                type="button"
                onClick={() => setPromotionGuideOpen(true)}
                className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-white/10"
              >
                가이드 보기
              </button>
            </div>
            <select
              value={trainingBindingKey}
              onChange={(event) =>
                setTrainingBindingKey(event.target.value as ReviewTrainingBindingKey)
              }
              className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-foreground outline-none"
            >
              {TRAINING_BINDING_KEYS.map((bindingKey) => (
                <option key={bindingKey} value={bindingKey}>
                  {bindingKey}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setTrainingExecutionGuideOpen(true)}
              className="inline-flex items-center rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-white/20 hover:bg-white/6 hover:text-foreground"
            >
              실행 가이드보기
            </button>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm leading-7 text-[var(--ink-muted)]">
            {currentActionRun ? (
              isHistoricalReoperation ? (
                <>
                  현재는 <span className="font-semibold text-foreground">기존 run 재조작 모드</span>
                  다. 아래 평가/채택/반려/Model Promotion 버튼은 새 run이 아니라{" "}
                  <span className="font-semibold text-foreground">{currentActionRun.runId}</span>에
                  적용된다.
                </>
              ) : (
                <>
                  현재 조작 대상은{" "}
                  <span className="font-semibold text-foreground">{currentActionRun.runId}</span>
                  다. 아래 버튼은 이 run을 기준으로 동작한다.
                </>
              )
            ) : latestHistoricalRun ? (
              <>
                새 run이 아직 없어 평가/채택/반려/Model Promotion 버튼을 잠가 두었습니다.
                기존 run을 다시 조작하시려면 오른쪽 정보 패널의{" "}
                <span className="font-semibold text-foreground">
                  기존 run 기록 (latest historical run)
                </span>{" "}
                카드에서 명시적으로 현재 조작 대상으로 선택하셔야 합니다. 모바일에서는 같은 카드가
                버튼 영역 아래쪽에 보입니다.
              </>
            ) : (
              <>아직 생성된 training run이 없어 조작 대상이 비어 있다.</>
            )}
          </div>
          <div className="space-y-2">
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => void handleTraining("sft")}
                disabled={!trainingStatus?.sft.canStart}
                className={trainingActionButtonClassName("sft")}
              >
                새로운 SFT Base 생성
              </button>
              <p className="px-1 text-xs leading-6 text-[var(--ink-muted)]">
                새 SFT 완료 후에는 그 결과가 이후 DPO parent가 됩니다.
              </p>
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => void handleTraining("dpo")}
                disabled={!trainingStatus?.dpo.canStart}
                className={trainingActionButtonClassName("dpo")}
              >
                기존 SFT Base로 DPO 진행
              </button>
              <p className="px-1 text-xs leading-6 text-[var(--ink-muted)]">
                지금 누르면 현재 parent SFT run(
                <span className="font-mono text-[11px] text-foreground">
                  {trainingStatus?.dpo.parentRunId ?? "-"}
                </span>
                )을 그대로 사용합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleTrainingEvaluation()}
              disabled={
                !currentActionRun ||
                currentActionRun.state !== "succeeded" ||
                currentActionRun.evaluation.state === "running"
              }
              className={trainingActionButtonClassName("eval")}
            >
              Golden-set Evaluation 실행
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleTrainingDecision("accepted")}
                disabled={
                  !currentActionRun ||
                  currentActionRun.evaluation.state !== "succeeded"
                }
                className={trainingActionButtonClassName("accept")}
              >
                채택
              </button>
              <button
                type="button"
                onClick={() => void handleTrainingDecision("rejected")}
                disabled={
                  !currentActionRun ||
                  currentActionRun.evaluation.state !== "succeeded"
                }
                className={trainingActionButtonClassName("reject")}
              >
                반려
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleTrainingPromotion()}
              disabled={
                !currentActionRun ||
                currentActionRun.decision.state !== "accepted"
              }
              className={trainingActionButtonClassName("promote")}
            >
              Model Promotion
            </button>
          </div>
        </div>

        <TextBlock>
          <p className="mb-2 text-sm font-semibold text-foreground">학습 상태</p>
          <div className="space-y-4 text-sm text-[var(--ink-muted)]">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  SFT
                </p>
                <p>dataset version: {trainingStatus?.sft.dataset.datasetVersion ?? "-"}</p>
                <p>row count: {trainingStatus?.sft.dataset.rowCount ?? "-"}</p>
                <p>
                  상태:{" "}
                  {trainingStatus?.sft.canStart
                    ? "실행 가능"
                    : trainingStatus?.sft.alreadyTrained
                      ? "이미 학습됨"
                      : "대기"}
                </p>
                <p>
                  메시지: {trainingStatus?.sft.blockingIssues[0] ?? "문제 없음"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--teal)]">
                  DPO
                </p>
                <p>dataset version: {trainingStatus?.dpo.dataset.datasetVersion ?? "-"}</p>
                <p>row count: {trainingStatus?.dpo.dataset.rowCount ?? "-"}</p>
                <p>
                  DPO 실행 방식: {dpoExecutionModeLabel(trainingStatus?.dpo.executionMode ?? null)}
                </p>
                <p>
                  현재 사용될 parent SFT: {trainingStatus?.dpo.parentRunId ?? "-"}
                </p>
                <p>
                  판단 근거:{" "}
                  {dpoFingerprintRelationLabel(trainingStatus?.dpo.sftFingerprintRelation ?? null)}
                </p>
                <p>
                  parent SFT run: {trainingStatus?.dpo.parentRunId ?? "-"}
                </p>
                <p>
                  메시지: {trainingStatus?.dpo.blockingIssues[0] ?? "문제 없음"}
                </p>
              </div>
            </div>

            <TrainingRunDetailCard
              eyebrow="현재 조작 대상"
              run={currentActionRun}
              messageOverride={trainingError ?? currentActionRun?.message ?? null}
              emptyMessage={
                latestHistoricalRun ? (
                  <>
                    아직 현재 조작 대상으로 잡힌 새 run이 없습니다. 과거 run을 다시
                    조작하시려면 오른쪽 정보 패널의{" "}
                    <span className="font-semibold text-foreground">
                      기존 run 기록 (latest historical run)
                    </span>{" "}
                    카드에서 명시적으로 선택하셔야 합니다. 모바일에서는 같은 카드가 아래쪽에
                    보입니다.
                  </>
                ) : (
                  <>아직 생성된 training run이 없다.</>
                )
              }
              note={
                isHistoricalReoperation ? (
                  <>
                    기존 run 재조작 모드다. 현재 표시된 `채택 / 반려 / Model Promotion`은
                    새로 만든 run이 아니라 latest historical run에 다시 적용된다.
                  </>
                ) : null
              }
            />
            <TrainingRunDetailCard
              eyebrow="기존 run 기록 (latest historical run)"
              run={latestHistoricalRun}
              emptyMessage={<>아직 기록된 latest historical run이 없다.</>}
              action={
                canUseHistoricalRun ? (
                  <button
                    type="button"
                    onClick={() => setCurrentActionRunId(latestHistoricalRun?.runId ?? null)}
                    className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-white/10"
                  >
                    이 run을 현재 조작 대상으로 사용
                  </button>
                ) : isHistoricalReoperation ? (
                  <button
                    type="button"
                    onClick={() => setCurrentActionRunId(null)}
                    className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-white/20 hover:bg-white/6 hover:text-foreground"
                  >
                    현재 조작 대상 해제
                  </button>
                ) : null
              }
              note={
                trainingStatus?.activeRun ? (
                  <>지금은 새 run이 실행 중이라 historical run 재조작 선택을 잠시 숨긴 상태다.</>
                ) : currentActionRun === null ? (
                  <>현재 조작 대상이 비어 있으므로 이 card는 조회 전용이다.</>
                ) : null
              }
            />
          </div>
        </TextBlock>
      </div>
    </>
  );
}
