package com.npcsimulator.api.controller;

import com.npcsimulator.api.dto.ReviewDecisionRequest;
import com.npcsimulator.api.dto.ReviewPipelineRunRequest;
import com.npcsimulator.api.dto.ReviewTrainingDecisionRequest;
import com.npcsimulator.api.dto.ReviewTrainingRequest;
import com.npcsimulator.api.dto.ReviewTrainingRunActionRequest;
import com.npcsimulator.review.ReviewAdminGuard;
import com.npcsimulator.review.ReviewService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/review")
public class ReviewController {

    private final ReviewService reviewService;
    private final JsonResponseWriter jsonResponseWriter;
    private final ReviewAdminGuard reviewAdminGuard;

    public ReviewController(
        ReviewService reviewService,
        JsonResponseWriter jsonResponseWriter,
        ReviewAdminGuard reviewAdminGuard
    ) {
        this.reviewService = reviewService;
        this.jsonResponseWriter = jsonResponseWriter;
        this.reviewAdminGuard = reviewAdminGuard;
    }

    @GetMapping
    public ResponseEntity<String> getDashboard(@RequestHeader HttpHeaders headers) {
        return jsonResponseWriter.ok(reviewService.getDashboard(headers));
    }

    @PatchMapping
    public ResponseEntity<String> updateDecision(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewDecisionRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.updateDecision(headers, body));
    }

    @GetMapping("/finalize")
    public ResponseEntity<String> getFinalizeStatus(@RequestHeader HttpHeaders headers) {
        return jsonResponseWriter.ok(reviewService.getFinalizeStatus(headers));
    }

    @PostMapping("/finalize")
    public ResponseEntity<String> runFinalize(@RequestHeader HttpHeaders headers) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.runFinalize(headers));
    }

    @GetMapping("/training")
    public ResponseEntity<String> getTrainingStatus(@RequestHeader HttpHeaders headers) {
        return jsonResponseWriter.ok(reviewService.getTrainingStatus(headers));
    }

    @PostMapping("/training")
    public ResponseEntity<String> runTraining(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.runTraining(headers, body));
    }

    @PostMapping("/training/evaluate")
    public ResponseEntity<String> runTrainingEvaluation(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingRunActionRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.runTrainingEvaluation(headers, body));
    }

    @PostMapping("/training/decision")
    public ResponseEntity<String> updateTrainingDecision(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingDecisionRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.updateTrainingDecision(headers, body));
    }

    @PostMapping("/training/promote")
    public ResponseEntity<String> promoteTrainingRun(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingRunActionRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.promoteTrainingRun(headers, body));
    }

    @GetMapping("/pipeline")
    public ResponseEntity<String> getPipelineStatus(@RequestHeader HttpHeaders headers) {
        return jsonResponseWriter.ok(reviewService.getPipelineStatus(headers));
    }

    @PostMapping("/pipeline/judge")
    public ResponseEntity<String> runJudgeReviewQueue(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody(required = false) ReviewPipelineRunRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.runJudgeReviewQueue(headers, requestOrEmpty(body)));
    }

    @PostMapping("/pipeline/prepare-human-review")
    public ResponseEntity<String> runPrepareHumanReview(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody(required = false) ReviewPipelineRunRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.runPrepareHumanReview(headers, requestOrEmpty(body)));
    }

    @PostMapping("/pipeline/llm-first-pass")
    public ResponseEntity<String> runReviewLlmFirstPass(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody(required = false) ReviewPipelineRunRequest body
    ) {
        reviewAdminGuard.requireAdmin(headers);
        return jsonResponseWriter.ok(reviewService.runReviewLlmFirstPass(headers, requestOrEmpty(body)));
    }

    private ReviewPipelineRunRequest requestOrEmpty(ReviewPipelineRunRequest body) {
        return body == null ? ReviewPipelineRunRequest.empty() : body;
    }
}
