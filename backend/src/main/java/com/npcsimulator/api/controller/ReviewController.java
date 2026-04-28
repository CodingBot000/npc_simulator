package com.npcsimulator.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.npcsimulator.api.dto.ErrorResponse;
import com.npcsimulator.api.dto.ReviewDecisionRequest;
import com.npcsimulator.api.dto.ReviewPipelineRunRequest;
import com.npcsimulator.api.dto.ReviewTrainingDecisionRequest;
import com.npcsimulator.api.dto.ReviewTrainingRequest;
import com.npcsimulator.api.dto.ReviewTrainingRunActionRequest;
import com.npcsimulator.review.ReviewApiException;
import com.npcsimulator.review.ReviewService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
    private final ObjectMapper objectMapper;

    public ReviewController(ReviewService reviewService, ObjectMapper objectMapper) {
        this.reviewService = reviewService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ResponseEntity<String> getDashboard(@RequestHeader HttpHeaders headers) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.getDashboard(headers));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PatchMapping
    public ResponseEntity<String> updateDecision(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewDecisionRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.updateDecision(headers, body));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/finalize")
    public ResponseEntity<String> getFinalizeStatus(@RequestHeader HttpHeaders headers) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.getFinalizeStatus(headers));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/finalize")
    public ResponseEntity<String> runFinalize(@RequestHeader HttpHeaders headers) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.runFinalize(headers));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/training")
    public ResponseEntity<String> getTrainingStatus(@RequestHeader HttpHeaders headers) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.getTrainingStatus(headers));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/training")
    public ResponseEntity<String> runTraining(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.runTraining(headers, body));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/training/evaluate")
    public ResponseEntity<String> runTrainingEvaluation(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingRunActionRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.runTrainingEvaluation(headers, body));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/training/decision")
    public ResponseEntity<String> updateTrainingDecision(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingDecisionRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.updateTrainingDecision(headers, body));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/training/promote")
    public ResponseEntity<String> promoteTrainingRun(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody ReviewTrainingRunActionRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.promoteTrainingRun(headers, body));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/pipeline")
    public ResponseEntity<String> getPipelineStatus(@RequestHeader HttpHeaders headers) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.getPipelineStatus(headers));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/pipeline/judge")
    public ResponseEntity<String> runJudgeReviewQueue(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody(required = false) ReviewPipelineRunRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.runJudgeReviewQueue(headers, requestOrEmpty(body)));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/pipeline/prepare-human-review")
    public ResponseEntity<String> runPrepareHumanReview(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody(required = false) ReviewPipelineRunRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.runPrepareHumanReview(headers, requestOrEmpty(body)));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/pipeline/llm-first-pass")
    public ResponseEntity<String> runReviewLlmFirstPass(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody(required = false) ReviewPipelineRunRequest body
    ) {
        try {
            return jsonResponse(ResponseEntity.ok(), reviewService.runReviewLlmFirstPass(headers, requestOrEmpty(body)));
        } catch (ReviewApiException error) {
            return errorResponse(error);
        }
    }

    private ResponseEntity<String> jsonResponse(
        ResponseEntity.BodyBuilder builder,
        JsonNode body
    ) {
        return builder
            .contentType(MediaType.APPLICATION_JSON)
            .body(writeJson(body));
    }

    private ResponseEntity<String> errorResponse(ReviewApiException error) {
        return ResponseEntity.status(error.getStatus())
            .contentType(MediaType.APPLICATION_JSON)
            .body(writeJson(new ErrorResponse(error.getMessage())));
    }

    private ReviewPipelineRunRequest requestOrEmpty(ReviewPipelineRunRequest body) {
        return body == null ? ReviewPipelineRunRequest.empty() : body;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize review response.", error);
        }
    }
}
