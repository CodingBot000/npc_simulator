package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewDashboardQueryService {

    private static final String DEFAULT_NOTES = "";
    private static final String EPISODE_EXPORT_DIR = "data/datasets/episodes";
    private static final int SHADOW_INVALID_CASE_LIMIT = 8;

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;

    ReviewDashboardQueryService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
    }

    JsonNode getDashboard(HttpHeaders headers) {
        List<ReviewRepository.ReviewTaskRow> tasks = reviewRepository.findReviewTasks();
        List<ReviewRepository.CandidateRow> candidates = reviewRepository.findCandidates();
        List<ReviewRepository.PairRow> pairs = reviewRepository.findPairs();

        Map<Long, ReviewRepository.CandidateRow> candidateMap = new LinkedHashMap<>();
        for (ReviewRepository.CandidateRow row : candidates) {
            candidateMap.put(row.id(), row);
        }
        Map<Long, ReviewRepository.PairRow> pairMap = new LinkedHashMap<>();
        for (ReviewRepository.PairRow row : pairs) {
            pairMap.put(row.id(), row);
        }

        ArrayNode humanSftItems = objectMapper.createArrayNode();
        ArrayNode humanPairItems = objectMapper.createArrayNode();
        LinkedHashSet<String> sourceRowKeys = new LinkedHashSet<>();
        LinkedHashSet<String> pairKeys = new LinkedHashSet<>();

        for (ReviewRepository.ReviewTaskRow task : tasks) {
            if ("sft".equals(task.reviewKind()) && task.sftCandidateId() != null) {
                ReviewRepository.CandidateRow candidate = candidateMap.get(task.sftCandidateId());
                if (candidate != null) {
                    ObjectNode item = buildSftItemView(task, candidate);
                    humanSftItems.add(item);

                    String sourceRowKey = firstNonBlank(
                        extractText(object(taskSelectionSource(candidate.metadataJson())), "sourceRowId"),
                        candidate.rowKey()
                    );
                    if (sourceRowKey != null) {
                        sourceRowKeys.add(sourceRowKey);
                    }
                }
                continue;
            }

            if ("pair".equals(task.reviewKind()) && task.preferencePairId() != null) {
                ReviewRepository.PairRow pair = pairMap.get(task.preferencePairId());
                if (pair == null || pair.chosenCandidateId() == null || pair.rejectedCandidateId() == null) {
                    continue;
                }

                ReviewRepository.CandidateRow chosen = candidateMap.get(pair.chosenCandidateId());
                ReviewRepository.CandidateRow rejected = candidateMap.get(pair.rejectedCandidateId());
                if (chosen != null && rejected != null) {
                    ObjectNode item = buildPairItemView(task, pair, chosen, rejected);
                    humanPairItems.add(item);
                    if (pair.pairKey() != null && !pair.pairKey().isBlank()) {
                        pairKeys.add(pair.pairKey());
                    }
                }
            }
        }

        ArrayNode completedSftItems = objectMapper.createArrayNode();
        for (JsonNode entry : loadJsonl(commandRunner.resolveProjectPath("data/evals/judged/judged-review-live.jsonl"))) {
            String rowId = extractText(entry, "rowId");
            if (rowId == null || !sourceRowKeys.contains(rowId)) {
                completedSftItems.add(buildCompletedSftItemView(object(entry)));
            }
        }

        ArrayNode completedPairItems = objectMapper.createArrayNode();
        for (JsonNode entry : loadJsonl(commandRunner.resolveProjectPath("data/evals/preference/candidate_pairs_live_gap1.jsonl"))) {
            String pairId = extractText(entry, "pairId");
            if (pairId == null || !pairKeys.contains(pairId)) {
                completedPairItems.add(buildCompletedPairItemView(object(entry)));
            }
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.set("humanRequired", datasetView(humanSftItems, humanPairItems));
        response.set("llmCompleted", datasetView(completedSftItems, completedPairItems));
        response.set("shadowInvalidJson", buildShadowInvalidJsonSummary());
        return response;
    }

    ObjectNode buildSftItemView(
        ReviewRepository.ReviewTaskRow task,
        ReviewRepository.CandidateRow candidate
    ) {
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "sft");
        item.put("reviewId", defaultText(task.reviewUid(), "sft:" + defaultText(candidate.rowKey(), String.valueOf(candidate.id()))));
        item.set("bucket", nullableTextNode(task.bucket()));
        item.set("priority", nullableTextNode(task.priority()));
        item.put("status", defaultText(task.status(), task.currentDecision() == null ? "pending" : "reviewed"));
        item.set("decision", nullableTextNode(task.currentDecision()));
        item.set("reviewer", nullableTextNode(task.currentReviewer()));
        item.set("reviewedAt", nullableTextNode(task.currentReviewedAt()));
        item.put("notes", defaultText(task.currentNotes(), DEFAULT_NOTES));
        item.set("queueReason", nullableTextNode(task.queueReason()));
        item.set("source", buildSourceView(task, candidate));
        item.set("judge", buildJudgeView(candidate.judgeResultJson()));
        item.set("weightedJudgeScore", nullableNumberNode(candidate.weightedJudgeScore()));
        item.set("prompt", buildPromptView(candidate.promptBundleJson()));
        item.set("candidate", buildCandidateView(candidate.assistantOutputJson()));
        item.set("llmFirstPass", buildLlmFirstPassView(task.llmFirstPassJson()));
        return item;
    }

    ObjectNode buildPairItemView(
        ReviewRepository.ReviewTaskRow task,
        ReviewRepository.PairRow pair,
        ReviewRepository.CandidateRow chosen,
        ReviewRepository.CandidateRow rejected
    ) {
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "pair");
        item.put("reviewId", defaultText(task.reviewUid(), "pair:" + defaultText(pair.pairKey(), String.valueOf(pair.id()))));
        item.put("pairId", defaultText(pair.pairKey(), ""));
        item.set("priority", nullableTextNode(task.priority()));
        item.put("status", defaultText(task.status(), task.currentDecision() == null ? "pending" : "reviewed"));
        item.set("decision", nullableTextNode(task.currentDecision()));
        item.set("reviewer", nullableTextNode(task.currentReviewer()));
        item.set("reviewedAt", nullableTextNode(task.currentReviewedAt()));
        item.put("notes", defaultText(task.currentNotes(), DEFAULT_NOTES));
        item.set("weightedGap", nullableNumberNode(pair.weightedGap()));
        item.set("pairReason", stringArray(pair.pairReasonJson(), 8));
        item.set("prompt", buildPromptView(pair.promptBundleJson()));
        item.set("chosen", buildCandidateView(buildPairCandidateSummary(chosen)));
        item.set("rejected", buildCandidateView(buildPairCandidateSummary(rejected)));
        item.set("llmFirstPass", buildLlmFirstPassView(task.llmFirstPassJson()));
        return item;
    }

    private ObjectNode buildCompletedSftItemView(ObjectNode raw) {
        ObjectNode judge = object(raw.get("judge"));
        ObjectNode finalJudge = object(judge.get("final"));
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "sft");
        item.put("reviewId", "auto:" + defaultText(extractText(raw, "rowId"), "unknown-row"));
        item.set("bucket", nullableTextNode(extractText(finalJudge, "verdict")));
        item.set("priority", NullNode.instance);
        item.put("status", "reviewed");
        item.set("decision", NullNode.instance);
        item.set("reviewer", NullNode.instance);
        item.set("reviewedAt", NullNode.instance);
        item.put("notes", "");
        item.set("queueReason", NullNode.instance);
        item.set("source", buildSourceViewFromPipelineRecord(raw));
        item.set("judge", buildJudgeView(finalJudge));
        item.set("weightedJudgeScore", NullNode.instance);
        item.set("prompt", buildPromptView(raw.get("promptBundle")));
        item.set("candidate", buildCandidateView(raw));
        item.set("llmFirstPass", buildLlmFirstPassFromJudge(judge));
        return item;
    }

    private ObjectNode buildCompletedPairItemView(ObjectNode raw) {
        ObjectNode judge = object(raw.get("judge"));
        ObjectNode finalJudge = object(judge.get("final"));
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "pair");
        item.put("reviewId", "auto:" + defaultText(extractText(raw, "pairId"), "unknown-pair"));
        item.put("pairId", defaultText(extractText(raw, "pairId"), ""));
        item.set("priority", NullNode.instance);
        item.put("status", "reviewed");
        item.set("decision", NullNode.instance);
        item.set("reviewer", NullNode.instance);
        item.set("reviewedAt", NullNode.instance);
        item.put("notes", "");
        item.set("weightedGap", nullableNumberNode(extractNumber(raw, "weightedGap")));
        item.set("pairReason", stringArray(raw.get("pairReason"), 8));
        item.set("prompt", buildPromptView(raw.get("promptBundle")));
        item.set("chosen", buildCandidateView(object(raw.get("chosenCandidate"))));
        item.set("rejected", buildCandidateView(object(raw.get("rejectedCandidate"))));
        item.set("llmFirstPass", buildLlmFirstPassFromJudge(judge));
        return item;
    }

    private ObjectNode buildSourceView(ReviewRepository.ReviewTaskRow task, ReviewRepository.CandidateRow candidate) {
        ObjectNode metadata = object(candidate.metadataJson());
        ObjectNode promptBundle = object(candidate.promptBundleJson());
        ObjectNode source = object(metadata.get("source"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("episodeId", nullableTextNode(firstNonBlank(extractText(source, "episodeId"), extractText(promptBundle, "episodeId"))));
        response.put("scenarioId", defaultText(firstNonBlank(extractText(source, "scenarioId"), extractText(promptBundle, "scenarioId")), "unknown-scenario"));
        response.set("turnIndex", nullableNumberNode(firstNonNull(extractNumber(source, "turnIndex"), extractNumber(promptBundle, "turnIndex"))));
        response.put("npcId", defaultText(firstNonBlank(extractText(source, "npcId"), extractText(promptBundle, "npcId")), "unknown"));
        response.set("targetNpcId", nullableTextNode(firstNonBlank(extractText(source, "targetNpcId"), extractText(promptBundle, "targetNpcId"))));
        response.set("strategyLabel", nullableTextNode(firstNonBlank(extractText(source, "strategyLabel"), candidate.strategyLabel())));
        response.set("exportPath", nullableTextNode(firstNonBlank(extractText(source, "exportPath"), candidate.sourceExportPath())));
        response.set("sourceLabel", nullableTextNode(firstNonBlank(extractText(source, "sourceLabel"), candidate.sourceLabel())));
        return response;
    }

    private ObjectNode buildSourceViewFromPipelineRecord(ObjectNode raw) {
        ObjectNode prompt = object(raw.get("promptBundle"));
        ObjectNode source = object(raw.get("source"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("episodeId", nullableTextNode(extractText(prompt, "episodeId")));
        response.put("scenarioId", defaultText(extractText(prompt, "scenarioId"), "unknown-scenario"));
        response.set("turnIndex", nullableNumberNode(extractNumber(prompt, "turnIndex")));
        response.put("npcId", defaultText(extractText(prompt, "npcId"), "unknown"));
        response.set("targetNpcId", nullableTextNode(extractText(prompt, "targetNpcId")));
        response.set("strategyLabel", NullNode.instance);
        response.set("exportPath", nullableTextNode(extractText(source, "path")));
        response.set("sourceLabel", nullableTextNode(extractText(source, "label")));
        return response;
    }

    private ObjectNode buildPromptView(JsonNode rawPrompt) {
        ObjectNode prompt = object(rawPrompt);
        ObjectNode response = objectMapper.createObjectNode();
        response.set("episodeId", nullableTextNode(extractText(prompt, "episodeId")));
        response.put("scenarioId", defaultText(extractText(prompt, "scenarioId"), "unknown-scenario"));
        response.set("turnIndex", nullableNumberNode(extractNumber(prompt, "turnIndex")));
        response.put("npcId", defaultText(extractText(prompt, "npcId"), "unknown"));
        response.set("targetNpcId", nullableTextNode(extractText(prompt, "targetNpcId")));
        response.put("inputMode", defaultText(extractText(prompt, "inputMode"), "free_text"));
        String playerText = defaultText(extractText(prompt, "playerText"), "");
        response.put("playerText", playerText);
        response.put("normalizedInputSummary", defaultText(extractText(prompt, "normalizedInputSummary"), playerText));
        response.set("promptContextSummary", nullableTextNode(extractText(prompt, "promptContextSummary")));
        response.set("retrievedMemorySummaries", extractNestedStringArray(prompt.get("retrievedMemories"), "summary", 4));
        response.set("retrievedKnowledgeTitles", extractKnowledgeTitles(prompt.get("retrievedKnowledge"), 6));
        return response;
    }

    private JsonNode buildJudgeView(JsonNode rawJudge) {
        ObjectNode judge = object(rawJudge);
        if (!judge.fieldNames().hasNext()) {
            return NullNode.instance;
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.set("responseQuality", nullableNumberNode(extractNumber(judge, "responseQuality")));
        response.set("structuredImpactQuality", nullableNumberNode(extractNumber(judge, "structuredImpactQuality")));
        response.set("groundingQuality", nullableNumberNode(extractNumber(judge, "groundingQuality")));
        response.set("personaConsistency", nullableNumberNode(extractNumber(judge, "personaConsistency")));
        response.set("inspectorUsefulness", nullableNumberNode(extractNumber(judge, "inspectorUsefulness")));
        response.set("verdict", nullableTextNode(extractText(judge, "verdict")));
        response.set("reasons", stringArray(judge.get("reasons"), 6));
        return response;
    }

    private JsonNode buildLlmFirstPassView(JsonNode rawLlm) {
        ObjectNode llm = object(rawLlm);
        if (!llm.fieldNames().hasNext()) {
            return NullNode.instance;
        }

        ObjectNode scores = object(llm.get("scores"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("provider", nullableTextNode(extractText(llm, "provider")));
        response.set("suggestedDecision", nullableTextNode(extractText(llm, "suggestedDecision")));
        response.set("verdict", nullableTextNode(extractText(llm, "verdict")));
        response.set("decision", nullableTextNode(extractText(llm, "decision")));
        response.set("confidence", nullableNumberNode(extractNumber(llm, "confidence")));
        response.set("preferenceStrength", nullableNumberNode(extractNumber(llm, "preferenceStrength")));
        response.set("responseQuality", nullableNumberNode(extractNumber(scores, "responseQuality")));
        response.set("structuredImpactQuality", nullableNumberNode(extractNumber(scores, "structuredImpactQuality")));
        response.set("groundingQuality", nullableNumberNode(extractNumber(scores, "groundingQuality")));
        response.set("personaConsistency", nullableNumberNode(extractNumber(scores, "personaConsistency")));
        response.set("inspectorUsefulness", nullableNumberNode(extractNumber(scores, "inspectorUsefulness")));
        response.set("reasons", stringArray(llm.get("reasons"), 10));
        response.set("llmError", nullableTextNode(extractText(llm, "llmError")));
        return response;
    }

    private JsonNode buildLlmFirstPassFromJudge(JsonNode rawJudge) {
        ObjectNode judge = object(rawJudge);
        ObjectNode finalJudge = object(judge.get("final"));
        if (!finalJudge.fieldNames().hasNext()) {
            return NullNode.instance;
        }

        String verdict = extractText(finalJudge, "verdict");
        String suggestedDecision = "escalate";
        if ("keep".equals(verdict)) {
            suggestedDecision = "include";
        } else if ("drop".equals(verdict)) {
            suggestedDecision = "exclude";
        } else if ("review".equals(verdict)) {
            suggestedDecision = "escalate";
        }

        String pairDecision = extractText(finalJudge, "decision");
        if (pairDecision != null && List.of("include", "flip", "exclude").contains(pairDecision)) {
            suggestedDecision = pairDecision;
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.set("provider", nullableTextNode(firstNonBlank(extractText(judge, "provider"), extractText(judge, "mode"))));
        response.put("suggestedDecision", suggestedDecision);
        response.set("verdict", nullableTextNode(verdict));
        response.set("decision", nullableTextNode(pairDecision));
        response.set("confidence", nullableNumberNode(extractNumber(finalJudge, "confidence")));
        response.set("preferenceStrength", nullableNumberNode(extractNumber(finalJudge, "preferenceStrength")));
        response.set("responseQuality", nullableNumberNode(extractNumber(finalJudge, "responseQuality")));
        response.set("structuredImpactQuality", nullableNumberNode(extractNumber(finalJudge, "structuredImpactQuality")));
        response.set("groundingQuality", nullableNumberNode(extractNumber(finalJudge, "groundingQuality")));
        response.set("personaConsistency", nullableNumberNode(extractNumber(finalJudge, "personaConsistency")));
        response.set("inspectorUsefulness", nullableNumberNode(extractNumber(finalJudge, "inspectorUsefulness")));
        response.set("reasons", stringArray(finalJudge.get("reasons"), 10));
        response.set("llmError", nullableTextNode(extractText(judge, "llmError")));
        return response;
    }

    private ObjectNode buildCandidateView(JsonNode rawCandidate) {
        ObjectNode candidate = object(rawCandidate);
        ObjectNode candidateOutput = object(candidate.get("candidateOutput"));
        ObjectNode structuredImpact = object(candidate.get("structuredImpact"));
        ObjectNode fallbackStructuredImpact = object(candidateOutput.get("structuredImpact"));
        ArrayNode directImpactTags = stringArray(structuredImpact.get("impactTags"), 8);

        ObjectNode response = objectMapper.createObjectNode();
        response.set("rowId", nullableTextNode(extractText(candidate, "rowId")));
        response.set("verdict", nullableTextNode(extractText(candidate, "verdict")));
        response.set(
            "weightedScore",
            nullableNumberNode(
                firstNonNull(
                    extractNumber(candidate, "weightedScore"),
                    extractNumber(object(candidate.get("scores")), "weightedScore")
                )
            )
        );
        response.put("replyText", defaultText(firstNonBlank(extractText(candidate, "replyText"), extractText(candidateOutput, "replyText")), ""));
        response.set("selectedAction", nullableTextNode(firstNonBlank(extractText(candidate, "selectedAction"), extractText(candidateOutput, "selectedAction"))));
        response.put("selectedActionReason", defaultText(firstNonBlank(extractText(candidate, "selectedActionReason"), extractText(candidateOutput, "selectedActionReason")), ""));
        response.set("impactTags", directImpactTags.isEmpty() ? stringArray(fallbackStructuredImpact.get("impactTags"), 8) : directImpactTags);
        response.set("targetNpcId", nullableTextNode(firstNonBlank(extractText(structuredImpact, "targetNpcId"), extractText(fallbackStructuredImpact, "targetNpcId"))));
        response.put("rationale", defaultText(firstNonBlank(extractText(structuredImpact, "rationale"), extractText(fallbackStructuredImpact, "rationale")), ""));
        return response;
    }

    private ObjectNode buildPairCandidateSummary(ReviewRepository.CandidateRow candidate) {
        ObjectNode metadata = object(candidate.metadataJson());
        ObjectNode response = objectMapper.createObjectNode();
        response.set("rowId", nullableTextNode(candidate.rowKey()));
        response.set("source", copyOrNull(metadata.get("source")));
        response.set("verdict", copyOrNull(metadata.get("verdict")));
        response.set("llmError", copyOrNull(metadata.get("llmError")));
        response.set("scores", copyOrNull(metadata.get("scores")));
        response.set("candidateOutput", copyOrNull(candidate.assistantOutputJson()));
        return response;
    }

    private ObjectNode datasetView(ArrayNode sftItems, ArrayNode pairItems) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("sftItems", sftItems);
        response.set("pairItems", pairItems);
        return response;
    }

    private ObjectNode buildShadowInvalidJsonSummary() {
        ObjectNode response = objectMapper.createObjectNode();
        ArrayNode cases = objectMapper.createArrayNode();
        int total = 0;
        String latestExportedAt = null;
        Path episodeDir = commandRunner.resolveProjectPath(EPISODE_EXPORT_DIR);

        if (episodeDir == null || !Files.isDirectory(episodeDir)) {
            response.put("total", 0);
            response.set("latestExportedAt", NullNode.instance);
            response.set("cases", cases);
            return response;
        }

        try (Stream<Path> files = Files.list(episodeDir)) {
            List<Path> episodeFiles = files
                .filter(Files::isRegularFile)
                .filter(path -> path.getFileName().toString().endsWith(".json"))
                .sorted((left, right) -> right.getFileName().toString().compareTo(left.getFileName().toString()))
                .toList();

            for (Path file : episodeFiles) {
                ObjectNode root = object(loadJsonFile(file));
                ObjectNode episode = object(root.get("episode"));
                JsonNode turns = root.get("turns");
                if (turns == null || !turns.isArray()) {
                    continue;
                }

                String exportedAt = extractText(episode, "exportedAt");
                if (latestExportedAt == null && exportedAt != null) {
                    latestExportedAt = exportedAt;
                }

                for (JsonNode turnNode : turns) {
                    ObjectNode turn = object(turnNode);
                    ObjectNode shadow = object(turn.get("shadowComparison"));
                    if (!"invalid_json".equals(extractText(shadow, "status"))) {
                        continue;
                    }

                    total += 1;
                    if (cases.size() >= SHADOW_INVALID_CASE_LIMIT) {
                        continue;
                    }

                    ObjectNode caseNode = objectMapper.createObjectNode();
                    caseNode.set("episodeId", nullableTextNode(extractText(episode, "episodeId")));
                    caseNode.put("scenarioId", defaultText(extractText(episode, "scenarioId"), "unknown-scenario"));
                    caseNode.set("turnIndex", nullableNumberNode(extractNumber(turn, "turnIndex")));
                    caseNode.put("npcId", defaultText(extractText(turn, "npcId"), "unknown"));
                    caseNode.set("targetNpcId", nullableTextNode(extractText(turn, "targetNpcId")));
                    caseNode.put(
                        "playerText",
                        defaultText(
                            firstNonBlank(
                                extractText(turn, "rawPlayerText"),
                                extractText(turn, "normalizedInputSummary")
                            ),
                            ""
                        )
                    );
                    caseNode.put("activeReplyText", defaultText(extractText(turn, "modelReplyText"), ""));
                    caseNode.set("shadowLabel", nullableTextNode(extractText(shadow, "label")));
                    caseNode.set("durationMs", nullableNumberNode(extractNumber(shadow, "durationMs")));
                    caseNode.set("sourceRef", nullableTextNode(extractText(shadow, "sourceRef")));
                    caseNode.set("error", nullableTextNode(extractText(shadow, "error")));
                    caseNode.set("rawOutput", nullableTextNode(extractText(shadow, "rawOutput")));
                    caseNode.set(
                        "exportPath",
                        nullableTextNode(commandRunner.requiredRepoRoot().relativize(file.toAbsolutePath().normalize()).toString())
                    );
                    caseNode.set("exportedAt", nullableTextNode(exportedAt));
                    cases.add(caseNode);
                }
            }
        } catch (IOException error) {
            throw new ReviewApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to scan episode exports for shadow invalid JSON cases.",
                error
            );
        }

        response.put("total", total);
        response.set("latestExportedAt", nullableTextNode(latestExportedAt));
        response.set("cases", cases);
        return response;
    }

    private List<JsonNode> loadJsonl(Path path) {
        List<JsonNode> rows = new ArrayList<>();
        if (path == null || !Files.exists(path)) {
            return rows;
        }

        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                String trimmed = line.trim();
                if (!trimmed.isEmpty()) {
                    JsonNode node = objectMapper.readTree(trimmed);
                    if (node.isObject()) {
                        rows.add(node);
                    }
                }
            }
            return rows;
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read review pipeline files.", error);
        }
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

    private ObjectNode object(JsonNode value) {
        if (value instanceof ObjectNode objectNode) {
            return objectNode;
        }
        if (value != null && value.isTextual()) {
            try {
                JsonNode parsed = objectMapper.readTree(value.asText());
                if (parsed instanceof ObjectNode objectNode) {
                    return objectNode;
                }
            } catch (Exception ignored) {
                // Fall back to an empty object when legacy JSON text cannot be re-parsed.
            }
        }
        return objectMapper.createObjectNode();
    }

    private JsonNode copyOrNull(JsonNode value) {
        return value == null || value.isNull() ? NullNode.instance : value.deepCopy();
    }

    private ArrayNode stringArray(JsonNode value, int limit) {
        ArrayNode array = objectMapper.createArrayNode();
        if (value == null || !value.isArray()) {
            return array;
        }
        int count = 0;
        for (JsonNode entry : value) {
            if (entry.isTextual()) {
                array.add(entry.asText());
                count += 1;
                if (count >= limit) {
                    break;
                }
            }
        }
        return array;
    }

    private ArrayNode extractNestedStringArray(JsonNode value, String fieldName, int limit) {
        ArrayNode array = objectMapper.createArrayNode();
        if (value == null || !value.isArray()) {
            return array;
        }
        int count = 0;
        for (JsonNode entry : value) {
            String text = extractText(object(entry), fieldName);
            if (text != null) {
                array.add(text);
                count += 1;
                if (count >= limit) {
                    break;
                }
            }
        }
        return array;
    }

    private ArrayNode extractKnowledgeTitles(JsonNode value, int limit) {
        ArrayNode array = objectMapper.createArrayNode();
        if (value == null || !value.isArray()) {
            return array;
        }
        int count = 0;
        for (JsonNode entry : value) {
            ObjectNode object = object(entry);
            String text = firstNonBlank(extractText(object, "title"), extractText(object, "summary"));
            if (text != null) {
                array.add(text);
                count += 1;
                if (count >= limit) {
                    break;
                }
            }
        }
        return array;
    }

    private String extractText(JsonNode node, String fieldName) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text;
    }

    private Number extractNumber(JsonNode node, String fieldName) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isIntegralNumber()) {
            return value.asLong();
        }
        if (value.isFloatingPointNumber()) {
            return value.decimalValue();
        }
        if (value.isTextual()) {
            try {
                return new BigDecimal(value.asText());
            } catch (NumberFormatException error) {
                return null;
            }
        }
        return null;
    }

    private JsonNode nullableTextNode(String value) {
        return value == null ? NullNode.instance : objectMapper.getNodeFactory().textNode(value);
    }

    private JsonNode nullableNumberNode(Number value) {
        if (value == null) {
            return NullNode.instance;
        }
        if (value instanceof Integer integer) {
            return objectMapper.getNodeFactory().numberNode(integer);
        }
        if (value instanceof Long longValue) {
            return objectMapper.getNodeFactory().numberNode(longValue);
        }
        if (value instanceof BigDecimal decimal) {
            return objectMapper.getNodeFactory().numberNode(decimal);
        }
        if (value instanceof Double doubleValue) {
            return objectMapper.getNodeFactory().numberNode(doubleValue);
        }
        return objectMapper.getNodeFactory().numberNode(value.doubleValue());
    }

    private String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private <T> T firstNonNull(T first, T second) {
        return first != null ? first : second;
    }

    private String firstNonBlank(String first, String second) {
        return !blank(first) ? first : (!blank(second) ? second : null);
    }

    private JsonNode taskSelectionSource(JsonNode metadata) {
        return object(metadata);
    }
}
