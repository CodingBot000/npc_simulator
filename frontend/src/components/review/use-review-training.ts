import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  apiGetReviewTrainingStatus,
  apiPromoteReviewTrainingRun,
  apiRunReviewTraining,
  apiRunReviewTrainingEvaluation,
  apiUpdateReviewTrainingDecision,
} from "@/lib/api-client";
import type {
  ReviewTrainingBindingKey,
  ReviewTrainingDecisionRequest,
  ReviewTrainingKind,
  ReviewTrainingRequest,
  ReviewTrainingRunActionRequest,
  ReviewTrainingStatusView,
} from "@/lib/review-types";

export function useReviewTraining({
  reviewer,
  writeEnabled,
  writeDisabledMessage,
}: {
  reviewer: string;
  writeEnabled: boolean;
  writeDisabledMessage: string | null;
}) {
  const [trainingStatus, setTrainingStatus] = useState<ReviewTrainingStatusView | null>(
    null,
  );
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingBindingKey, setTrainingBindingKey] =
    useState<ReviewTrainingBindingKey>("default");
  const [currentActionRunId, setCurrentActionRunId] = useState<string | null>(null);
  const [pendingTrainingLaunch, setPendingTrainingLaunch] = useState<{
    kind: ReviewTrainingKind;
    startedAt: string;
  } | null>(null);
  const trainingPollRef = useRef<number | null>(null);

  const latestHistoricalRun = trainingStatus?.latestRun ?? null;
  const currentActionRun = useMemo(() => {
    if (!trainingStatus) {
      return null;
    }

    if (currentActionRunId) {
      if (trainingStatus.activeRun?.runId === currentActionRunId) {
        return trainingStatus.activeRun;
      }
      if (trainingStatus.latestRun?.runId === currentActionRunId) {
        return trainingStatus.latestRun;
      }
      return null;
    }

    return trainingStatus.activeRun ?? null;
  }, [currentActionRunId, trainingStatus]);
  const isHistoricalReoperation =
    currentActionRun !== null &&
    latestHistoricalRun !== null &&
    currentActionRun.runId === latestHistoricalRun.runId &&
    trainingStatus?.activeRun === null;
  const canUseHistoricalRun =
    trainingStatus?.activeRun === null &&
    latestHistoricalRun !== null &&
    currentActionRun?.runId !== latestHistoricalRun.runId;
  const blockingExecutionState = useMemo(() => {
    if (trainingStatus?.activeRun?.state === "running") {
      return {
        title:
          trainingStatus.activeRun.kind === "sft"
            ? "새로운 SFT Base 생성 중"
            : "기존 SFT Base로 DPO 진행 중",
        message:
          trainingStatus.activeRun.message ??
          "학습 작업을 실행 중입니다. 완료될 때까지 잠시 기다려 주세요.",
        runId: trainingStatus.activeRun.runId,
        step: trainingStatus.activeRun.currentStep,
        startedAt: trainingStatus.activeRun.startedAt,
      };
    }

    if (trainingStatus?.latestRun?.evaluation.state === "running") {
      return {
        title: "Golden-set Evaluation 실행 중",
        message:
          trainingStatus.latestRun.evaluation.message ??
          "Golden-set Evaluation을 진행 중입니다. 완료될 때까지 잠시 기다려 주세요.",
        runId: trainingStatus.latestRun.runId,
        step: "golden_eval",
        startedAt: trainingStatus.latestRun.evaluation.startedAt,
      };
    }

    if (pendingTrainingLaunch) {
      return {
        title:
          pendingTrainingLaunch.kind === "sft"
            ? "새로운 SFT Base 생성 시작 중"
            : "기존 SFT Base로 DPO 진행 시작 중",
        message: "실행 요청을 전송하고 있습니다. 잠시만 기다려 주세요.",
        runId: null,
        step: "launching",
        startedAt: pendingTrainingLaunch.startedAt,
      };
    }

    return null;
  }, [pendingTrainingLaunch, trainingStatus]);

  useEffect(() => {
    let cancelled = false;

    async function loadTrainingStatus() {
      try {
        const payload = await apiGetReviewTrainingStatus({
          cache: "no-store",
        });

        if (!cancelled) {
          setTrainingStatus(payload);
        }
      } catch {
        return;
      }
    }

    void loadTrainingStatus();

    return () => {
      cancelled = true;
      if (trainingPollRef.current) {
        window.clearInterval(trainingPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const shouldPoll =
      trainingStatus?.activeRun?.state === "running" ||
      trainingStatus?.latestRun?.evaluation.state === "running";

    if (shouldPoll) {
      if (!trainingPollRef.current) {
        trainingPollRef.current = window.setInterval(() => {
          void refreshTrainingStatus();
        }, 2000);
      }
      return;
    }

    if (trainingPollRef.current) {
      window.clearInterval(trainingPollRef.current);
      trainingPollRef.current = null;
    }
  }, [trainingStatus?.activeRun?.state, trainingStatus?.latestRun?.evaluation.state]);

  useEffect(() => {
    if (!currentActionRunId && trainingStatus?.activeRun?.runId) {
      setCurrentActionRunId(trainingStatus.activeRun.runId);
      return;
    }

    if (
      currentActionRunId &&
      trainingStatus &&
      trainingStatus.activeRun?.runId !== currentActionRunId &&
      trainingStatus.latestRun?.runId !== currentActionRunId
    ) {
      setCurrentActionRunId(trainingStatus.activeRun?.runId ?? null);
    }
  }, [currentActionRun, currentActionRunId, trainingStatus]);

  async function refreshTrainingStatus() {
    try {
      setTrainingStatus(
        await apiGetReviewTrainingStatus({
          cache: "no-store",
        }),
      );
    } catch {
      return;
    }
  }

  async function handleTraining(kind: ReviewTrainingKind) {
    if (!writeEnabled) {
      setTrainingError(writeDisabledMessage ?? "review 실행 기능이 잠겨 있습니다.");
      return;
    }

    setTrainingError(null);
    setPendingTrainingLaunch({
      kind,
      startedAt: new Date().toISOString(),
    });

    try {
      const requestBody: ReviewTrainingRequest = { kind };
      const nextStatus = await apiRunReviewTraining(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(nextStatus.activeRun?.runId ?? nextStatus.latestRun?.runId ?? null);
      setPendingTrainingLaunch(null);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "학습 실행에 실패했습니다.",
      );
      setPendingTrainingLaunch(null);
      await refreshTrainingStatus();
    }
  }

  async function handleTrainingEvaluation() {
    if (!writeEnabled) {
      setTrainingError(writeDisabledMessage ?? "review 실행 기능이 잠겨 있습니다.");
      return;
    }

    if (!currentActionRun) {
      return;
    }

    setTrainingError(null);

    try {
      const requestBody: ReviewTrainingRunActionRequest = {
        runId: currentActionRun.runId,
        bindingKey: trainingBindingKey,
      };
      const nextStatus = await apiRunReviewTrainingEvaluation(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(currentActionRun.runId);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "Golden-set Evaluation 실행에 실패했습니다.",
      );
      await refreshTrainingStatus();
    }
  }

  async function handleTrainingDecision(decision: "accepted" | "rejected") {
    if (!writeEnabled) {
      setTrainingError(writeDisabledMessage ?? "review 실행 기능이 잠겨 있습니다.");
      return;
    }

    if (!currentActionRun) {
      return;
    }

    setTrainingError(null);

    try {
      const requestBody: ReviewTrainingDecisionRequest = {
        runId: currentActionRun.runId,
        decision,
        reviewer,
        notes: "",
      };
      const nextStatus = await apiUpdateReviewTrainingDecision(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(currentActionRun.runId);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "학습 채택 여부 저장에 실패했습니다.",
      );
      await refreshTrainingStatus();
    }
  }

  async function handleTrainingPromotion() {
    if (!writeEnabled) {
      setTrainingError(writeDisabledMessage ?? "review 실행 기능이 잠겨 있습니다.");
      return;
    }

    if (!currentActionRun) {
      return;
    }

    setTrainingError(null);

    try {
      const requestBody: ReviewTrainingRunActionRequest = {
        runId: currentActionRun.runId,
        bindingKey: trainingBindingKey,
      };
      const nextStatus = await apiPromoteReviewTrainingRun(requestBody);
      setTrainingStatus(nextStatus);
      setCurrentActionRunId(currentActionRun.runId);
    } catch (error) {
      setTrainingError(
        error instanceof Error ? error.message : "Model Promotion에 실패했습니다.",
      );
      await refreshTrainingStatus();
    }
  }

  return {
    blockingExecutionState,
    canUseHistoricalRun,
    currentActionRun,
    handleTraining,
    handleTrainingDecision,
    handleTrainingEvaluation,
    handleTrainingPromotion,
    isHistoricalReoperation,
    latestHistoricalRun,
    refreshTrainingStatus,
    setCurrentActionRunId,
    setTrainingBindingKey,
    trainingBindingKey,
    trainingError,
    trainingStatus,
    writeDisabledMessage,
    writeEnabled,
  };
}

export type ReviewTrainingController = ReturnType<typeof useReviewTraining>;
