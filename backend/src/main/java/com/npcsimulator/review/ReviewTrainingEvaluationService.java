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
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingEvaluationService {

    private static final String TOGETHER_REMOTE_PROVIDER = "together";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewTrainingArtifactService artifactService;

    ReviewTrainingEvaluationService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewTrainingArtifactService artifactService
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
        this.artifactService = artifactService;
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
            artifactService.registerTrainingArtifact(
                run.runUid(),
                "golden_eval_summary",
                summaryPath,
                objectMapper.createObjectNode()
                    .put("bindingKey", bindingKey)
                    .put("baselineLabel", baseline.label())
            );
            artifactService.registerTrainingArtifact(
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
}
