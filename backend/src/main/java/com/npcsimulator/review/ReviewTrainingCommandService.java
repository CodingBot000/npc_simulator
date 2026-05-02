package com.npcsimulator.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingCommandService {

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewTrainingLogService logService;
    private final ReviewTrainingArtifactService artifactService;
    private final ReviewTrainingEvaluationService evaluationService;

    ReviewTrainingCommandService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewTrainingLogService logService,
        ReviewTrainingArtifactService artifactService,
        ReviewTrainingEvaluationService evaluationService
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
        this.logService = logService;
        this.artifactService = artifactService;
        this.evaluationService = evaluationService;
    }

    void createAndStartTrainingRun(
        ReviewTrainingRunSpec spec,
        boolean runInline,
        String workerScript
    ) {
        boolean runCreated = false;
        try {
            logService.writeInitialTrainingLog(spec);
            reviewRepository.createTrainingRun(
                spec.runUid(),
                spec.kind(),
                spec.trainingBackend(),
                spec.canonicalModelFamily(),
                "running",
                "build_dataset",
                "sft".equals(spec.kind()) ? "SFT 학습 데이터셋 준비 중" : "DPO 학습 데이터셋 준비 중",
                spec.sourceSnapshotId(),
                spec.sourceFingerprint(),
                spec.sourceDatasetVersion(),
                spec.parentRunUid(),
                spec.baseModel(),
                spec.datasetDir(),
                spec.adapterPath(),
                spec.runtimeArtifactPath(),
                spec.runtimeArtifactKind(),
                spec.remoteProvider(),
                null,
                null,
                null,
                null,
                spec.logPath(),
                spec.trainingResultPath(),
                spec.fingerprint(),
                spec.commands()
            );
            runCreated = true;
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "run_created",
                "build_dataset",
                "sft".equals(spec.kind()) ? "새로운 SFT Base 생성 시작" : "DPO 학습 시작",
                null
            );

            if (runInline) {
                runInlineTraining(spec);
            } else {
                commandRunner.startDetachedNodeCommand(List.of(
                    commandRunner.tsxBinary().toString(),
                    commandRunner.resolveRequiredProjectPath(workerScript).toString(),
                    "--run-id",
                    spec.runUid()
                ));
            }
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "학습 실행에 실패했습니다.";

            if (runCreated && !runInline) {
                reviewRepository.appendTrainingRunEvent(
                    spec.runUid(),
                    "error",
                    "worker_launch_failed",
                    null,
                    message,
                    null
                );
                reviewRepository.updateTrainingRunState(
                    spec.runUid(),
                    "failed",
                    null,
                    message,
                    Instant.now().toString(),
                    spec.trainingBackend(),
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
            }

            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    void startTrainingEvaluation(
        ReviewRepository.TrainingRunRow run,
        String bindingKey,
        ReviewPromotedBaseline baseline,
        boolean runInline,
        ReviewTrainingEvaluationWorkerSpec workerSpec
    ) {
        evaluationService.startTrainingEvaluation(run, bindingKey, baseline, runInline, workerSpec);
    }

    void updateTrainingDecision(
        ReviewRepository.TrainingRunRow run,
        String decision,
        String reviewer,
        String notes
    ) {
        if (!"succeeded".equals(run.state())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "성공한 학습 run만 채택 여부를 결정할 수 있습니다.");
        }
        if (!"succeeded".equals(run.evalState())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation이 완료된 뒤에만 채택 여부를 결정할 수 있습니다.");
        }

        String reviewedAt = Instant.now().toString();
        reviewRepository.updateTrainingRunReviewDecision(
            run.runUid(),
            decision,
            notes,
            reviewer,
            reviewedAt
        );
        reviewRepository.appendTrainingRunEvent(
            run.runUid(),
            "info",
            "training_review_decided",
            null,
            "accepted".equals(decision) ? "학습 run 채택" : "학습 run 반려",
            objectMapper.createObjectNode()
                .put("decision", decision)
                .put("reviewer", defaultText(reviewer, "unknown"))
        );
    }

    void promoteTrainingRun(ReviewRepository.TrainingRunRow run, String bindingKey) {
        if (!"succeeded".equals(run.state())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "성공한 학습 run만 Model Promotion 할 수 있습니다.");
        }
        if (!"accepted".equals(run.reviewDecision())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "채택된 학습 run만 Model Promotion 할 수 있습니다.");
        }
        boolean hasLocalArtifact =
            !blank(run.outputAdapterPath()) && commandRunner.pathExists(Path.of(run.outputAdapterPath()));
        boolean hasRemoteModel = !blank(run.remoteModelName());
        if (!hasLocalArtifact && !hasRemoteModel) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "Model Promotion 할 산출물을 찾지 못했습니다.");
        }

        String promotedAt = Instant.now().toString();
        reviewRepository.markTrainingRunPromoted(run.runUid(), bindingKey, promotedAt);
        reviewRepository.appendTrainingRunEvent(
            run.runUid(),
            "info",
            "training_promoted",
            null,
            "Model Promotion 적용",
            objectMapper.createObjectNode()
                .put("bindingKey", bindingKey)
                .put("adapterPath", run.outputAdapterPath())
                .put("remoteModelName", run.remoteModelName())
        );
    }

    void registerFinalizeArtifacts(
        String runUid,
        String sftOutputDir,
        String preferenceOutputDir
    ) {
        artifactService.registerFinalizeArtifacts(runUid, sftOutputDir, preferenceOutputDir);
    }

    private void runInlineTraining(ReviewTrainingRunSpec spec) {
        long startedAtMs = System.currentTimeMillis();
        try {
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "dataset_build_started",
                "build_dataset",
                "sft".equals(spec.kind()) ? "SFT 데이터셋 생성 시작" : "DPO 데이터셋 생성 시작",
                null
            );

            ReviewRuntimeCommandRunner.ProcessResult buildResult = logService.runLoggedCommand(spec.commands().build(), spec.logPath());
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "dataset_build_finished",
                "sft".equals(spec.kind()) ? "train_sft" : "train_dpo",
                "sft".equals(spec.kind()) ? "SFT 데이터셋 생성 완료" : "DPO 데이터셋 생성 완료",
                objectMapper.createObjectNode().put("buildMs", buildResult.durationMs())
            );
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "running",
                "sft".equals(spec.kind()) ? "train_sft" : "train_dpo",
                "sft".equals(spec.kind()) ? "새로운 SFT Base 생성 중" : "DPO 학습 실행 중",
                null,
                spec.trainingBackend(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                new ReviewRepository.TrainingDurations(
                    buildResult.durationMs(),
                    null,
                    null
                )
            );
            artifactService.registerTrainingDatasetArtifacts(spec);

            ReviewRuntimeCommandRunner.ProcessResult trainResult = logService.runLoggedCommand(spec.commands().train(), spec.logPath());
            if (spec.commands().derive() != null) {
                reviewRepository.appendTrainingRunEvent(
                    spec.runUid(),
                    "info",
                    "runtime_derivation_started",
                    "derive_runtime",
                    "MLX runtime artifact 생성 시작",
                    null
                );
                reviewRepository.updateTrainingRunState(
                    spec.runUid(),
                    "running",
                    "derive_runtime",
                    "MLX runtime artifact 생성 중",
                    null,
                    spec.trainingBackend(),
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    new ReviewRepository.TrainingDurations(
                        buildResult.durationMs(),
                        trainResult.durationMs(),
                        null
                    )
                );
                logService.runLoggedCommand(spec.commands().derive(), spec.logPath());
            }
            String finishedAt = Instant.now().toString();
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "succeeded",
                null,
                "sft".equals(spec.kind()) ? "SFT 학습 완료" : "DPO 학습 완료",
                finishedAt,
                spec.trainingBackend(),
                spec.adapterPath(),
                spec.runUid(),
                spec.runtimeArtifactPath(),
                spec.runtimeArtifactKind(),
                spec.remoteProvider(),
                null,
                null,
                null,
                null,
                new ReviewRepository.TrainingDurations(
                    buildResult.durationMs(),
                    trainResult.durationMs(),
                    System.currentTimeMillis() - startedAtMs
                )
            );
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "trainer_finished",
                null,
                "sft".equals(spec.kind()) ? "SFT 학습 완료" : "DPO 학습 완료",
                objectMapper.createObjectNode()
                    .put("buildMs", buildResult.durationMs())
                    .put("trainMs", trainResult.durationMs())
            );
            artifactService.registerTrainingArtifact(
                spec.runUid(),
                "log_file",
                Path.of(spec.logPath()),
                artifactService.trainingArtifactMetadata(spec, "worker_log")
            );
            artifactService.registerTrainingArtifact(
                spec.runUid(),
                "canonical_adapter_output",
                spec.adapterPath() == null ? null : Path.of(spec.adapterPath()),
                artifactService.trainingArtifactMetadata(spec, "training_output")
                    .put("adapterVersion", spec.runUid())
            );
            artifactService.registerTrainingArtifact(
                spec.runUid(),
                "runtime_artifact_output",
                spec.runtimeArtifactPath() == null ? null : Path.of(spec.runtimeArtifactPath()),
                artifactService.trainingArtifactMetadata(spec, "training_output")
            );
            artifactService.registerTrainingArtifact(
                spec.runUid(),
                "training_result_manifest",
                Path.of(spec.trainingResultPath()),
                artifactService.trainingArtifactMetadata(spec, "training_result_manifest")
            );
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "학습 실행에 실패했습니다.";
            logService.appendLog(spec.logPath(), "\n[failed] " + message + "\n");
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "error",
                "trainer_failed",
                null,
                message,
                null
            );
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "failed",
                null,
                message,
                Instant.now().toString(),
                spec.trainingBackend(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            artifactService.registerTrainingArtifact(
                spec.runUid(),
                "log_file",
                Path.of(spec.logPath()),
                artifactService.trainingArtifactMetadata(spec, "worker_log_failed")
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    private String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
