package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
class ReviewDashboardItemViewFactory {

    private static final String DEFAULT_NOTES = "";

    private final ObjectMapper objectMapper;
    private final ReviewDashboardJsonSupport json;

    ReviewDashboardItemViewFactory(
        ObjectMapper objectMapper,
        ReviewDashboardJsonSupport json
    ) {
        this.objectMapper = objectMapper;
        this.json = json;
    }

    ObjectNode buildSftItemView(
        ReviewRepository.ReviewTaskRow task,
        ReviewRepository.CandidateRow candidate
    ) {
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "sft");
        item.put("reviewId", json.defaultText(task.reviewUid(), "sft:" + json.defaultText(candidate.rowKey(), String.valueOf(candidate.id()))));
        item.set("bucket", json.nullableTextNode(task.bucket()));
        item.set("priority", json.nullableTextNode(task.priority()));
        item.put("status", json.defaultText(task.status(), task.currentDecision() == null ? "pending" : "reviewed"));
        item.set("decision", json.nullableTextNode(task.currentDecision()));
        item.set("reviewer", json.nullableTextNode(task.currentReviewer()));
        item.set("reviewedAt", json.nullableTextNode(task.currentReviewedAt()));
        item.put("notes", json.defaultText(task.currentNotes(), DEFAULT_NOTES));
        item.set("queueReason", json.nullableTextNode(task.queueReason()));
        item.set("source", buildSourceView(candidate));
        item.set("judge", buildJudgeView(candidate.judgeResultJson()));
        item.set("weightedJudgeScore", json.nullableNumberNode(candidate.weightedJudgeScore()));
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
        item.put("reviewId", json.defaultText(task.reviewUid(), "pair:" + json.defaultText(pair.pairKey(), String.valueOf(pair.id()))));
        item.put("pairId", json.defaultText(pair.pairKey(), ""));
        item.set("priority", json.nullableTextNode(task.priority()));
        item.put("status", json.defaultText(task.status(), task.currentDecision() == null ? "pending" : "reviewed"));
        item.set("decision", json.nullableTextNode(task.currentDecision()));
        item.set("reviewer", json.nullableTextNode(task.currentReviewer()));
        item.set("reviewedAt", json.nullableTextNode(task.currentReviewedAt()));
        item.put("notes", json.defaultText(task.currentNotes(), DEFAULT_NOTES));
        item.set("weightedGap", json.nullableNumberNode(pair.weightedGap()));
        item.set("pairReason", json.stringArray(pair.pairReasonJson(), 8));
        item.set("prompt", buildPromptView(pair.promptBundleJson()));
        item.set("chosen", buildCandidateView(buildPairCandidateSummary(chosen)));
        item.set("rejected", buildCandidateView(buildPairCandidateSummary(rejected)));
        item.set("llmFirstPass", buildLlmFirstPassView(task.llmFirstPassJson()));
        return item;
    }

    ObjectNode buildCompletedSftItemView(ObjectNode raw) {
        ObjectNode judge = json.object(raw.get("judge"));
        ObjectNode finalJudge = json.object(judge.get("final"));
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "sft");
        item.put("reviewId", "auto:" + json.defaultText(json.extractText(raw, "rowId"), "unknown-row"));
        item.set("bucket", json.nullableTextNode(json.extractText(finalJudge, "verdict")));
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

    ObjectNode buildCompletedPairItemView(ObjectNode raw) {
        ObjectNode judge = json.object(raw.get("judge"));
        ObjectNode finalJudge = json.object(judge.get("final"));
        ObjectNode item = objectMapper.createObjectNode();
        item.put("kind", "pair");
        item.put("reviewId", "auto:" + json.defaultText(json.extractText(raw, "pairId"), "unknown-pair"));
        item.put("pairId", json.defaultText(json.extractText(raw, "pairId"), ""));
        item.set("priority", NullNode.instance);
        item.put("status", "reviewed");
        item.set("decision", NullNode.instance);
        item.set("reviewer", NullNode.instance);
        item.set("reviewedAt", NullNode.instance);
        item.put("notes", "");
        item.set("weightedGap", json.nullableNumberNode(json.extractNumber(raw, "weightedGap")));
        item.set("pairReason", json.stringArray(raw.get("pairReason"), 8));
        item.set("prompt", buildPromptView(raw.get("promptBundle")));
        item.set("chosen", buildCandidateView(json.object(raw.get("chosenCandidate"))));
        item.set("rejected", buildCandidateView(json.object(raw.get("rejectedCandidate"))));
        item.set("llmFirstPass", buildLlmFirstPassFromJudge(judge));
        return item;
    }

    private ObjectNode buildSourceView(ReviewRepository.CandidateRow candidate) {
        ObjectNode metadata = json.object(candidate.metadataJson());
        ObjectNode promptBundle = json.object(candidate.promptBundleJson());
        ObjectNode source = json.object(metadata.get("source"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("episodeId", json.nullableTextNode(json.firstNonBlank(json.extractText(source, "episodeId"), json.extractText(promptBundle, "episodeId"))));
        response.put("scenarioId", json.defaultText(json.firstNonBlank(json.extractText(source, "scenarioId"), json.extractText(promptBundle, "scenarioId")), "unknown-scenario"));
        response.set("turnIndex", json.nullableNumberNode(json.firstNonNull(json.extractNumber(source, "turnIndex"), json.extractNumber(promptBundle, "turnIndex"))));
        response.put("npcId", json.defaultText(json.firstNonBlank(json.extractText(source, "npcId"), json.extractText(promptBundle, "npcId")), "unknown"));
        response.set("targetNpcId", json.nullableTextNode(json.firstNonBlank(json.extractText(source, "targetNpcId"), json.extractText(promptBundle, "targetNpcId"))));
        response.set("strategyLabel", json.nullableTextNode(json.firstNonBlank(json.extractText(source, "strategyLabel"), candidate.strategyLabel())));
        response.set("exportPath", json.nullableTextNode(json.firstNonBlank(json.extractText(source, "exportPath"), candidate.sourceExportPath())));
        response.set("sourceLabel", json.nullableTextNode(json.firstNonBlank(json.extractText(source, "sourceLabel"), candidate.sourceLabel())));
        return response;
    }

    private ObjectNode buildSourceViewFromPipelineRecord(ObjectNode raw) {
        ObjectNode prompt = json.object(raw.get("promptBundle"));
        ObjectNode source = json.object(raw.get("source"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("episodeId", json.nullableTextNode(json.extractText(prompt, "episodeId")));
        response.put("scenarioId", json.defaultText(json.extractText(prompt, "scenarioId"), "unknown-scenario"));
        response.set("turnIndex", json.nullableNumberNode(json.extractNumber(prompt, "turnIndex")));
        response.put("npcId", json.defaultText(json.extractText(prompt, "npcId"), "unknown"));
        response.set("targetNpcId", json.nullableTextNode(json.extractText(prompt, "targetNpcId")));
        response.set("strategyLabel", NullNode.instance);
        response.set("exportPath", json.nullableTextNode(json.extractText(source, "path")));
        response.set("sourceLabel", json.nullableTextNode(json.extractText(source, "label")));
        return response;
    }

    private ObjectNode buildPromptView(JsonNode rawPrompt) {
        ObjectNode prompt = json.object(rawPrompt);
        ObjectNode response = objectMapper.createObjectNode();
        response.set("episodeId", json.nullableTextNode(json.extractText(prompt, "episodeId")));
        response.put("scenarioId", json.defaultText(json.extractText(prompt, "scenarioId"), "unknown-scenario"));
        response.set("turnIndex", json.nullableNumberNode(json.extractNumber(prompt, "turnIndex")));
        response.put("npcId", json.defaultText(json.extractText(prompt, "npcId"), "unknown"));
        response.set("targetNpcId", json.nullableTextNode(json.extractText(prompt, "targetNpcId")));
        response.put("inputMode", json.defaultText(json.extractText(prompt, "inputMode"), "free_text"));
        String playerText = json.defaultText(json.extractText(prompt, "playerText"), "");
        response.put("playerText", playerText);
        response.put("normalizedInputSummary", json.defaultText(json.extractText(prompt, "normalizedInputSummary"), playerText));
        response.set("promptContextSummary", json.nullableTextNode(json.extractText(prompt, "promptContextSummary")));
        response.set("retrievedMemorySummaries", json.extractNestedStringArray(prompt.get("retrievedMemories"), "summary", 4));
        response.set("retrievedKnowledgeTitles", json.extractKnowledgeTitles(prompt.get("retrievedKnowledge"), 6));
        return response;
    }

    private JsonNode buildJudgeView(JsonNode rawJudge) {
        ObjectNode judge = json.object(rawJudge);
        if (!judge.fieldNames().hasNext()) {
            return NullNode.instance;
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.set("responseQuality", json.nullableNumberNode(json.extractNumber(judge, "responseQuality")));
        response.set("structuredImpactQuality", json.nullableNumberNode(json.extractNumber(judge, "structuredImpactQuality")));
        response.set("groundingQuality", json.nullableNumberNode(json.extractNumber(judge, "groundingQuality")));
        response.set("personaConsistency", json.nullableNumberNode(json.extractNumber(judge, "personaConsistency")));
        response.set("inspectorUsefulness", json.nullableNumberNode(json.extractNumber(judge, "inspectorUsefulness")));
        response.set("verdict", json.nullableTextNode(json.extractText(judge, "verdict")));
        response.set("reasons", json.stringArray(judge.get("reasons"), 6));
        return response;
    }

    private JsonNode buildLlmFirstPassView(JsonNode rawLlm) {
        ObjectNode llm = json.object(rawLlm);
        if (!llm.fieldNames().hasNext()) {
            return NullNode.instance;
        }

        ObjectNode scores = json.object(llm.get("scores"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("provider", json.nullableTextNode(json.extractText(llm, "provider")));
        response.set("suggestedDecision", json.nullableTextNode(json.extractText(llm, "suggestedDecision")));
        response.set("verdict", json.nullableTextNode(json.extractText(llm, "verdict")));
        response.set("decision", json.nullableTextNode(json.extractText(llm, "decision")));
        response.set("confidence", json.nullableNumberNode(json.extractNumber(llm, "confidence")));
        response.set("preferenceStrength", json.nullableNumberNode(json.extractNumber(llm, "preferenceStrength")));
        response.set("responseQuality", json.nullableNumberNode(json.extractNumber(scores, "responseQuality")));
        response.set("structuredImpactQuality", json.nullableNumberNode(json.extractNumber(scores, "structuredImpactQuality")));
        response.set("groundingQuality", json.nullableNumberNode(json.extractNumber(scores, "groundingQuality")));
        response.set("personaConsistency", json.nullableNumberNode(json.extractNumber(scores, "personaConsistency")));
        response.set("inspectorUsefulness", json.nullableNumberNode(json.extractNumber(scores, "inspectorUsefulness")));
        response.set("reasons", json.stringArray(llm.get("reasons"), 10));
        response.set("llmError", json.nullableTextNode(json.extractText(llm, "llmError")));
        return response;
    }

    private JsonNode buildLlmFirstPassFromJudge(JsonNode rawJudge) {
        ObjectNode judge = json.object(rawJudge);
        ObjectNode finalJudge = json.object(judge.get("final"));
        if (!finalJudge.fieldNames().hasNext()) {
            return NullNode.instance;
        }

        String verdict = json.extractText(finalJudge, "verdict");
        String suggestedDecision = "escalate";
        if ("keep".equals(verdict)) {
            suggestedDecision = "include";
        } else if ("drop".equals(verdict)) {
            suggestedDecision = "exclude";
        } else if ("review".equals(verdict)) {
            suggestedDecision = "escalate";
        }

        String pairDecision = json.extractText(finalJudge, "decision");
        if (pairDecision != null && List.of("include", "flip", "exclude").contains(pairDecision)) {
            suggestedDecision = pairDecision;
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.set("provider", json.nullableTextNode(json.firstNonBlank(json.extractText(judge, "provider"), json.extractText(judge, "mode"))));
        response.put("suggestedDecision", suggestedDecision);
        response.set("verdict", json.nullableTextNode(verdict));
        response.set("decision", json.nullableTextNode(pairDecision));
        response.set("confidence", json.nullableNumberNode(json.extractNumber(finalJudge, "confidence")));
        response.set("preferenceStrength", json.nullableNumberNode(json.extractNumber(finalJudge, "preferenceStrength")));
        response.set("responseQuality", json.nullableNumberNode(json.extractNumber(finalJudge, "responseQuality")));
        response.set("structuredImpactQuality", json.nullableNumberNode(json.extractNumber(finalJudge, "structuredImpactQuality")));
        response.set("groundingQuality", json.nullableNumberNode(json.extractNumber(finalJudge, "groundingQuality")));
        response.set("personaConsistency", json.nullableNumberNode(json.extractNumber(finalJudge, "personaConsistency")));
        response.set("inspectorUsefulness", json.nullableNumberNode(json.extractNumber(finalJudge, "inspectorUsefulness")));
        response.set("reasons", json.stringArray(finalJudge.get("reasons"), 10));
        response.set("llmError", json.nullableTextNode(json.extractText(judge, "llmError")));
        return response;
    }

    private ObjectNode buildCandidateView(JsonNode rawCandidate) {
        ObjectNode candidate = json.object(rawCandidate);
        ObjectNode candidateOutput = json.object(candidate.get("candidateOutput"));
        ObjectNode structuredImpact = json.object(candidate.get("structuredImpact"));
        ObjectNode fallbackStructuredImpact = json.object(candidateOutput.get("structuredImpact"));
        ArrayNode directImpactTags = json.stringArray(structuredImpact.get("impactTags"), 8);

        ObjectNode response = objectMapper.createObjectNode();
        response.set("rowId", json.nullableTextNode(json.extractText(candidate, "rowId")));
        response.set("verdict", json.nullableTextNode(json.extractText(candidate, "verdict")));
        response.set(
            "weightedScore",
            json.nullableNumberNode(
                json.firstNonNull(
                    json.extractNumber(candidate, "weightedScore"),
                    json.extractNumber(json.object(candidate.get("scores")), "weightedScore")
                )
            )
        );
        response.put("replyText", json.defaultText(json.firstNonBlank(json.extractText(candidate, "replyText"), json.extractText(candidateOutput, "replyText")), ""));
        response.set("selectedAction", json.nullableTextNode(json.firstNonBlank(json.extractText(candidate, "selectedAction"), json.extractText(candidateOutput, "selectedAction"))));
        response.put("selectedActionReason", json.defaultText(json.firstNonBlank(json.extractText(candidate, "selectedActionReason"), json.extractText(candidateOutput, "selectedActionReason")), ""));
        response.set("impactTags", directImpactTags.isEmpty() ? json.stringArray(fallbackStructuredImpact.get("impactTags"), 8) : directImpactTags);
        response.set("targetNpcId", json.nullableTextNode(json.firstNonBlank(json.extractText(structuredImpact, "targetNpcId"), json.extractText(fallbackStructuredImpact, "targetNpcId"))));
        response.put("rationale", json.defaultText(json.firstNonBlank(json.extractText(structuredImpact, "rationale"), json.extractText(fallbackStructuredImpact, "rationale")), ""));
        return response;
    }

    private ObjectNode buildPairCandidateSummary(ReviewRepository.CandidateRow candidate) {
        ObjectNode metadata = json.object(candidate.metadataJson());
        ObjectNode response = objectMapper.createObjectNode();
        response.set("rowId", json.nullableTextNode(candidate.rowKey()));
        response.set("source", json.copyOrNull(metadata.get("source")));
        response.set("verdict", json.copyOrNull(metadata.get("verdict")));
        response.set("llmError", json.copyOrNull(metadata.get("llmError")));
        response.set("scores", json.copyOrNull(metadata.get("scores")));
        response.set("candidateOutput", json.copyOrNull(candidate.assistantOutputJson()));
        return response;
    }
}
