package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
class ReviewTrainingRunViewBuilder {

    private final ObjectMapper objectMapper;
    private final ReviewJsonSupport json;

    ReviewTrainingRunViewBuilder(ObjectMapper objectMapper, ReviewJsonSupport json) {
        this.objectMapper = objectMapper;
        this.json = json;
    }

    ObjectNode buildTrainingRunView(ReviewRepository.TrainingRunRow row) {
        ObjectNode params = json.object(row.paramsJson());
        ObjectNode evalSummary = json.object(row.evalSummaryJson());
        ObjectNode response = objectMapper.createObjectNode();
        response.put("runId", json.defaultText(row.runUid(), ""));
        response.put("kind", json.defaultText(row.runKind(), "sft"));
        response.set("trainingBackend", json.nullableTextNode(row.trainingBackend()));
        response.put("state", json.defaultText(row.state(), "failed"));
        response.set("currentStep", json.nullableTextNode(row.currentStep()));
        response.set("message", json.nullableTextNode(row.message()));
        response.set("startedAt", json.nullableTextNode(row.startedAt()));
        response.set("finishedAt", json.nullableTextNode(row.finishedAt()));
        response.set("updatedAt", json.nullableTextNode(row.updatedAt()));
        response.set("fingerprint", json.nullableTextNode(row.runFingerprint()));
        response.set("sourceFingerprint", json.nullableTextNode(row.sourceFingerprint()));
        response.set("sourceDatasetVersion", json.nullableTextNode(json.extractText(params, "sourceDatasetVersion")));
        response.set("parentRunId", json.nullableTextNode(json.extractText(params, "parentRunUid")));
        response.set("baseModelId", json.nullableTextNode(row.baseModel()));
        response.set("datasetDir", json.nullableTextNode(row.datasetWorkDir()));
        response.set("adapterPath", json.nullableTextNode(row.outputAdapterPath()));
        response.set("runtimeArtifactPath", json.nullableTextNode(row.runtimeArtifactPath()));
        response.set("runtimeArtifactKind", json.nullableTextNode(row.runtimeArtifactKind()));
        response.set("remoteProvider", json.nullableTextNode(row.remoteProvider()));
        response.set("remoteJobId", json.nullableTextNode(row.remoteJobId()));
        response.set("remoteTrainingFileId", json.nullableTextNode(row.remoteTrainingFileId()));
        response.set("remoteValidationFileId", json.nullableTextNode(row.remoteValidationFileId()));
        response.set("remoteModelName", json.nullableTextNode(row.remoteModelName()));
        response.set("logPath", json.nullableTextNode(json.extractText(params, "logPath")));
        response.set("durations", buildRunDurations(row.metricsJson()));
        response.set("evaluation", buildEvaluation(row, evalSummary));
        response.set("decision", buildDecision(row));
        response.set("promotion", buildPromotion(row));
        return response;
    }

    private ObjectNode buildEvaluation(ReviewRepository.TrainingRunRow row, ObjectNode evalSummary) {
        ObjectNode evaluation = objectMapper.createObjectNode();
        evaluation.put("state", json.defaultText(row.evalState(), "idle"));
        evaluation.set("bindingKey", json.nullableTextNode(row.evalBindingKey()));
        evaluation.set("benchmarkId", json.nullableTextNode(json.extractText(evalSummary, "benchmarkId")));
        evaluation.set("baselineLabel", json.nullableTextNode(json.firstNonBlank(row.evalBaselineLabel(), json.extractText(evalSummary, "baselineLabel"))));
        evaluation.set("summaryPath", json.nullableTextNode(json.firstNonBlank(row.evalSummaryPath(), json.extractText(evalSummary, "summaryPath"))));
        evaluation.set("message", json.nullableTextNode(row.evalMessage()));
        evaluation.set("startedAt", json.nullableTextNode(row.evalStartedAt()));
        evaluation.set("finishedAt", json.nullableTextNode(row.evalFinishedAt()));
        evaluation.set("recommendation", json.nullableTextNode(json.extractText(evalSummary, "recommendation")));
        ObjectNode winnerCounts = json.object(evalSummary.get("winnerCounts"));
        if (winnerCounts.fieldNames().hasNext()) {
            ObjectNode winnerNode = objectMapper.createObjectNode();
            winnerNode.set("baseline", json.nullableNumberNode(json.extractNumber(winnerCounts, "baseline")));
            winnerNode.set("candidate", json.nullableNumberNode(json.extractNumber(winnerCounts, "candidate")));
            winnerNode.set("tie", json.nullableNumberNode(json.extractNumber(winnerCounts, "tie")));
            evaluation.set("winnerCounts", winnerNode);
        } else {
            evaluation.set("winnerCounts", NullNode.instance);
        }
        ObjectNode averages = json.object(evalSummary.get("averages"));
        evaluation.set("baselineNaturalness", json.nullableNumberNode(json.extractNumber(averages, "baselineNaturalness")));
        evaluation.set("candidateNaturalness", json.nullableNumberNode(json.extractNumber(averages, "candidateNaturalness")));
        evaluation.set("baselinePersonaFit", json.nullableNumberNode(json.extractNumber(averages, "baselinePersonaFit")));
        evaluation.set("candidatePersonaFit", json.nullableNumberNode(json.extractNumber(averages, "candidatePersonaFit")));
        evaluation.set("baselineAntiMeta", json.nullableNumberNode(json.extractNumber(averages, "baselineAntiMeta")));
        evaluation.set("candidateAntiMeta", json.nullableNumberNode(json.extractNumber(averages, "candidateAntiMeta")));
        evaluation.set("confidence", json.nullableNumberNode(json.extractNumber(averages, "confidence")));
        return evaluation;
    }

    private ObjectNode buildDecision(ReviewRepository.TrainingRunRow row) {
        ObjectNode decision = objectMapper.createObjectNode();
        decision.put("state", json.defaultText(row.reviewDecision(), "pending"));
        decision.set("reviewer", json.nullableTextNode(row.reviewedBy()));
        decision.set("notes", json.nullableTextNode(row.reviewNotes()));
        decision.set("decidedAt", json.nullableTextNode(row.reviewedAt()));
        return decision;
    }

    private ObjectNode buildPromotion(ReviewRepository.TrainingRunRow row) {
        ObjectNode promotion = objectMapper.createObjectNode();
        promotion.put("isPromoted", row.promotedAt() != null);
        promotion.set("bindingKey", json.nullableTextNode(row.promotedBindingKey()));
        promotion.set("promotedAt", json.nullableTextNode(row.promotedAt()));
        return promotion;
    }

    private ObjectNode buildRunDurations(JsonNode metricsJson) {
        ObjectNode durations = json.object(json.object(metricsJson).get("durations"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("buildMs", json.nullableNumberNode(json.extractNumber(durations, "buildMs")));
        response.set("trainMs", json.nullableNumberNode(json.extractNumber(durations, "trainMs")));
        response.set("totalMs", json.nullableNumberNode(json.extractNumber(durations, "totalMs")));
        return response;
    }
}

