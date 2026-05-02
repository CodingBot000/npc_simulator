package com.npcsimulator.review;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingPlanningService {

    private final ReviewJsonSupport json;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewTrainingSettings settings;
    private final ReviewTrainingPreflightService preflightService;
    private final ReviewTrainingRunSpecFactory runSpecFactory;

    ReviewTrainingPlanningService(
        ReviewJsonSupport json,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewTrainingSettings settings,
        ReviewTrainingPreflightService preflightService,
        ReviewTrainingRunSpecFactory runSpecFactory
    ) {
        this.json = json;
        this.commandRunner = commandRunner;
        this.settings = settings;
        this.preflightService = preflightService;
        this.runSpecFactory = runSpecFactory;
    }

    String trainingWorkerScript() {
        return ReviewTrainingSettings.TRAINING_WORKER_SCRIPT;
    }

    ObjectNode buildSftPreflight() {
        return preflightService.buildSftPreflight();
    }

    ObjectNode buildDpoPreflight(ObjectNode sftPreflight) {
        return preflightService.buildDpoPreflight(sftPreflight);
    }

    ReviewTrainingRunSpec buildTrainingRunSpec(String kind) {
        return runSpecFactory.buildTrainingRunSpec(kind);
    }

    boolean shouldRunTrainingInline() {
        return settings.shouldRunTrainingInline(json);
    }

    void assertCanStartTrainingEvaluation() {
        if (settings.isSmokeTrainingEvaluationMode()) {
            return;
        }
        if (json.blank(settings.datasourceUrl()) || settings.datasourceUrl().startsWith("jdbc:h2:")) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "실운영 Golden-set Evaluation은 Postgres 환경에서만 지원합니다.");
        }
        if (
            !commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TSX_RELATIVE_PATH)) ||
            !commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TRAINING_EVAL_WORKER_SCRIPT))
        ) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation worker 실행 파일이 없습니다.");
        }
        if (!commandRunner.pathExists(commandRunner.resolveProjectPath(settings.trainingEvalCasesPath()))) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation case 파일을 찾지 못했습니다.");
        }
    }

    boolean shouldRunTrainingEvaluationInline() {
        return settings.shouldRunTrainingEvaluationInline();
    }

    ReviewTrainingEvaluationWorkerSpec buildEvaluationWorkerSpec() {
        return new ReviewTrainingEvaluationWorkerSpec(
            ReviewTrainingSettings.TRAINING_EVAL_WORKER_SCRIPT,
            commandRunner.resolveRequiredProjectPath(settings.trainingEvalCasesPath()).toString(),
            settings.trainingEvalProvider(),
            settings.trainingEvalJudgeModel()
        );
    }
}
