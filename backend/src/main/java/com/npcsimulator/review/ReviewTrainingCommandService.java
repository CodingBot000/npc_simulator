package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingCommandService {

    private static final String TOGETHER_REMOTE_PROVIDER = "together";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;

    ReviewTrainingCommandService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
    }

    void createAndStartTrainingRun(
        ReviewTrainingRunSpec spec,
        boolean runInline,
        String workerScript
    ) {
        boolean runCreated = false;
        try {
            writeInitialTrainingLog(spec);
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
        String startedAt = Instant.now().toString();

        reviewRepository.updateTrainingRunEvaluation(
            run.runUid(),
            "running",
            "Golden-set Evaluation 실행 중",
            bindingKey,
            baseline.label(),
            null,
            NullNode.instance,
            startedAt,
            null
        );
        reviewRepository.appendTrainingRunEvent(
            run.runUid(),
            "info",
            "golden_eval_started",
            null,
            "Golden-set Evaluation 시작",
            objectMapper.createObjectNode()
                .put("bindingKey", bindingKey)
                .put("baselineLabel", baseline.label())
        );

        try {
            if (runInline) {
                runInlineTrainingEvaluation(run, bindingKey, baseline);
            } else {
                ArrayList<String> command = new ArrayList<>(List.of(
                    commandRunner.tsxBinary().toString(),
                    commandRunner.resolveRequiredProjectPath(workerSpec.workerScript()).toString(),
                    "--run-id",
                    run.runUid(),
                    "--binding-key",
                    bindingKey,
                    "--baseline-label",
                    baseline.label(),
                    "--cases",
                    workerSpec.casesPath(),
                    "--provider",
                    workerSpec.provider()
                ));
                if (baseline.adapterPath() != null) {
                    command.add("--baseline-adapter-path");
                    command.add(baseline.adapterPath());
                }
                if (baseline.remoteProvider() != null) {
                    command.add("--baseline-remote-provider");
                    command.add(baseline.remoteProvider());
                }
                if (baseline.remoteModelName() != null) {
                    command.add("--baseline-remote-model");
                    command.add(baseline.remoteModelName());
                } else if ("together_serverless_lora".equals(run.trainingBackend()) && !blank(run.baseModel())) {
                    command.add("--baseline-remote-provider");
                    command.add(TOGETHER_REMOTE_PROVIDER);
                    command.add("--baseline-remote-model");
                    command.add(run.baseModel());
                }
                if (!blank(workerSpec.judgeModel())) {
                    command.add("--judge-model");
                    command.add(workerSpec.judgeModel());
                }
                commandRunner.startDetachedNodeCommand(command);
            }
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "Golden-set Evaluation 실행에 실패했습니다.";
            reviewRepository.updateTrainingRunEvaluation(
                run.runUid(),
                "failed",
                message,
                bindingKey,
                baseline.label(),
                null,
                NullNode.instance,
                startedAt,
                Instant.now().toString()
            );
            reviewRepository.appendTrainingRunEvent(
                run.runUid(),
                "error",
                "golden_eval_failed",
                null,
                message,
                null
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
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
        registerTrainingArtifact(
            runUid,
            "finalize_sft_manifest",
            commandRunner.resolveRequiredProjectPath(sftOutputDir).resolve("manifest.json"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_sft_train",
            commandRunner.resolveRequiredProjectPath(sftOutputDir).resolve("final_sft_train.jsonl"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_sft_dev",
            commandRunner.resolveRequiredProjectPath(sftOutputDir).resolve("final_sft_dev.jsonl"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_preference_manifest",
            commandRunner.resolveRequiredProjectPath(preferenceOutputDir).resolve("manifest.json"),
            artifactMetadata("finalize", "preference")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_preference_pairs",
            commandRunner.resolveRequiredProjectPath(preferenceOutputDir).resolve("final_preference_pairs.jsonl"),
            artifactMetadata("finalize", "preference")
        );
    }

    private void runInlineTrainingEvaluation(
        ReviewRepository.TrainingRunRow run,
        String bindingKey,
        ReviewPromotedBaseline baseline
    ) {
        String startedAt = firstNonBlank(run.evalStartedAt(), Instant.now().toString());
        Path outputDir = trainingRunRoot(run).resolve("eval").resolve(bindingKey);
        Path summaryPath = outputDir.resolve("compare-summary.json");
        Path reportPath = outputDir.resolve("compare-report.md");
        try {
            Files.createDirectories(outputDir);
            ObjectNode summary = buildSmokeTrainingEvaluationSummary(run, bindingKey, baseline, summaryPath, reportPath);
            Files.writeString(
                summaryPath,
                objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(summary) + "\n",
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
            Files.writeString(
                reportPath,
                buildSmokeTrainingEvaluationReport(summary),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );

            String finishedAt = Instant.now().toString();
            reviewRepository.updateTrainingRunEvaluation(
                run.runUid(),
                "succeeded",
                "Golden-set Evaluation 완료",
                bindingKey,
                baseline.label(),
                summaryPath.toString(),
                summary,
                startedAt,
                finishedAt
            );
            reviewRepository.appendTrainingRunEvent(
                run.runUid(),
                "info",
                "golden_eval_finished",
                null,
                "Golden-set Evaluation 완료",
                object(summary)
            );
            registerTrainingArtifact(
                run.runUid(),
                "golden_eval_summary",
                summaryPath,
                objectMapper.createObjectNode()
                    .put("bindingKey", bindingKey)
                    .put("baselineLabel", baseline.label())
            );
            registerTrainingArtifact(
                run.runUid(),
                "golden_eval_report",
                reportPath,
                objectMapper.createObjectNode()
                    .put("bindingKey", bindingKey)
                    .put("baselineLabel", baseline.label())
            );
        } catch (Exception error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "Golden-set Evaluation 실행에 실패했습니다.";
            reviewRepository.updateTrainingRunEvaluation(
                run.runUid(),
                "failed",
                message,
                bindingKey,
                baseline.label(),
                existingPathString(summaryPath),
                NullNode.instance,
                startedAt,
                Instant.now().toString()
            );
            reviewRepository.appendTrainingRunEvent(
                run.runUid(),
                "error",
                "golden_eval_failed",
                null,
                message,
                null
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    private Path trainingRunRoot(ReviewRepository.TrainingRunRow run) {
        Path datasetDir = Path.of(run.datasetWorkDir());
        Path parent = datasetDir.getParent();
        return parent == null ? datasetDir : parent;
    }

    private ObjectNode buildSmokeTrainingEvaluationSummary(
        ReviewRepository.TrainingRunRow run,
        String bindingKey,
        ReviewPromotedBaseline baseline,
        Path summaryPath,
        Path reportPath
    ) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("generatedAt", Instant.now().toString());
        root.put("benchmarkId", "reply-golden-v1");
        root.put("bindingKey", bindingKey);
        root.put("baselineLabel", baseline.label());
        root.put("candidateLabel", run.runUid());
        root.put("summaryPath", summaryPath.toString());
        root.put("reportPath", reportPath.toString());
        root.put("recommendation", "promote");
        ObjectNode winnerCounts = root.putObject("winnerCounts");
        winnerCounts.put("baseline", 1);
        winnerCounts.put("candidate", 3);
        winnerCounts.put("tie", 1);
        ObjectNode averages = root.putObject("averages");
        averages.put("baselineNaturalness", 3.2);
        averages.put("candidateNaturalness", 4.1);
        averages.put("baselinePersonaFit", 3.0);
        averages.put("candidatePersonaFit", 4.0);
        averages.put("baselineAntiMeta", 3.1);
        averages.put("candidateAntiMeta", 4.2);
        averages.put("confidence", 4.0);
        ArrayNode cases = root.putArray("cases");
        cases.add(
            objectMapper.createObjectNode()
                .put("caseId", "smoke_case_1")
                .put("winner", "candidate")
                .put("reason", "candidate reply is more direct and role-consistent")
        );
        cases.add(
            objectMapper.createObjectNode()
                .put("caseId", "smoke_case_2")
                .put("winner", "baseline")
                .put("reason", "baseline remained slightly tighter on brevity")
        );
        return root;
    }

    private String buildSmokeTrainingEvaluationReport(JsonNode summary) {
        ObjectNode winnerCounts = object(summary.get("winnerCounts"));
        ObjectNode averages = object(summary.get("averages"));
        return String.join(
            "\n",
            "# Golden Eval Smoke Report",
            "",
            "- Benchmark: " + defaultText(extractText(summary, "benchmarkId"), "reply-golden-v1"),
            "- Binding: " + defaultText(extractText(summary, "bindingKey"), "default"),
            "- Baseline: " + defaultText(extractText(summary, "baselineLabel"), "base_model"),
            "- Candidate: " + defaultText(extractText(summary, "candidateLabel"), "unknown"),
            "- Recommendation: " + defaultText(extractText(summary, "recommendation"), "hold"),
            "",
            "| Winner | Count |",
            "| --- | ---: |",
            "| baseline | " + defaultText(String.valueOf(winnerCounts.path("baseline").asInt(0)), "0") + " |",
            "| candidate | " + defaultText(String.valueOf(winnerCounts.path("candidate").asInt(0)), "0") + " |",
            "| tie | " + defaultText(String.valueOf(winnerCounts.path("tie").asInt(0)), "0") + " |",
            "",
            "| Metric | Baseline | Candidate |",
            "| --- | ---: | ---: |",
            "| Naturalness | " + defaultText(String.valueOf(averages.path("baselineNaturalness").asDouble(0)), "0") + " | " + defaultText(String.valueOf(averages.path("candidateNaturalness").asDouble(0)), "0") + " |",
            "| Persona Fit | " + defaultText(String.valueOf(averages.path("baselinePersonaFit").asDouble(0)), "0") + " | " + defaultText(String.valueOf(averages.path("candidatePersonaFit").asDouble(0)), "0") + " |",
            "| Anti-Meta | " + defaultText(String.valueOf(averages.path("baselineAntiMeta").asDouble(0)), "0") + " | " + defaultText(String.valueOf(averages.path("candidateAntiMeta").asDouble(0)), "0") + " |",
            ""
        );
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

            ReviewRuntimeCommandRunner.ProcessResult buildResult = runLoggedCommand(spec.commands().build(), spec.logPath());
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
            registerTrainingDatasetArtifacts(spec);

            ReviewRuntimeCommandRunner.ProcessResult trainResult = runLoggedCommand(spec.commands().train(), spec.logPath());
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
                runLoggedCommand(spec.commands().derive(), spec.logPath());
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
            registerTrainingArtifact(
                spec.runUid(),
                "log_file",
                Path.of(spec.logPath()),
                trainingArtifactMetadata(spec, "worker_log")
            );
            registerTrainingArtifact(
                spec.runUid(),
                "canonical_adapter_output",
                spec.adapterPath() == null ? null : Path.of(spec.adapterPath()),
                trainingArtifactMetadata(spec, "training_output")
                    .put("adapterVersion", spec.runUid())
            );
            registerTrainingArtifact(
                spec.runUid(),
                "runtime_artifact_output",
                spec.runtimeArtifactPath() == null ? null : Path.of(spec.runtimeArtifactPath()),
                trainingArtifactMetadata(spec, "training_output")
            );
            registerTrainingArtifact(
                spec.runUid(),
                "training_result_manifest",
                Path.of(spec.trainingResultPath()),
                trainingArtifactMetadata(spec, "training_result_manifest")
            );
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "학습 실행에 실패했습니다.";
            appendLog(spec.logPath(), "\n[failed] " + message + "\n");
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
            registerTrainingArtifact(
                spec.runUid(),
                "log_file",
                Path.of(spec.logPath()),
                trainingArtifactMetadata(spec, "worker_log_failed")
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    private ReviewRuntimeCommandRunner.ProcessResult runLoggedCommand(ReviewCommandSpec command, String logPath) {
        appendLog(logPath, "\n$ " + commandToString(command) + "\n");
        ReviewRuntimeCommandRunner.ProcessResult result = commandRunner.runNodeCommand(commandToList(command));
        if (blankToNull(result.stdout()) != null) {
            appendLog(logPath, result.stdout() + "\n");
        }
        if (blankToNull(result.stderr()) != null) {
            appendLog(logPath, result.stderr() + "\n");
        }
        return result;
    }

    private void registerTrainingDatasetArtifacts(ReviewTrainingRunSpec spec) {
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_manifest",
            Path.of(spec.datasetDir()).resolve("manifest.json"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_train",
            Path.of(spec.datasetDir()).resolve("train.jsonl"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_valid",
            Path.of(spec.datasetDir()).resolve("valid.jsonl"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
    }

    private ObjectNode trainingArtifactMetadata(ReviewTrainingRunSpec spec, String artifactPhase) {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("runId", spec.runUid());
        metadata.put("kind", spec.kind());
        metadata.put("canonicalModelFamily", spec.canonicalModelFamily());
        metadata.put("artifactPhase", artifactPhase);
        metadata.put("baseModel", spec.baseModel());
        metadata.put("trainingBackend", spec.trainingBackend());
        metadata.put("sourceDatasetVersion", spec.sourceDatasetVersion());
        metadata.put("sourceFingerprint", spec.sourceFingerprint());
        if (spec.adapterPath() == null) {
            metadata.putNull("canonicalAdapterPath");
        } else {
            metadata.put("canonicalAdapterPath", spec.adapterPath());
        }
        if (spec.runtimeArtifactPath() == null) {
            metadata.putNull("runtimeArtifactPath");
        } else {
            metadata.put("runtimeArtifactPath", spec.runtimeArtifactPath());
        }
        if (spec.runtimeArtifactKind() == null) {
            metadata.putNull("runtimeArtifactKind");
        } else {
            metadata.put("runtimeArtifactKind", spec.runtimeArtifactKind());
        }
        if (spec.remoteProvider() == null) {
            metadata.putNull("remoteProvider");
        } else {
            metadata.put("remoteProvider", spec.remoteProvider());
        }
        return metadata;
    }

    private ObjectNode artifactMetadata(String pipeline, String datasetKind) {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("pipeline", pipeline);
        metadata.put("datasetKind", datasetKind);
        return metadata;
    }

    private void registerTrainingArtifact(
        String runUid,
        String artifactKind,
        Path artifactPath,
        JsonNode metadataJson
    ) {
        if (artifactPath == null || !Files.exists(artifactPath)) {
            return;
        }

        Long fileSizeBytes = null;
        String sha256 = null;
        try {
            if (Files.isRegularFile(artifactPath)) {
                fileSizeBytes = Files.size(artifactPath);
                sha256 = sha256Hex(artifactPath);
            }
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to inspect artifact: " + artifactPath, error);
        }

        reviewRepository.insertTrainingRunArtifact(
            runUid,
            artifactKind,
            artifactPath.toString(),
            fileSizeBytes,
            sha256,
            metadataJson
        );
    }

    private void appendLog(String logPath, String text) {
        try {
            Path path = Path.of(logPath);
            Files.createDirectories(path.getParent());
            Files.writeString(
                path,
                text,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to append training log.", error);
        }
    }

    private String sha256Hex(Path path) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(Files.readAllBytes(path));
            byte[] hashed = digest.digest();
            StringBuilder builder = new StringBuilder();
            for (byte value : hashed) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to hash artifact: " + path, error);
        }
    }

    private void writeInitialTrainingLog(ReviewTrainingRunSpec spec) {
        try {
            Path logPath = Path.of(spec.logPath());
            Files.createDirectories(logPath.getParent());
            Files.createDirectories(Path.of(spec.outputRootDir()));
            String content = String.join(
                "\n",
                "runId=" + spec.runUid(),
                "kind=" + spec.kind(),
                "trainingBackend=" + spec.trainingBackend(),
                "build=" + commandToString(spec.commands().build()),
                "train=" + commandToString(spec.commands().train()),
                "derive=" + commandToString(spec.commands().derive()),
                ""
            );
            Files.writeString(
                logPath,
                content,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to initialize training log.", error);
        }
    }

    private String commandToString(ReviewCommandSpec command) {
        if (command == null) {
            return "-";
        }
        List<String> parts = new ArrayList<>();
        parts.add(command.command());
        parts.addAll(command.args());
        return parts.stream()
            .map(entry -> entry.contains(" ") ? "\"" + entry + "\"" : entry)
            .reduce((left, right) -> left + " " + right)
            .orElse("");
    }

    private List<String> commandToList(ReviewCommandSpec command) {
        ArrayList<String> parts = new ArrayList<>();
        parts.add(command.command());
        parts.addAll(command.args());
        return parts;
    }

    private String existingPathString(Path path) {
        return Files.exists(path) ? path.toString() : null;
    }

    private ObjectNode object(JsonNode node) {
        return node != null && node.isObject() ? (ObjectNode) node : objectMapper.createObjectNode();
    }

    private String extractText(JsonNode node, String field) {
        if (node == null || node.get(field) == null || node.get(field).isNull()) {
            return null;
        }
        return node.get(field).asText();
    }

    private String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String firstNonBlank(String first, String second) {
        return !blank(first) ? first : (!blank(second) ? second : null);
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value;
    }
}
