package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewFinalizeService {

    private static final String FINALIZE_SFT_SCRIPT = "backend/scripts/finalize-sft-dataset.mjs";
    private static final String FINALIZE_PREFERENCE_SCRIPT = "backend/scripts/finalize-preference-dataset.mjs";
    private static final String SNAPSHOT_SYNC_SCRIPT = "backend/scripts/review-sync-snapshots.ts";
    private static final String FINALIZE_SFT_KEEP_INPUT = "data/evals/filtered-live/keep_sft.jsonl";
    private static final String FINALIZE_SFT_OUTPUT_DIR = "data/train/sft/live";
    private static final String FINALIZE_PREFERENCE_INPUT = "data/evals/preference/candidate_pairs_live_gap1.jsonl";
    private static final String FINALIZE_PREFERENCE_OUTPUT_DIR = "data/train/preference/live";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewTrainingCommandService trainingCommandService;
    private final ReviewSnapshotSummaryService snapshotSummaryService;
    private final ReviewJsonSupport json;

    ReviewFinalizeService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewTrainingCommandService trainingCommandService,
        ReviewSnapshotSummaryService snapshotSummaryService,
        ReviewJsonSupport json
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
        this.trainingCommandService = trainingCommandService;
        this.snapshotSummaryService = snapshotSummaryService;
        this.json = json;
    }

    JsonNode getFinalizeStatus(HttpHeaders headers) {
        ReviewRepository.PendingCounts pending = reviewRepository.getPendingReviewCounts();
        String latestReviewUpdatedAt = reviewRepository.getLatestReviewUpdatedAt();
        Optional<ReviewRepository.TrainingRunRow> latestRun = reviewRepository.findLatestFinalizeRun();
        Optional<ReviewSnapshotSummary> activeSft = snapshotSummaryService.getActiveSnapshotSummary("sft");
        Optional<ReviewSnapshotSummary> activePreference = snapshotSummaryService.getActiveSnapshotSummary("preference");

        String latestSnapshotAt = json.newestTimestamp(activeSft.map(ReviewSnapshotSummary::generatedAt).orElse(null), activePreference.map(ReviewSnapshotSummary::generatedAt).orElse(null));
        boolean canFinalize =
            pending.total() == 0 &&
            !"running".equals(latestRun.map(ReviewRepository.TrainingRunRow::state).orElse(null)) &&
            (
                latestSnapshotAt == null ||
                latestReviewUpdatedAt == null ||
                Instant.parse(latestSnapshotAt).isBefore(Instant.parse(latestReviewUpdatedAt))
            );

        ObjectNode metrics = latestRun.map(row -> json.object(row.metricsJson())).orElse(objectMapper.createObjectNode());
        ObjectNode durations = json.object(metrics.get("durations"));
        ObjectNode outputs = json.object(metrics.get("outputs"));

        ObjectNode response = objectMapper.createObjectNode();
        response.put("state", latestRun.map(ReviewRepository.TrainingRunRow::state).orElse("idle"));
        response.put("canFinalize", canFinalize);
        response.set("pending", json.pendingNode(pending));
        response.set("currentStep", json.nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::currentStep).orElse(null)));
        response.set("message", json.nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::message).orElse(null)));
        response.set("startedAt", json.nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::startedAt).orElse(null)));
        response.set("finishedAt", json.nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::finishedAt).orElse(null)));
        response.set("updatedAt", json.nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::updatedAt).orElse(null)));
        ObjectNode durationNode = objectMapper.createObjectNode();
        durationNode.set("sftMs", json.nullableNumberNode(json.extractNumber(durations, "sftMs")));
        durationNode.set("preferenceMs", json.nullableNumberNode(json.extractNumber(durations, "preferenceMs")));
        durationNode.set("totalMs", json.nullableNumberNode(json.extractNumber(durations, "totalMs")));
        response.set("durations", durationNode);
        ObjectNode outputNode = objectMapper.createObjectNode();
        outputNode.set("sft", json.nullableTextNode(json.extractText(outputs, "sft")));
        outputNode.set("preference", json.nullableTextNode(json.extractText(outputs, "preference")));
        response.set("outputs", outputNode);
        return response;
    }

    JsonNode runFinalize(HttpHeaders headers) {
        JsonNode status = getFinalizeStatus(headers);
        int pendingTotal = json.object(status.get("pending")).path("total").asInt(0);
        if (pendingTotal > 0) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "사람 검수 미완료 항목이 남아 있어 finalize를 실행할 수 없습니다.");
        }
        if ("running".equals(json.extractText(status, "state"))) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "이미 finalize가 실행 중입니다.");
        }
        if (!status.path("canFinalize").asBoolean(false)) {
            throw new ReviewApiException(
                HttpStatus.CONFLICT,
                json.extractText(status, "message", "finalize를 실행할 수 없습니다.")
            );
        }

        ReviewRepository.FinalizeRunRecord run = reviewRepository.createFinalizeRun();
        Instant startedAt = Instant.now();

        try {
            ReviewRuntimeCommandRunner.ProcessResult sftResult = commandRunner.runNodeCommand(List.of(
                commandRunner.tsxBinary().toString(),
                commandRunner.resolveRequiredProjectPath(FINALIZE_SFT_SCRIPT).toString(),
                "--keep-input",
                FINALIZE_SFT_KEEP_INPUT,
                "--output-dir",
                FINALIZE_SFT_OUTPUT_DIR
            ));

            reviewRepository.updateFinalizeRun(
                run.runUid(),
                "running",
                "finalize_preference",
                "Preference finalize 실행 중",
                null,
                new ReviewRepository.FinalizeMetrics(
                    sftResult.durationMs(),
                    null,
                    null
                ),
                new ReviewRepository.FinalizeOutputs(
                    json.blankToNull(sftResult.stdout()),
                    null
                )
            );

            ReviewRuntimeCommandRunner.ProcessResult preferenceResult = commandRunner.runNodeCommand(List.of(
                commandRunner.tsxBinary().toString(),
                commandRunner.resolveRequiredProjectPath(FINALIZE_PREFERENCE_SCRIPT).toString(),
                "--pairs-input",
                FINALIZE_PREFERENCE_INPUT,
                "--output-dir",
                FINALIZE_PREFERENCE_OUTPUT_DIR
            ));

            commandRunner.runNodeCommand(List.of(
                commandRunner.tsxBinary().toString(),
                commandRunner.resolveRequiredProjectPath(SNAPSHOT_SYNC_SCRIPT).toString()
            ));

            String sftManifestPath = existingPathString(commandRunner.resolveRequiredProjectPath(FINALIZE_SFT_OUTPUT_DIR).resolve("manifest.json"));
            String preferenceManifestPath = existingPathString(commandRunner.resolveRequiredProjectPath(FINALIZE_PREFERENCE_OUTPUT_DIR).resolve("manifest.json"));
            trainingCommandService.registerFinalizeArtifacts(
                run.runUid(),
                FINALIZE_SFT_OUTPUT_DIR,
                FINALIZE_PREFERENCE_OUTPUT_DIR
            );

            Instant finishedAt = Instant.now();
            reviewRepository.updateFinalizeRun(
                run.runUid(),
                "succeeded",
                null,
                "finalize 완료",
                finishedAt.toString(),
                new ReviewRepository.FinalizeMetrics(
                    sftResult.durationMs(),
                    preferenceResult.durationMs(),
                    finishedAt.toEpochMilli() - startedAt.toEpochMilli()
                ),
                new ReviewRepository.FinalizeOutputs(
                    json.blankToNull(sftManifestPath) != null ? sftManifestPath : json.blankToNull(sftResult.stdout()),
                    json.blankToNull(preferenceManifestPath) != null ? preferenceManifestPath : json.blankToNull(preferenceResult.stdout())
                )
            );
            return getFinalizeStatus(headers);
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "finalize 실행에 실패했습니다.";
            reviewRepository.updateFinalizeRun(
                run.runUid(),
                "failed",
                null,
                message,
                Instant.now().toString(),
                null,
                null
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    ArrayNode getFinalizeBlockingIssues() {
        JsonNode finalizeStatus = getFinalizeStatus(new HttpHeaders());
        ArrayNode issues = objectMapper.createArrayNode();
        int pendingTotal = json.object(finalizeStatus.get("pending")).path("total").asInt(0);
        boolean canFinalize = finalizeStatus.path("canFinalize").asBoolean(false);
        String finalizeState = json.extractText(finalizeStatus, "state", "idle");

        if (pendingTotal > 0) {
            issues.add("먼저 사람 검수를 끝내고 finalize를 실행해야 합니다.");
            return issues;
        }

        if (canFinalize) {
            issues.add("review 변경사항이 있어 finalize를 다시 실행해야 합니다.");
            return issues;
        }

        Optional<ReviewSnapshotSummary> sftSnapshot = snapshotSummaryService.getActiveSnapshotSummary("sft");
        Optional<ReviewSnapshotSummary> preferenceSnapshot = snapshotSummaryService.getActiveSnapshotSummary("preference");
        boolean hasImportedSnapshots =
            sftSnapshot.map(ReviewSnapshotSummary::rowCount).orElse(0) > 0 ||
            preferenceSnapshot.map(ReviewSnapshotSummary::rowCount).orElse(0) > 0;

        if ("succeeded".equals(finalizeState) || hasImportedSnapshots) {
            return issues;
        }

        issues.add("먼저 finalize를 실행해 최신 학습 데이터셋을 만들어야 합니다.");
        return issues;
    }

    private String existingPathString(Path path) {
        return Files.exists(path) ? path.toString() : null;
    }
}

