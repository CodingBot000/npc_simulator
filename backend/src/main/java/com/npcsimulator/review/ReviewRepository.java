package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Repository;

@Repository
public class ReviewRepository {

    private final ReviewTaskRepository tasks;
    private final ReviewSnapshotRepository snapshots;
    private final ReviewTrainingRunRepository trainingRuns;

    public ReviewRepository(
        ReviewTaskRepository tasks,
        ReviewSnapshotRepository snapshots,
        ReviewTrainingRunRepository trainingRuns
    ) {
        this.tasks = tasks;
        this.snapshots = snapshots;
        this.trainingRuns = trainingRuns;
    }

    public List<ReviewTaskRow> findReviewTasks() {
        return tasks.findReviewTasks();
    }

    public Optional<ReviewTaskRow> findReviewTask(String reviewUid, String reviewKind) {
        return tasks.findReviewTask(reviewUid, reviewKind);
    }

    public List<CandidateRow> findCandidates() {
        return tasks.findCandidates();
    }

    public Optional<CandidateRow> findCandidate(long id) {
        return tasks.findCandidate(id);
    }

    public List<PairRow> findPairs() {
        return tasks.findPairs();
    }

    public Optional<PairRow> findPair(long id) {
        return tasks.findPair(id);
    }

    public PendingCounts getPendingReviewCounts() {
        return tasks.getPendingReviewCounts();
    }

    public String getLatestReviewUpdatedAt() {
        return tasks.getLatestReviewUpdatedAt();
    }

    public Optional<SnapshotSummaryRow> findActiveSnapshot(String datasetKind) {
        return snapshots.findActiveSnapshot(datasetKind);
    }

    public int countSnapshotItems(long snapshotId) {
        return snapshots.countSnapshotItems(snapshotId);
    }

    public Optional<TrainingRunRow> findLatestFinalizeRun() {
        return trainingRuns.findLatestFinalizeRun();
    }

    public List<TrainingRunRow> listTrainingRuns(List<String> kinds) {
        return trainingRuns.listTrainingRuns(kinds);
    }

    public Optional<TrainingRunRow> findLatestSuccessfulTrainingRun(String runKind) {
        return trainingRuns.findLatestSuccessfulTrainingRun(runKind);
    }

    public Optional<TrainingRunRow> findTrainingRunByFingerprint(String runKind, String fingerprint) {
        return trainingRuns.findTrainingRunByFingerprint(runKind, fingerprint);
    }

    public Optional<TrainingRunRow> findTrainingRunByUid(String runUid) {
        return trainingRuns.findTrainingRunByUid(runUid);
    }

    public Optional<TrainingRunRow> findLatestPromotedTrainingRun(String bindingKey) {
        return trainingRuns.findLatestPromotedTrainingRun(bindingKey);
    }

    public FinalizeRunRecord createFinalizeRun() {
        return trainingRuns.createFinalizeRun();
    }

    public void updateFinalizeRun(
        String runUid,
        String state,
        String currentStep,
        String message,
        String finishedAt,
        FinalizeMetrics durations,
        FinalizeOutputs outputs
    ) {
        trainingRuns.updateFinalizeRun(runUid, state, currentStep, message, finishedAt, durations, outputs);
    }

    public void createTrainingRun(
        String runUid,
        String kind,
        String trainingBackend,
        String canonicalModelFamily,
        String state,
        String currentStep,
        String message,
        Long sourceSnapshotId,
        String sourceFingerprint,
        String sourceDatasetVersion,
        String parentRunUid,
        String baseModel,
        String datasetDir,
        String adapterPath,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String remoteProvider,
        String remoteJobId,
        String remoteTrainingFileId,
        String remoteValidationFileId,
        String remoteModelName,
        String logPath,
        String trainingResultPath,
        String fingerprint,
        Object commands
    ) {
        trainingRuns.createTrainingRun(
            runUid,
            kind,
            trainingBackend,
            canonicalModelFamily,
            state,
            currentStep,
            message,
            sourceSnapshotId,
            sourceFingerprint,
            sourceDatasetVersion,
            parentRunUid,
            baseModel,
            datasetDir,
            adapterPath,
            runtimeArtifactPath,
            runtimeArtifactKind,
            remoteProvider,
            remoteJobId,
            remoteTrainingFileId,
            remoteValidationFileId,
            remoteModelName,
            logPath,
            trainingResultPath,
            fingerprint,
            commands
        );
    }

    public void appendTrainingRunEvent(
        String runUid,
        String level,
        String eventType,
        String step,
        String message,
        JsonNode payload
    ) {
        trainingRuns.appendTrainingRunEvent(runUid, level, eventType, step, message, payload);
    }

    public void updateTrainingRunState(
        String runUid,
        String state,
        String currentStep,
        String message,
        String finishedAt,
        String trainingBackend,
        String adapterPath,
        String adapterVersion,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String remoteProvider,
        String remoteJobId,
        String remoteTrainingFileId,
        String remoteValidationFileId,
        String remoteModelName,
        TrainingDurations durations
    ) {
        trainingRuns.updateTrainingRunState(
            runUid,
            state,
            currentStep,
            message,
            finishedAt,
            trainingBackend,
            adapterPath,
            adapterVersion,
            runtimeArtifactPath,
            runtimeArtifactKind,
            remoteProvider,
            remoteJobId,
            remoteTrainingFileId,
            remoteValidationFileId,
            remoteModelName,
            durations
        );
    }

    public void updateTrainingRunEvaluation(
        String runUid,
        String evalState,
        String evalMessage,
        String evalBindingKey,
        String evalBaselineLabel,
        String evalSummaryPath,
        JsonNode evalSummaryJson,
        String evalStartedAt,
        String evalFinishedAt
    ) {
        trainingRuns.updateTrainingRunEvaluation(
            runUid,
            evalState,
            evalMessage,
            evalBindingKey,
            evalBaselineLabel,
            evalSummaryPath,
            evalSummaryJson,
            evalStartedAt,
            evalFinishedAt
        );
    }

    public void updateTrainingRunReviewDecision(
        String runUid,
        String reviewDecision,
        String reviewNotes,
        String reviewedBy,
        String reviewedAt
    ) {
        trainingRuns.updateTrainingRunReviewDecision(runUid, reviewDecision, reviewNotes, reviewedBy, reviewedAt);
    }

    public void markTrainingRunPromoted(String runUid, String bindingKey, String promotedAt) {
        trainingRuns.markTrainingRunPromoted(runUid, bindingKey, promotedAt);
    }

    public void insertTrainingRunArtifact(
        String runUid,
        String artifactKind,
        String filePath,
        Long fileSizeBytes,
        String sha256,
        JsonNode metadataJson
    ) {
        trainingRuns.insertTrainingRunArtifact(runUid, artifactKind, filePath, fileSizeBytes, sha256, metadataJson);
    }

    public void updateReviewTaskDecision(
        long taskId,
        String decision,
        String reviewer,
        String notes,
        String reviewedAt,
        String nextStatus
    ) {
        tasks.updateReviewTaskDecision(taskId, decision, reviewer, notes, reviewedAt, nextStatus);
    }

    public void insertReviewDecisionEvent(
        long taskId,
        String decision,
        String nextStatus,
        String reviewer,
        String notes,
        JsonNode checklist,
        String decidedAt
    ) {
        tasks.insertReviewDecisionEvent(taskId, decision, nextStatus, reviewer, notes, checklist, decidedAt);
    }

    public record FinalizeRunRecord(String runUid) {}

    public record FinalizeMetrics(Long sftMs, Long preferenceMs, Long totalMs) {}

    public record FinalizeOutputs(String sft, String preference) {}

    public record TrainingDurations(Long buildMs, Long trainMs, Long totalMs) {}

    public record PendingCounts(int sft, int pair, int total) {}

    public record ReviewTaskRow(
        long id,
        String reviewUid,
        String reviewKind,
        Long sftCandidateId,
        Long preferencePairId,
        String bucket,
        String priority,
        String status,
        Boolean reviewRequired,
        String queueReason,
        JsonNode selectionReasonsJson,
        JsonNode selectionMetricsJson,
        JsonNode llmFirstPassJson,
        JsonNode checklistJson,
        String currentDecision,
        String currentReviewer,
        String currentReviewedAt,
        String currentNotes,
        String createdAt,
        String updatedAt
    ) {}

    public record CandidateRow(
        long id,
        String rowKey,
        String canonicalRowKey,
        JsonNode promptBundleJson,
        JsonNode assistantOutputJson,
        JsonNode metadataJson,
        JsonNode judgeResultJson,
        JsonNode filterResultJson,
        BigDecimal weightedJudgeScore,
        String strategyLabel,
        String scenarioId,
        String npcId,
        String targetNpcId,
        String inputMode,
        String sourceExportPath,
        String sourceLabel
    ) {}

    public record PairRow(
        long id,
        String pairKey,
        String groupingStrategy,
        String groupingKey,
        JsonNode promptBundleJson,
        Long chosenCandidateId,
        Long rejectedCandidateId,
        JsonNode pairReasonJson,
        BigDecimal weightedGap,
        BigDecimal pairConfidence,
        BigDecimal preferenceStrength,
        JsonNode judgeResultJson,
        String pairDecision
    ) {}

    public record SnapshotSummaryRow(
        long id,
        String datasetKind,
        String datasetVersion,
        String sourceFingerprint,
        String outputUri,
        JsonNode manifestJson,
        String generatedAt
    ) {}

    public record TrainingRunRow(
        long id,
        String runUid,
        String runKind,
        String state,
        String currentStep,
        String message,
        Long sourceSnapshotId,
        String baseModel,
        String trainingBackend,
        String outputAdapterPath,
        String outputAdapterVersion,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String remoteProvider,
        String remoteJobId,
        String remoteTrainingFileId,
        String remoteValidationFileId,
        String remoteModelName,
        String datasetWorkDir,
        String runFingerprint,
        String sourceFingerprint,
        JsonNode paramsJson,
        JsonNode metricsJson,
        String evalState,
        String evalMessage,
        String evalBindingKey,
        String evalBaselineLabel,
        String evalSummaryPath,
        JsonNode evalSummaryJson,
        String evalStartedAt,
        String evalFinishedAt,
        String reviewDecision,
        String reviewNotes,
        String reviewedBy,
        String reviewedAt,
        String promotedBindingKey,
        String promotedAt,
        String startedAt,
        String finishedAt,
        String updatedAt,
        String createdAt
    ) {}
}
