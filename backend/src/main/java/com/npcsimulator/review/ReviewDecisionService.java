package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class ReviewDecisionService {

    private static final String DEFAULT_NOTES = "";

    private final ReviewRepository reviewRepository;
    private final ReviewDashboardQueryService dashboardQueryService;
    private final ObjectMapper objectMapper;
    private final ReviewJsonSupport json;
    private final TransactionTemplate transactionTemplate;

    ReviewDecisionService(
        ReviewRepository reviewRepository,
        ReviewDashboardQueryService dashboardQueryService,
        ObjectMapper objectMapper,
        ReviewJsonSupport json,
        PlatformTransactionManager transactionManager
    ) {
        this.reviewRepository = reviewRepository;
        this.dashboardQueryService = dashboardQueryService;
        this.objectMapper = objectMapper;
        this.json = json;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    JsonNode updateDecision(Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String kind = json.requiredEnum(payload, "kind", List.of("sft", "pair"), "잘못된 검수 저장 요청입니다.");
        String reviewId = json.requiredText(payload, "reviewId", "검수 항목 ID가 필요합니다.");
        String decision = json.optionalEnum(
            payload,
            "decision",
            "sft".equals(kind)
                ? List.of("include", "exclude", "escalate")
                : List.of("include", "flip", "exclude", "escalate"),
            "잘못된 검수 결정 값입니다."
        );
        String reviewer = json.trimToNull(json.extractText(payload, "reviewer"));
        String notes = json.extractText(payload, "notes", DEFAULT_NOTES);
        String nextStatus = decision == null ? "pending" : "reviewed";
        String reviewedAt = decision == null ? null : Instant.now().toString();

        transactionTemplate.executeWithoutResult(status -> {
            ReviewRepository.ReviewTaskRow task = reviewRepository.findReviewTask(reviewId, kind)
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "검수 항목을 찾지 못했습니다: " + reviewId));

            reviewRepository.updateReviewTaskDecision(
                task.id(),
                decision,
                reviewer,
                notes,
                reviewedAt,
                nextStatus
            );

            if (decision != null) {
                reviewRepository.insertReviewDecisionEvent(
                    task.id(),
                    decision,
                    nextStatus,
                    reviewer,
                    notes,
                    task.checklistJson(),
                    reviewedAt
                );
            }
        });

        ReviewRepository.ReviewTaskRow updatedTask = reviewRepository.findReviewTask(reviewId, kind)
            .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 검수 항목을 찾지 못했습니다: " + reviewId));

        ObjectNode response = objectMapper.createObjectNode();
        response.put("kind", kind);
        if ("sft".equals(kind)) {
            ReviewRepository.CandidateRow candidate = reviewRepository.findCandidate(updatedTask.sftCandidateId() == null ? -1 : updatedTask.sftCandidateId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 SFT candidate를 찾지 못했습니다."));
            response.set("item", dashboardQueryService.buildSftItemView(updatedTask, candidate));
        } else {
            ReviewRepository.PairRow pair = reviewRepository.findPair(updatedTask.preferencePairId() == null ? -1 : updatedTask.preferencePairId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 preference pair를 찾지 못했습니다."));
            ReviewRepository.CandidateRow chosen = reviewRepository.findCandidate(pair.chosenCandidateId() == null ? -1 : pair.chosenCandidateId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 chosen candidate를 찾지 못했습니다."));
            ReviewRepository.CandidateRow rejected = reviewRepository.findCandidate(pair.rejectedCandidateId() == null ? -1 : pair.rejectedCandidateId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 rejected candidate를 찾지 못했습니다."));
            response.set("item", dashboardQueryService.buildPairItemView(updatedTask, pair, chosen, rejected));
        }
        return response;
    }
}

