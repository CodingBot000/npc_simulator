package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewPipelineCommandService {

    private static final String JUDGE_REVIEW_QUEUE_SCRIPT = "backend/scripts/judge-review-queue.mjs";
    private static final String PREPARE_HUMAN_REVIEW_SCRIPT = "backend/scripts/prepare-human-review.mjs";
    private static final String LLM_FIRST_PASS_REVIEW_QUEUE_SCRIPT = "backend/scripts/llm-first-pass-review-queue.mjs";

    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewPipelineStatusViewBuilder pipelineStatusViewBuilder;
    private final ReviewJsonSupport json;
    private final String datasourceUrl;

    ReviewPipelineCommandService(
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewPipelineStatusViewBuilder pipelineStatusViewBuilder,
        ReviewJsonSupport json,
        @Value("${spring.datasource.url:}") String datasourceUrl
    ) {
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
        this.pipelineStatusViewBuilder = pipelineStatusViewBuilder;
        this.json = json;
        this.datasourceUrl = datasourceUrl;
    }

    JsonNode runJudgeReviewQueue(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String mode = json.optionalEnum(
            payload,
            "mode",
            List.of("heuristic", "llm", "hybrid"),
            "잘못된 review judge mode 입니다."
        );
        String provider = json.optionalEnum(
            payload,
            "provider",
            List.of("codex", "openai"),
            "잘못된 review judge provider 입니다."
        );
        Integer limit = json.optionalPositiveInteger(payload, "limit", "review judge limit 는 1 이상의 정수여야 합니다.");
        boolean dryRun = json.optionalBoolean(payload, "dryRun", false);
        boolean verbose = json.optionalBoolean(payload, "verbose", false);

        ArrayList<String> command = new ArrayList<>(List.of(
            commandRunner.tsxBinary().toString(),
            commandRunner.resolveRequiredProjectPath(JUDGE_REVIEW_QUEUE_SCRIPT).toString()
        ));
        addOptionalArgument(command, "--input", json.trimToNull(json.extractText(payload, "input")));
        addOptionalArgument(command, "--output", json.trimToNull(json.extractText(payload, "output")));
        addOptionalArgument(command, "--mode", mode);
        addOptionalArgument(command, "--provider", provider);
        addOptionalIntegerArgument(command, "--limit", limit);
        addOptionalFlag(command, "--dry-run", dryRun);
        addOptionalFlag(command, "--verbose", verbose);

        ReviewRuntimeCommandRunner.ProcessResult result = commandRunner.runNodeCommand(command);
        return pipelineStatusViewBuilder.pipelineRunResponse("judge", result, headers);
    }

    JsonNode runPrepareHumanReview(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        boolean skipDbSync = json.optionalBoolean(payload, "skipDbSync", false);
        requirePostgresReviewPipelineSync(skipDbSync, "prepare-human-review");

        ArrayList<String> command = new ArrayList<>(List.of(
            commandRunner.tsxBinary().toString(),
            commandRunner.resolveRequiredProjectPath(PREPARE_HUMAN_REVIEW_SCRIPT).toString()
        ));
        addOptionalArgument(command, "--review-input", json.trimToNull(json.extractText(payload, "reviewInput")));
        addOptionalArgument(command, "--pairs-input", json.trimToNull(json.extractText(payload, "pairsInput")));
        addOptionalArgument(command, "--collector-input", json.trimToNull(json.extractText(payload, "collectorInput")));
        addOptionalArgument(command, "--output-dir", json.trimToNull(json.extractText(payload, "outputDir")));
        addOptionalFlag(command, "--skip-db-sync", skipDbSync);

        ReviewRuntimeCommandRunner.ProcessResult result = commandRunner.runNodeCommand(command);
        return pipelineStatusViewBuilder.pipelineRunResponse("prepare_human_review", result, headers);
    }

    JsonNode runReviewLlmFirstPass(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        boolean skipDbSync = json.optionalBoolean(payload, "skipDbSync", false);
        requirePostgresReviewPipelineSync(skipDbSync, "llm-first-pass-review-queue");
        String provider = json.optionalEnum(
            payload,
            "provider",
            List.of("codex", "openai"),
            "잘못된 llm first-pass provider 입니다."
        );

        ArrayList<String> command = new ArrayList<>(List.of(
            commandRunner.tsxBinary().toString(),
            commandRunner.resolveRequiredProjectPath(LLM_FIRST_PASS_REVIEW_QUEUE_SCRIPT).toString()
        ));
        addOptionalArgument(command, "--sft-input", json.trimToNull(json.extractText(payload, "sftInput")));
        addOptionalArgument(command, "--pair-input", json.trimToNull(json.extractText(payload, "pairInput")));
        addOptionalArgument(command, "--output-dir", json.trimToNull(json.extractText(payload, "outputDir")));
        addOptionalArgument(command, "--provider", provider);
        addOptionalFlag(command, "--skip-db-sync", skipDbSync);

        ReviewRuntimeCommandRunner.ProcessResult result = commandRunner.runNodeCommand(command);
        return pipelineStatusViewBuilder.pipelineRunResponse("llm_first_pass", result, headers);
    }

    private void requirePostgresReviewPipelineSync(boolean skipDbSync, String stageName) {
        if (skipDbSync) {
            return;
        }
        if (json.blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:") || !datasourceUrl.matches("(?i)^jdbc:postgres(?:ql)?:.*")) {
            throw new ReviewApiException(HttpStatus.CONFLICT, stageName + " DB sync는 Postgres 환경에서만 지원합니다.");
        }
    }

    private void addOptionalArgument(List<String> command, String flag, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        command.add(flag);
        command.add(value);
    }

    private void addOptionalIntegerArgument(List<String> command, String flag, Integer value) {
        if (value == null) {
            return;
        }
        command.add(flag);
        command.add(String.valueOf(value));
    }

    private void addOptionalFlag(List<String> command, String flag, boolean enabled) {
        if (!enabled) {
            return;
        }
        command.add(flag);
    }
}

