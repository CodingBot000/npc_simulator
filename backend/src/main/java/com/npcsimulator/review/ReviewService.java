package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class ReviewService {

    private static final String DEFAULT_NOTES = "";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewJsonSupport json;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewTrainingCommandService trainingCommandService;
    private final ReviewTrainingPlanningService trainingPlanningService;
    private final ReviewDashboardQueryService dashboardQueryService;
    private final ReviewDecisionService decisionService;
    private final ReviewFinalizeService finalizeService;
    private final ReviewPipelineCommandService pipelineCommandService;
    private final ReviewPipelineStatusViewBuilder pipelineStatusViewBuilder;
    private final ReviewTrainingRunViewBuilder trainingRunViewBuilder;

    public ReviewService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewJsonSupport json,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewTrainingCommandService trainingCommandService,
        ReviewTrainingPlanningService trainingPlanningService,
        ReviewDashboardQueryService dashboardQueryService,
        ReviewDecisionService decisionService,
        ReviewFinalizeService finalizeService,
        ReviewPipelineCommandService pipelineCommandService,
        ReviewPipelineStatusViewBuilder pipelineStatusViewBuilder,
        ReviewTrainingRunViewBuilder trainingRunViewBuilder
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.json = json;
        this.commandRunner = commandRunner;
        this.trainingCommandService = trainingCommandService;
        this.trainingPlanningService = trainingPlanningService;
        this.dashboardQueryService = dashboardQueryService;
        this.decisionService = decisionService;
        this.finalizeService = finalizeService;
        this.pipelineCommandService = pipelineCommandService;
        this.pipelineStatusViewBuilder = pipelineStatusViewBuilder;
        this.trainingRunViewBuilder = trainingRunViewBuilder;
    }

    public JsonNode getDashboard(HttpHeaders headers) {
        return dashboardQueryService.getDashboard(headers);
    }

    public JsonNode getPipelineStatus(HttpHeaders headers) {
        return pipelineStatusViewBuilder.getPipelineStatus(headers);
    }

    public JsonNode runJudgeReviewQueue(HttpHeaders headers, Object requestBody) {
        return pipelineCommandService.runJudgeReviewQueue(headers, requestBody);
    }

    public JsonNode runPrepareHumanReview(HttpHeaders headers, Object requestBody) {
        return pipelineCommandService.runPrepareHumanReview(headers, requestBody);
    }

    public JsonNode runReviewLlmFirstPass(HttpHeaders headers, Object requestBody) {
        return pipelineCommandService.runReviewLlmFirstPass(headers, requestBody);
    }

    public JsonNode updateDecision(HttpHeaders headers, Object requestBody) {
        return decisionService.updateDecision(requestBody);
    }

    public JsonNode getFinalizeStatus(HttpHeaders headers) {
        return finalizeService.getFinalizeStatus(headers);
    }

    public JsonNode runFinalize(HttpHeaders headers) {
        return finalizeService.runFinalize(headers);
    }

    public JsonNode getTrainingStatus(HttpHeaders headers) {
        ObjectNode sftPreflight = trainingPlanningService.buildSftPreflight();
        ObjectNode dpoPreflight = trainingPlanningService.buildDpoPreflight(sftPreflight);

        List<ReviewRepository.TrainingRunRow> runs = reviewRepository.listTrainingRuns(List.of("sft", "dpo"));
        ObjectNode activeRun = null;
        ObjectNode latestRun = null;
        for (ReviewRepository.TrainingRunRow row : runs) {
            ObjectNode view = trainingRunViewBuilder.buildTrainingRunView(row);
            if (latestRun == null) {
                latestRun = view;
            }
            if ("running".equals(row.state()) && activeRun == null) {
                activeRun = view;
            }
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.set("activeRun", activeRun == null ? NullNode.instance : activeRun);
        response.set("latestRun", latestRun == null ? NullNode.instance : latestRun);
        response.set("sft", sftPreflight);
        response.set("dpo", dpoPreflight);
        return response;
    }

    public JsonNode runTraining(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String kind = json.requiredEnum(payload, "kind", List.of("sft", "dpo"), "잘못된 학습 실행 요청입니다.");

        JsonNode status = getTrainingStatus(headers);
        JsonNode activeRun = status.get("activeRun");
        if (activeRun != null && !activeRun.isNull()) {
            throw new ReviewApiException(
                HttpStatus.CONFLICT,
                "이미 실행 중인 학습이 있습니다. runId=" + json.defaultText(json.extractText(activeRun, "runId"), "unknown")
            );
        }

        ObjectNode preflight = json.object(status.get(kind));
        if (!preflight.path("canStart").asBoolean(false)) {
            JsonNode blockingIssues = preflight.get("blockingIssues");
            String message =
                blockingIssues != null && blockingIssues.isArray() && !blockingIssues.isEmpty()
                    ? blockingIssues.get(0).asText("학습을 시작할 수 없습니다.")
                    : "학습을 시작할 수 없습니다.";
            throw new ReviewApiException(HttpStatus.CONFLICT, message);
        }

        ReviewTrainingRunSpec spec = trainingPlanningService.buildTrainingRunSpec(kind);
        trainingCommandService.createAndStartTrainingRun(
            spec,
            trainingPlanningService.shouldRunTrainingInline(),
            trainingPlanningService.trainingWorkerScript()
        );

        return getTrainingStatus(headers);
    }

    public JsonNode runTrainingEvaluation(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String bindingKey = json.optionalEnum(
            payload,
            "bindingKey",
            List.of("default", "doctor", "supervisor", "director"),
            "잘못된 Model Promotion slot입니다."
        );
        if (bindingKey == null) {
            bindingKey = "default";
        }

        JsonNode status = getTrainingStatus(headers);
        JsonNode activeRun = status.get("activeRun");
        if (activeRun != null && !activeRun.isNull()) {
            throw new ReviewApiException(
                HttpStatus.CONFLICT,
                "학습 실행 중에는 평가를 시작할 수 없습니다. runId=" + json.defaultText(json.extractText(activeRun, "runId"), "unknown")
            );
        }
        trainingPlanningService.assertCanStartTrainingEvaluation();

        String requestedRunId = json.trimToNull(json.extractText(payload, "runId"));
        ReviewRepository.TrainingRunRow run = resolveTrainingRunForControlAction(requestedRunId);
        if (!"succeeded".equals(run.state())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "성공한 학습 run만 평가할 수 있습니다. runId=" + run.runUid());
        }
        if (json.blank(json.firstNonBlank(run.runtimeArtifactPath(), run.outputAdapterPath())) && json.blank(run.remoteModelName())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "평가 가능한 runtime artifact 또는 remote model이 없는 학습 run입니다.");
        }
        if ("running".equals(run.evalState())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "이미 Golden-set Evaluation이 실행 중입니다. runId=" + run.runUid());
        }

        ReviewPromotedBaseline baseline = resolvePromotedBaseline(bindingKey);
        trainingCommandService.startTrainingEvaluation(
            run,
            bindingKey,
            baseline,
            trainingPlanningService.shouldRunTrainingEvaluationInline(),
            trainingPlanningService.buildEvaluationWorkerSpec()
        );

        return getTrainingStatus(headers);
    }

    public JsonNode updateTrainingDecision(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String decision = json.requiredEnum(
            payload,
            "decision",
            List.of("accepted", "rejected"),
            "잘못된 학습 평가 결정입니다."
        );
        String reviewer = json.trimToNull(json.extractText(payload, "reviewer"));
        String notes = json.extractText(payload, "notes", DEFAULT_NOTES);

        ReviewRepository.TrainingRunRow run = resolveTrainingRunForControlAction(
            json.requiredText(payload, "runId", "학습 runId가 필요합니다.")
        );
        trainingCommandService.updateTrainingDecision(run, decision, reviewer, notes);
        return getTrainingStatus(headers);
    }

    public JsonNode promoteTrainingRun(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String bindingKey = json.optionalEnum(
            payload,
            "bindingKey",
            List.of("default", "doctor", "supervisor", "director"),
            "잘못된 Model Promotion slot입니다."
        );
        if (bindingKey == null) {
            bindingKey = "default";
        }

        ReviewRepository.TrainingRunRow run = resolveTrainingRunForControlAction(
            json.requiredText(payload, "runId", "학습 runId가 필요합니다.")
        );
        trainingCommandService.promoteTrainingRun(run, bindingKey);
        return getTrainingStatus(headers);
    }

    private ReviewRepository.TrainingRunRow resolveTrainingRunForControlAction(String requestedRunId) {
        if (!json.blank(requestedRunId)) {
            return reviewRepository.findTrainingRunByUid(requestedRunId)
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "학습 run을 찾지 못했습니다: " + requestedRunId));
        }

        return reviewRepository.listTrainingRuns(List.of("sft", "dpo")).stream()
            .filter(row -> "succeeded".equals(row.state()))
            .findFirst()
            .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "평가할 성공한 학습 run이 없습니다."));
    }

    private ReviewPromotedBaseline resolvePromotedBaseline(String bindingKey) {
        Optional<ReviewRepository.TrainingRunRow> exact = reviewRepository.findLatestPromotedTrainingRun(bindingKey)
            .filter(this::hasUsablePromotedRuntime);
        if (exact.isPresent()) {
            String runtimePath = json.firstNonBlank(exact.get().runtimeArtifactPath(), exact.get().outputAdapterPath());
            return new ReviewPromotedBaseline(
                "promoted:" + exact.get().runUid(),
                runtimePath != null && commandRunner.pathExists(Path.of(runtimePath)) ? runtimePath : null,
                json.blank(exact.get().remoteProvider()) ? null : exact.get().remoteProvider(),
                json.blank(exact.get().remoteModelName()) ? null : exact.get().remoteModelName()
            );
        }
        if (!"default".equals(bindingKey)) {
            Optional<ReviewRepository.TrainingRunRow> fallback = reviewRepository.findLatestPromotedTrainingRun("default")
                .filter(this::hasUsablePromotedRuntime);
            if (fallback.isPresent()) {
                String runtimePath = json.firstNonBlank(fallback.get().runtimeArtifactPath(), fallback.get().outputAdapterPath());
                return new ReviewPromotedBaseline(
                    "promoted:default:" + fallback.get().runUid(),
                    runtimePath != null && commandRunner.pathExists(Path.of(runtimePath)) ? runtimePath : null,
                    json.blank(fallback.get().remoteProvider()) ? null : fallback.get().remoteProvider(),
                    json.blank(fallback.get().remoteModelName()) ? null : fallback.get().remoteModelName()
                );
            }
        }
        return new ReviewPromotedBaseline("base_model", null, null, null);
    }

    private boolean hasUsablePromotedRuntime(ReviewRepository.TrainingRunRow row) {
        if (!json.blank(row.remoteModelName())) {
            return true;
        }
        String runtimePath = json.firstNonBlank(row.runtimeArtifactPath(), row.outputAdapterPath());
        return runtimePath != null && commandRunner.pathExists(Path.of(runtimePath));
    }

}
