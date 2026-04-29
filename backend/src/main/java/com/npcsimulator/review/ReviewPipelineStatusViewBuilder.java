package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
class ReviewPipelineStatusViewBuilder {

    private static final String JUDGE_REVIEW_SUMMARY_PATH = "data/evals/judged/judge-summary.json";
    private static final String HUMAN_REVIEW_SUMMARY_PATH = "data/review/live/human_review_summary.json";
    private static final String LLM_FIRST_PASS_SUMMARY_PATH = "data/review/live/llm_first_pass_summary.json";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;

    ReviewPipelineStatusViewBuilder(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
    }

    JsonNode getPipelineStatus(HttpHeaders headers) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("reviewTasks", buildReviewPipelineTaskCounts());
        response.set("judge", buildPipelineSummary("judge", JUDGE_REVIEW_SUMMARY_PATH));
        response.set("humanQueue", buildPipelineSummary("humanQueue", HUMAN_REVIEW_SUMMARY_PATH));
        response.set("llmFirstPass", buildPipelineSummary("llmFirstPass", LLM_FIRST_PASS_SUMMARY_PATH));
        return response;
    }

    JsonNode pipelineRunResponse(
        String stage,
        ReviewRuntimeCommandRunner.ProcessResult result,
        HttpHeaders headers
    ) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("stage", stage);
        response.put("durationMs", result.durationMs());
        response.set("stdout", nullableTextNode(blankToNull(result.stdout())));
        response.set("status", getPipelineStatus(headers));
        return response;
    }

    private ObjectNode buildPipelineSummary(String stage, String relativeSummaryPath) {
        Path summaryPath = commandRunner.resolveProjectPath(relativeSummaryPath);
        JsonNode summary = loadJsonFile(summaryPath);
        ObjectNode response = objectMapper.createObjectNode();
        response.put("stage", stage);
        response.put("exists", commandRunner.pathExists(summaryPath));
        response.set("summaryPath", nullableTextNode(summaryPath == null ? null : summaryPath.toString()));
        response.set("generatedAt", summary.isObject() ? nullableTextNode(extractText(summary, "generatedAt")) : NullNode.instance);
        response.set("summary", copyOrNull(summary));
        return response;
    }

    private ObjectNode buildReviewPipelineTaskCounts() {
        int pendingSft = 0;
        int pendingPair = 0;
        int reviewedSft = 0;
        int reviewedPair = 0;
        int llmAnnotatedSft = 0;
        int llmAnnotatedPair = 0;

        for (ReviewRepository.ReviewTaskRow task : reviewRepository.findReviewTasks()) {
            boolean reviewed = !blank(task.currentDecision());
            boolean llmAnnotated = task.llmFirstPassJson() != null && !task.llmFirstPassJson().isNull() && task.llmFirstPassJson().size() > 0;

            if ("sft".equals(task.reviewKind())) {
                if (reviewed) {
                    reviewedSft += 1;
                } else {
                    pendingSft += 1;
                }
                if (llmAnnotated) {
                    llmAnnotatedSft += 1;
                }
            } else if ("pair".equals(task.reviewKind())) {
                if (reviewed) {
                    reviewedPair += 1;
                } else {
                    pendingPair += 1;
                }
                if (llmAnnotated) {
                    llmAnnotatedPair += 1;
                }
            }
        }

        ObjectNode pending = objectMapper.createObjectNode();
        pending.put("sft", pendingSft);
        pending.put("pair", pendingPair);
        pending.put("total", pendingSft + pendingPair);

        ObjectNode reviewed = objectMapper.createObjectNode();
        reviewed.put("sft", reviewedSft);
        reviewed.put("pair", reviewedPair);
        reviewed.put("total", reviewedSft + reviewedPair);

        ObjectNode llmAnnotated = objectMapper.createObjectNode();
        llmAnnotated.put("sft", llmAnnotatedSft);
        llmAnnotated.put("pair", llmAnnotatedPair);
        llmAnnotated.put("total", llmAnnotatedSft + llmAnnotatedPair);

        ObjectNode response = objectMapper.createObjectNode();
        response.set("pending", pending);
        response.set("reviewed", reviewed);
        response.set("llmAnnotated", llmAnnotated);
        response.put("total", pendingSft + pendingPair + reviewedSft + reviewedPair);
        return response;
    }

    private JsonNode loadJsonFile(Path path) {
        if (path == null || !Files.exists(path)) {
            return NullNode.instance;
        }

        try {
            return objectMapper.readTree(Files.readString(path, StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read review pipeline summary.", error);
        }
    }

    private JsonNode copyOrNull(JsonNode value) {
        return value == null ? NullNode.instance : value.deepCopy();
    }

    private JsonNode nullableTextNode(String value) {
        return value == null ? NullNode.instance : objectMapper.getNodeFactory().textNode(value);
    }

    private String extractText(JsonNode node, String fieldName) {
        JsonNode value = node == null ? null : node.get(fieldName);
        return value != null && value.isTextual() ? value.asText() : null;
    }

    private String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value;
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
