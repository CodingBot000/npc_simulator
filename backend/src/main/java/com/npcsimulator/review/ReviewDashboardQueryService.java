package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

@Service
class ReviewDashboardQueryService {

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewDashboardJsonSupport json;
    private final ReviewDashboardFileReader fileReader;
    private final ReviewDashboardItemViewFactory itemViewFactory;
    private final ReviewShadowInvalidJsonQueryService shadowInvalidJsonQueryService;

    ReviewDashboardQueryService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewDashboardJsonSupport json,
        ReviewDashboardFileReader fileReader,
        ReviewDashboardItemViewFactory itemViewFactory,
        ReviewShadowInvalidJsonQueryService shadowInvalidJsonQueryService
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
        this.json = json;
        this.fileReader = fileReader;
        this.itemViewFactory = itemViewFactory;
        this.shadowInvalidJsonQueryService = shadowInvalidJsonQueryService;
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

        addHumanReviewItems(tasks, candidateMap, pairMap, humanSftItems, humanPairItems, sourceRowKeys, pairKeys);

        ObjectNode response = objectMapper.createObjectNode();
        response.set("humanRequired", datasetView(humanSftItems, humanPairItems));
        response.set("llmCompleted", datasetView(buildCompletedSftItems(sourceRowKeys), buildCompletedPairItems(pairKeys)));
        response.set("shadowInvalidJson", shadowInvalidJsonQueryService.buildShadowInvalidJsonSummary());
        return response;
    }

    ObjectNode buildSftItemView(
        ReviewRepository.ReviewTaskRow task,
        ReviewRepository.CandidateRow candidate
    ) {
        return itemViewFactory.buildSftItemView(task, candidate);
    }

    ObjectNode buildPairItemView(
        ReviewRepository.ReviewTaskRow task,
        ReviewRepository.PairRow pair,
        ReviewRepository.CandidateRow chosen,
        ReviewRepository.CandidateRow rejected
    ) {
        return itemViewFactory.buildPairItemView(task, pair, chosen, rejected);
    }

    private void addHumanReviewItems(
        List<ReviewRepository.ReviewTaskRow> tasks,
        Map<Long, ReviewRepository.CandidateRow> candidateMap,
        Map<Long, ReviewRepository.PairRow> pairMap,
        ArrayNode humanSftItems,
        ArrayNode humanPairItems,
        LinkedHashSet<String> sourceRowKeys,
        LinkedHashSet<String> pairKeys
    ) {
        for (ReviewRepository.ReviewTaskRow task : tasks) {
            if ("sft".equals(task.reviewKind()) && task.sftCandidateId() != null) {
                addHumanSftItem(task, candidateMap, humanSftItems, sourceRowKeys);
                continue;
            }

            if ("pair".equals(task.reviewKind()) && task.preferencePairId() != null) {
                addHumanPairItem(task, candidateMap, pairMap, humanPairItems, pairKeys);
            }
        }
    }

    private void addHumanSftItem(
        ReviewRepository.ReviewTaskRow task,
        Map<Long, ReviewRepository.CandidateRow> candidateMap,
        ArrayNode humanSftItems,
        LinkedHashSet<String> sourceRowKeys
    ) {
        ReviewRepository.CandidateRow candidate = candidateMap.get(task.sftCandidateId());
        if (candidate == null) {
            return;
        }

        humanSftItems.add(itemViewFactory.buildSftItemView(task, candidate));
        String sourceRowKey = json.firstNonBlank(
            json.extractText(json.object(candidate.metadataJson()), "sourceRowId"),
            candidate.rowKey()
        );
        if (sourceRowKey != null) {
            sourceRowKeys.add(sourceRowKey);
        }
    }

    private void addHumanPairItem(
        ReviewRepository.ReviewTaskRow task,
        Map<Long, ReviewRepository.CandidateRow> candidateMap,
        Map<Long, ReviewRepository.PairRow> pairMap,
        ArrayNode humanPairItems,
        LinkedHashSet<String> pairKeys
    ) {
        ReviewRepository.PairRow pair = pairMap.get(task.preferencePairId());
        if (pair == null || pair.chosenCandidateId() == null || pair.rejectedCandidateId() == null) {
            return;
        }

        ReviewRepository.CandidateRow chosen = candidateMap.get(pair.chosenCandidateId());
        ReviewRepository.CandidateRow rejected = candidateMap.get(pair.rejectedCandidateId());
        if (chosen == null || rejected == null) {
            return;
        }

        humanPairItems.add(itemViewFactory.buildPairItemView(task, pair, chosen, rejected));
        if (pair.pairKey() != null && !pair.pairKey().isBlank()) {
            pairKeys.add(pair.pairKey());
        }
    }

    private ArrayNode buildCompletedSftItems(LinkedHashSet<String> sourceRowKeys) {
        ArrayNode completedSftItems = objectMapper.createArrayNode();
        for (JsonNode entry : fileReader.loadJsonl(commandRunner.resolveProjectPath("data/evals/judged/judged-review-live.jsonl"))) {
            String rowId = json.extractText(entry, "rowId");
            if (rowId == null || !sourceRowKeys.contains(rowId)) {
                completedSftItems.add(itemViewFactory.buildCompletedSftItemView(json.object(entry)));
            }
        }
        return completedSftItems;
    }

    private ArrayNode buildCompletedPairItems(LinkedHashSet<String> pairKeys) {
        ArrayNode completedPairItems = objectMapper.createArrayNode();
        for (JsonNode entry : fileReader.loadJsonl(commandRunner.resolveProjectPath("data/evals/preference/candidate_pairs_live_gap1.jsonl"))) {
            String pairId = json.extractText(entry, "pairId");
            if (pairId == null || !pairKeys.contains(pairId)) {
                completedPairItems.add(itemViewFactory.buildCompletedPairItemView(json.object(entry)));
            }
        }
        return completedPairItems;
    }

    private ObjectNode datasetView(ArrayNode sftItems, ArrayNode pairItems) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("sftItems", sftItems);
        response.set("pairItems", pairItems);
        return response;
    }
}
