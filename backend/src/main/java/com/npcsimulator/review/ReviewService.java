package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class ReviewService {

    private static final String DEFAULT_NOTES = "";
    private static final String TSX_RELATIVE_PATH = "node_modules/.bin/tsx";
    private static final String TRAINING_WORKER_SCRIPT = "backend/scripts/review-training-worker.ts";
    private static final String TRAINING_EVAL_WORKER_SCRIPT = "backend/scripts/review-eval-worker.ts";
    private static final String EXPORT_MLX_SFT_SCRIPT = "backend/scripts/export-mlx-sft-dataset.mjs";
    private static final String EXPORT_TOGETHER_SFT_SCRIPT = "backend/scripts/export-together-sft-dataset.mjs";
    private static final String BUILD_MLX_DPO_SCRIPT = "backend/scripts/build-mlx-dpo-dataset.mjs";
    private static final String TRAIN_PEFT_SFT_SCRIPT = "backend/scripts/train-peft-sft.py";
    private static final String TRAIN_PEFT_DPO_SCRIPT = "backend/scripts/train-peft-dpo.py";
    private static final String DERIVE_MLX_RUNTIME_SCRIPT = "backend/scripts/derive-mlx-runtime-from-peft.py";
    private static final String MOCK_TRAINING_SCRIPT = "backend/scripts/mock-training-run.mjs";
    private static final String TRAIN_RUNS_DIR = "data/train/runs";
    private static final String TRAIN_OUTPUTS_DIR = "outputs/training";
    private static final String TOGETHER_REMOTE_PROVIDER = "together";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewJsonSupport json;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewTrainingCommandService trainingCommandService;
    private final ReviewDashboardQueryService dashboardQueryService;
    private final ReviewDecisionService decisionService;
    private final ReviewFinalizeService finalizeService;
    private final ReviewPipelineCommandService pipelineCommandService;
    private final ReviewPipelineStatusViewBuilder pipelineStatusViewBuilder;
    private final ReviewSnapshotSummaryService snapshotSummaryService;
    private final ReviewTrainingRunViewBuilder trainingRunViewBuilder;
    private final String datasourceUrl;
    private final String canonicalModelFamily;
    private final String trainingExecutionMode;
    private final String trainingEvalMode;
    private final String localTrainingBaseModel;
    private final String localReplyMlxModel;
    private final String remoteTrainingBaseModel;
    private final String trainingBaseModel;
    private final String trainingEvalCasesPath;
    private final String trainingEvalProvider;
    private final String trainingEvalJudgeModel;
    private final int sftBatchSize;
    private final int sftIters;
    private final String sftLearningRate;
    private final int sftNumLayers;
    private final int sftStepsPerReport;
    private final int sftStepsPerEval;
    private final int sftSaveEvery;
    private final int sftMaxSeqLength;
    private final int dpoBatchSize;
    private final int dpoIters;
    private final String dpoLearningRate;
    private final int dpoNumLayers;
    private final int dpoStepsPerReport;
    private final int dpoStepsPerEval;
    private final int dpoSaveEvery;
    private final String dpoBeta;
    private final int dpoMaxSeqLength;

    public ReviewService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewJsonSupport json,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewTrainingCommandService trainingCommandService,
        ReviewCanonicalModelCatalog canonicalModelCatalog,
        ReviewDashboardQueryService dashboardQueryService,
        ReviewDecisionService decisionService,
        ReviewFinalizeService finalizeService,
        ReviewPipelineCommandService pipelineCommandService,
        ReviewPipelineStatusViewBuilder pipelineStatusViewBuilder,
        ReviewSnapshotSummaryService snapshotSummaryService,
        ReviewTrainingRunViewBuilder trainingRunViewBuilder,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${CANONICAL_MODEL_FAMILY:}") String configuredCanonicalModelFamily,
        @Value("${TRAINING_EXECUTION_MODE:}") String trainingExecutionMode,
        @Value("${LOCAL_TRAINING_EXECUTION_MODE:}") String legacyTrainingExecutionMode,
        @Value("${LOCAL_TRAINING_EVAL_MODE:golden}") String trainingEvalMode,
        @Value("${LOCAL_CANONICAL_TRAINING_BASE_MODEL:}") String localTrainingBaseModel,
        @Value("${CANONICAL_TRAINING_BASE_MODEL:}") String legacyTrainingBaseModel,
        @Value("${LOCAL_REPLY_MLX_MODEL:}") String localReplyMlxModel,
        @Value("${REMOTE_TRAINING_BASE_MODEL:}") String remoteTrainingBaseModel,
        @Value("${LOCAL_TRAINING_EVAL_CASES:backend/scripts/eval-cases/reply-golden-v1.json}") String trainingEvalCasesPath,
        @Value("${LOCAL_TRAINING_EVAL_PROVIDER:codex}") String trainingEvalProvider,
        @Value("${LOCAL_TRAINING_EVAL_JUDGE_MODEL:}") String trainingEvalJudgeModel,
        @Value("${LOCAL_TRAINING_SFT_BATCH_SIZE:1}") int sftBatchSize,
        @Value("${LOCAL_TRAINING_SFT_ITERS:40}") int sftIters,
        @Value("${LOCAL_TRAINING_SFT_LEARNING_RATE:1e-6}") String sftLearningRate,
        @Value("${LOCAL_TRAINING_SFT_NUM_LAYERS:2}") int sftNumLayers,
        @Value("${LOCAL_TRAINING_SFT_STEPS_PER_REPORT:10}") int sftStepsPerReport,
        @Value("${LOCAL_TRAINING_SFT_STEPS_PER_EVAL:10}") int sftStepsPerEval,
        @Value("${LOCAL_TRAINING_SFT_SAVE_EVERY:20}") int sftSaveEvery,
        @Value("${LOCAL_TRAINING_SFT_MAX_SEQ_LENGTH:2048}") int sftMaxSeqLength,
        @Value("${LOCAL_TRAINING_DPO_BATCH_SIZE:1}") int dpoBatchSize,
        @Value("${LOCAL_TRAINING_DPO_ITERS:30}") int dpoIters,
        @Value("${LOCAL_TRAINING_DPO_LEARNING_RATE:5e-7}") String dpoLearningRate,
        @Value("${LOCAL_TRAINING_DPO_NUM_LAYERS:2}") int dpoNumLayers,
        @Value("${LOCAL_TRAINING_DPO_STEPS_PER_REPORT:5}") int dpoStepsPerReport,
        @Value("${LOCAL_TRAINING_DPO_STEPS_PER_EVAL:10}") int dpoStepsPerEval,
        @Value("${LOCAL_TRAINING_DPO_SAVE_EVERY:10}") int dpoSaveEvery,
        @Value("${LOCAL_TRAINING_DPO_BETA:0.1}") String dpoBeta,
        @Value("${LOCAL_TRAINING_DPO_MAX_SEQ_LENGTH:2048}") int dpoMaxSeqLength
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.json = json;
        this.commandRunner = commandRunner;
        this.trainingCommandService = trainingCommandService;
        this.dashboardQueryService = dashboardQueryService;
        this.decisionService = decisionService;
        this.finalizeService = finalizeService;
        this.pipelineCommandService = pipelineCommandService;
        this.pipelineStatusViewBuilder = pipelineStatusViewBuilder;
        this.snapshotSummaryService = snapshotSummaryService;
        this.trainingRunViewBuilder = trainingRunViewBuilder;
        this.datasourceUrl = datasourceUrl;
        ReviewCanonicalModelCatalog.CanonicalModelDefaults canonicalModelDefaults =
            canonicalModelCatalog.resolve(configuredCanonicalModelFamily);
        this.canonicalModelFamily = canonicalModelDefaults.familyId();
        this.trainingExecutionMode = normalizeTrainingExecutionMode(
            json.firstNonBlank(trainingExecutionMode, legacyTrainingExecutionMode)
        );
        this.trainingEvalMode = trainingEvalMode == null ? "golden" : trainingEvalMode.trim().toLowerCase();
        this.localTrainingBaseModel = resolveLocalTrainingBaseModel(
            localTrainingBaseModel,
            legacyTrainingBaseModel,
            canonicalModelDefaults
        );
        this.localReplyMlxModel = resolveLocalReplyMlxModel(
            localReplyMlxModel,
            canonicalModelDefaults
        );
        this.remoteTrainingBaseModel = resolveRemoteTrainingBaseModel(
            remoteTrainingBaseModel,
            legacyTrainingBaseModel,
            canonicalModelDefaults
        );
        this.trainingBaseModel = resolveTrainingBaseModel(
            this.localTrainingBaseModel,
            this.remoteTrainingBaseModel,
            this.trainingExecutionMode
        );
        this.trainingEvalCasesPath = trainingEvalCasesPath;
        this.trainingEvalProvider = trainingEvalProvider;
        this.trainingEvalJudgeModel = trainingEvalJudgeModel;
        this.sftBatchSize = sftBatchSize;
        this.sftIters = sftIters;
        this.sftLearningRate = sftLearningRate;
        this.sftNumLayers = sftNumLayers;
        this.sftStepsPerReport = sftStepsPerReport;
        this.sftStepsPerEval = sftStepsPerEval;
        this.sftSaveEvery = sftSaveEvery;
        this.sftMaxSeqLength = sftMaxSeqLength;
        this.dpoBatchSize = dpoBatchSize;
        this.dpoIters = dpoIters;
        this.dpoLearningRate = dpoLearningRate;
        this.dpoNumLayers = dpoNumLayers;
        this.dpoStepsPerReport = dpoStepsPerReport;
        this.dpoStepsPerEval = dpoStepsPerEval;
        this.dpoSaveEvery = dpoSaveEvery;
        this.dpoBeta = dpoBeta;
        this.dpoMaxSeqLength = dpoMaxSeqLength;
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
        ObjectNode sftPreflight = buildSftPreflight();
        ObjectNode dpoPreflight = buildDpoPreflight(sftPreflight);

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

        ReviewTrainingRunSpec spec = buildTrainingRunSpec(kind);
        trainingCommandService.createAndStartTrainingRun(
            spec,
            shouldRunTrainingInline(),
            TRAINING_WORKER_SCRIPT
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
        if (!isSmokeTrainingEvaluationMode()) {
            if (json.blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:")) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "실운영 Golden-set Evaluation은 Postgres 환경에서만 지원합니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(TSX_RELATIVE_PATH)) || !commandRunner.pathExists(commandRunner.resolveProjectPath(TRAINING_EVAL_WORKER_SCRIPT))) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation worker 실행 파일이 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(trainingEvalCasesPath))) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation case 파일을 찾지 못했습니다.");
            }
        }

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
            shouldRunTrainingEvaluationInline(),
            new ReviewTrainingEvaluationWorkerSpec(
                TRAINING_EVAL_WORKER_SCRIPT,
                commandRunner.resolveRequiredProjectPath(trainingEvalCasesPath).toString(),
                trainingEvalProvider,
                trainingEvalJudgeModel
            )
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

    private ObjectNode buildSftPreflight() {
        ObjectNode preflight = emptyPreflight("sft");
        ArrayNode blockingIssues = objectMapper.createArrayNode();
        blockingIssues.addAll(finalizeService.getFinalizeBlockingIssues());
        preflight.put("executionMode", currentTrainingBackend());
        preflight.put("trainingBackend", currentTrainingBackend());

        Optional<ReviewSnapshotSummary> dataset = snapshotSummaryService.getActiveSnapshotSummary("sft");
        preflight.set("dataset", datasetNode(dataset));

        if (!commandRunner.pathExists(commandRunner.resolveProjectPath("node_modules/.bin/tsx")) || !commandRunner.pathExists(commandRunner.resolveProjectPath("backend/scripts/review-training-worker.ts"))) {
            blockingIssues.add("training worker 실행 파일이 없어 SFT 학습을 시작할 수 없습니다.");
        }
        if (isSmokeTrainingMode()) {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(MOCK_TRAINING_SCRIPT))) {
                blockingIssues.add("training smoke script가 없어 SFT 학습 smoke 실행을 시작할 수 없습니다.");
            }
        } else if (isTogetherTrainingMode()) {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(EXPORT_TOGETHER_SFT_SCRIPT))) {
                blockingIssues.add("Together SFT dataset exporter 스크립트가 없습니다.");
            }
        } else {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(".venv/bin/python"))) {
                blockingIssues.add("`.venv/bin/python`이 없어 PEFT SFT 학습을 실행할 수 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(TRAIN_PEFT_SFT_SCRIPT))) {
                blockingIssues.add("PEFT SFT trainer 스크립트가 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(DERIVE_MLX_RUNTIME_SCRIPT))) {
                blockingIssues.add("MLX runtime 파생 스크립트가 없습니다.");
            }
            List<String> missingModules = Stream.of("torch", "transformers", "peft", "datasets", "mlx_lm")
                .filter(module -> !commandRunner.hasVenvModule(module))
                .toList();
            if (!missingModules.isEmpty()) {
                blockingIssues.add(missingModuleMessage(missingModules));
            }
        }
        if (dataset.isEmpty() || dataset.get().rowCount() <= 0) {
            blockingIssues.add("최종 SFT 데이터셋이 없거나 비어 있습니다.");
        }

        String fingerprint = dataset.map(summary -> fingerprintJson(sftPreflightFingerprint(summary))).orElse(null);
        Optional<ReviewRepository.TrainingRunRow> duplicate = fingerprint == null
            ? Optional.empty()
            : reviewRepository.findTrainingRunByFingerprint("sft", fingerprint);

        preflight.put("alreadyTrained", duplicate.map(row -> "succeeded".equals(row.state())).orElse(false));
        preflight.set("duplicateRunId", json.nullableTextNode(duplicate.map(ReviewRepository.TrainingRunRow::runUid).orElse(null)));
        if (duplicate.isPresent()) {
            blockingIssues.add(
                "running".equals(duplicate.get().state())
                    ? "같은 SFT 학습이 이미 실행 중입니다. runId=" + duplicate.get().runUid()
                    : "같은 SFT 데이터와 설정으로 이미 학습했습니다. runId=" + duplicate.get().runUid()
            );
        }
        preflight.set("blockingIssues", blockingIssues);
        preflight.put("canStart", dataset.isPresent() && dataset.get().rowCount() > 0 && fingerprint != null && blockingIssues.isEmpty());
        return preflight;
    }

    private ObjectNode buildDpoPreflight(ObjectNode sftPreflight) {
        ObjectNode preflight = emptyPreflight("dpo");
        ArrayNode blockingIssues = objectMapper.createArrayNode();
        blockingIssues.addAll(finalizeService.getFinalizeBlockingIssues());
        preflight.put("trainingBackend", currentTrainingBackend());

        Optional<ReviewSnapshotSummary> dataset = snapshotSummaryService.getActiveSnapshotSummary("preference");
        preflight.set("dataset", datasetNode(dataset));

        if (isTogetherTrainingMode()) {
            preflight.put("executionMode", "unsupported");
            blockingIssues.add("Together serverless LoRA 전환 1차에서는 DPO를 지원하지 않습니다.");
            preflight.set("blockingIssues", blockingIssues);
            preflight.put("canStart", false);
            return preflight;
        }

        if (!commandRunner.pathExists(commandRunner.resolveProjectPath("node_modules/.bin/tsx")) || !commandRunner.pathExists(commandRunner.resolveProjectPath("backend/scripts/review-training-worker.ts"))) {
            blockingIssues.add("training worker 실행 파일이 없어 DPO 학습을 시작할 수 없습니다.");
        }
        if (isSmokeTrainingMode()) {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(MOCK_TRAINING_SCRIPT))) {
                blockingIssues.add("training smoke script가 없어 DPO 학습 smoke 실행을 시작할 수 없습니다.");
            }
        } else {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(".venv/bin/python"))) {
                blockingIssues.add("`.venv/bin/python`이 없어 DPO 학습을 실행할 수 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(TRAIN_PEFT_DPO_SCRIPT))) {
                blockingIssues.add("PEFT DPO trainer 스크립트가 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(DERIVE_MLX_RUNTIME_SCRIPT))) {
                blockingIssues.add("MLX runtime 파생 스크립트가 없습니다.");
            }
            List<String> missingModules = Stream.of("torch", "transformers", "peft", "trl", "datasets", "mlx_lm")
                .filter(module -> !commandRunner.hasVenvModule(module))
                .toList();
            if (!missingModules.isEmpty()) {
                blockingIssues.add(missingModuleMessage(missingModules));
            }
        }
        if (dataset.isEmpty() || dataset.get().rowCount() <= 0) {
            blockingIssues.add("최종 preference 데이터셋이 없거나 비어 있습니다.");
        }

        Optional<ReviewRepository.TrainingRunRow> latestSftRun = reviewRepository.findLatestSuccessfulTrainingRun("sft");
        if (latestSftRun.isEmpty() || json.blank(latestSftRun.get().outputAdapterPath())) {
            blockingIssues.add("먼저 성공한 SFT 학습 결과가 있어야 DPO를 실행할 수 있습니다.");
        } else {
            preflight.set("parentRunId", json.nullableTextNode(latestSftRun.get().runUid()));
            preflight.set("adapterPath", json.nullableTextNode(latestSftRun.get().outputAdapterPath()));
        }

        String sftFingerprint = json.extractText(json.object(sftPreflight.get("dataset")), "fingerprint");
        String parentSourceFingerprint = latestSftRun.map(ReviewRepository.TrainingRunRow::sourceFingerprint).orElse(null);
        String sftFingerprintRelation = null;
        if (sftFingerprint != null && parentSourceFingerprint != null) {
            sftFingerprintRelation = sftFingerprint.equals(parentSourceFingerprint) ? "match" : "mismatch";
        }
        preflight.set("sftFingerprintRelation", json.nullableTextNode(sftFingerprintRelation));

        boolean needsNewSft =
            latestSftRun.isEmpty() ||
            json.blank(latestSftRun.get().outputAdapterPath()) ||
            "mismatch".equals(sftFingerprintRelation);
        preflight.put("executionMode", needsNewSft ? "needs_new_sft" : "reuse_existing_sft");

        if ("mismatch".equals(sftFingerprintRelation)) {
            blockingIssues.add("현재 finalized SFT 데이터로 먼저 새 SFT 학습을 완료해야 DPO를 실행할 수 있습니다.");
        }

        String fingerprint = null;
        if (dataset.isPresent() && latestSftRun.isPresent() && !json.blank(latestSftRun.get().runFingerprint())) {
            fingerprint = fingerprintJson(dpoPreflightFingerprint(dataset.get(), latestSftRun.get()));
        }

        Optional<ReviewRepository.TrainingRunRow> duplicate = fingerprint == null
            ? Optional.empty()
            : reviewRepository.findTrainingRunByFingerprint("dpo", fingerprint);

        preflight.put("alreadyTrained", duplicate.map(row -> "succeeded".equals(row.state())).orElse(false));
        preflight.set("duplicateRunId", json.nullableTextNode(duplicate.map(ReviewRepository.TrainingRunRow::runUid).orElse(null)));
        if (duplicate.isPresent()) {
            blockingIssues.add(
                "running".equals(duplicate.get().state())
                    ? "같은 DPO 학습이 이미 실행 중입니다. runId=" + duplicate.get().runUid()
                    : "같은 DPO 데이터와 설정으로 이미 학습했습니다. runId=" + duplicate.get().runUid()
            );
        }

        preflight.set("blockingIssues", blockingIssues);
        preflight.put(
            "canStart",
            dataset.isPresent() &&
            dataset.get().rowCount() > 0 &&
            latestSftRun.isPresent() &&
            fingerprint != null &&
            blockingIssues.isEmpty()
        );
        return preflight;
    }

    private ObjectNode emptyPreflight(String kind) {
        ObjectNode preflight = objectMapper.createObjectNode();
        preflight.put("kind", kind);
        preflight.put("canStart", false);
        preflight.put("alreadyTrained", false);
        preflight.set("duplicateRunId", NullNode.instance);
        preflight.set("parentRunId", NullNode.instance);
        preflight.set("adapterPath", NullNode.instance);
        preflight.set("sftFingerprintRelation", NullNode.instance);
        preflight.set("executionMode", NullNode.instance);
        preflight.set("trainingBackend", NullNode.instance);
        preflight.set("blockingIssues", objectMapper.createArrayNode());
        preflight.set("dataset", datasetNode(Optional.empty()));
        return preflight;
    }

    private ObjectNode datasetNode(Optional<ReviewSnapshotSummary> dataset) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("exists", dataset.isPresent());
        node.set("manifestPath", json.nullableTextNode(dataset.map(ReviewSnapshotSummary::manifestPath).orElse(null)));
        node.set("datasetVersion", json.nullableTextNode(dataset.map(ReviewSnapshotSummary::datasetVersion).orElse(null)));
        node.set("fingerprint", json.nullableTextNode(dataset.map(ReviewSnapshotSummary::fingerprint).orElse(null)));
        node.set("rowCount", json.nullableNumberNode(dataset.map(summary -> Integer.valueOf(summary.rowCount())).orElse(null)));
        return node;
    }

    private LinkedHashMap<String, Object> sftPreflightFingerprint(ReviewSnapshotSummary dataset) {
        LinkedHashMap<String, Object> root = new LinkedHashMap<>();
        root.put("kind", "sft");
        root.put("baseModel", trainingBaseModel);
        root.put("sourceFingerprint", dataset.fingerprint());
        root.put("training", sftTrainingArgs());
        LinkedHashMap<String, Object> build = new LinkedHashMap<>();
        build.put("inputFormat", "compact");
        build.put("assistantFormat", "reply_text");
        root.put("build", build);
        return root;
    }

    private LinkedHashMap<String, Object> dpoPreflightFingerprint(
        ReviewSnapshotSummary dataset,
        ReviewRepository.TrainingRunRow latestSftRun
    ) {
        LinkedHashMap<String, Object> root = new LinkedHashMap<>();
        root.put("kind", "dpo");
        root.put("baseModel", trainingBaseModel);
        root.put("sourceFingerprint", dataset.fingerprint());
        root.put("parentRunUid", latestSftRun.runUid());
        root.put("parentFingerprint", latestSftRun.runFingerprint());
        root.put("training", dpoTrainingArgs());
        return root;
    }

    private LinkedHashMap<String, Object> sftTrainingArgs() {
        LinkedHashMap<String, Object> args = new LinkedHashMap<>();
        args.put("batchSize", sftBatchSize);
        args.put("iters", sftIters);
        args.put("learningRate", sftLearningRate);
        args.put("numLayers", sftNumLayers);
        args.put("stepsPerReport", sftStepsPerReport);
        args.put("stepsPerEval", sftStepsPerEval);
        args.put("saveEvery", sftSaveEvery);
        args.put("maxSeqLength", sftMaxSeqLength);
        return args;
    }

    private LinkedHashMap<String, Object> dpoTrainingArgs() {
        LinkedHashMap<String, Object> args = new LinkedHashMap<>();
        args.put("batchSize", dpoBatchSize);
        args.put("iters", dpoIters);
        args.put("learningRate", dpoLearningRate);
        args.put("numLayers", dpoNumLayers);
        args.put("stepsPerReport", dpoStepsPerReport);
        args.put("stepsPerEval", dpoStepsPerEval);
        args.put("saveEvery", dpoSaveEvery);
        args.put("beta", dpoBeta);
        args.put("maxSeqLength", dpoMaxSeqLength);
        return args;
    }

    private String fingerprintJson(LinkedHashMap<String, Object> payload) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(json.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte value : hashed) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to fingerprint training spec.", error);
        }
    }

    private ReviewTrainingRunSpec buildTrainingRunSpec(String kind) {
        Optional<ReviewSnapshotSummary> snapshot = snapshotSummaryService.getActiveSnapshotSummary("sft".equals(kind) ? "sft" : "preference");
        if (snapshot.isEmpty()) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "활성 snapshot을 찾지 못했습니다.");
        }

        String runUid = Instant.now().toString().replaceAll("[:.]", "-") + "_" + kind;
        String trainingBackend = currentTrainingBackend();
        Path datasetDir = commandRunner.resolveRequiredProjectPath(TRAIN_RUNS_DIR).resolve(runUid).resolve("dataset");
        Path outputRootDir = commandRunner.resolveRequiredProjectPath(TRAIN_OUTPUTS_DIR).resolve(runUid);
        Path adapterPath = outputRootDir.resolve("canonical");
        Path runtimeArtifactPath = outputRootDir.resolve("runtime");
        String runtimeArtifactKind = "mlx_fused_model";
        Path trainingResultPath = outputRootDir.resolve("training-result.json");
        Path logPath = commandRunner.resolveRequiredProjectPath(TRAIN_RUNS_DIR).resolve(runUid).resolve("worker.log");
        String sourceFingerprint = snapshot.get().fingerprint();
        String remoteProvider = null;

        String parentRunUid = null;
        String fingerprint;
        ReviewRepository.TrainingRunRow latestSftRun = null;
        if ("sft".equals(kind)) {
            fingerprint = fingerprintJson(sftPreflightFingerprint(snapshot.get()));
        } else {
            latestSftRun = reviewRepository.findLatestSuccessfulTrainingRun("sft")
                .orElseThrow(() -> new ReviewApiException(HttpStatus.CONFLICT, "먼저 성공한 SFT 학습 결과가 있어야 DPO를 실행할 수 있습니다."));
            parentRunUid = latestSftRun.runUid();
            fingerprint = fingerprintJson(dpoPreflightFingerprint(snapshot.get(), latestSftRun));
        }

        ReviewCommandSpec buildCommand;
        ReviewCommandSpec trainCommand;
        ReviewCommandSpec deriveCommand = null;
        if (isSmokeTrainingMode()) {
            Path mockScriptPath = commandRunner.resolveRequiredProjectPath(MOCK_TRAINING_SCRIPT);
            buildCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    mockScriptPath.toString(),
                    "--mode",
                    "sft".equals(kind) ? "build_sft" : "build_dpo",
                    "--output-dir",
                    datasetDir.toString(),
                    "--snapshot-id",
                    String.valueOf(snapshot.get().snapshotId())
                )
            );
            ArrayList<String> smokeTrainArgs = new ArrayList<>(List.of(
                mockScriptPath.toString(),
                "--mode",
                "sft".equals(kind) ? "train_sft" : "train_dpo",
                "--adapter-path",
                adapterPath.toString(),
                "--runtime-artifact-path",
                runtimeArtifactPath.toString(),
                "--runtime-artifact-kind",
                runtimeArtifactKind,
                "--manifest-path",
                trainingResultPath.toString(),
                "--dataset-dir",
                datasetDir.toString(),
                "--canonical-model-family",
                canonicalModelFamily,
                "--run-id",
                runUid
            ));
            if (!"sft".equals(kind) && latestSftRun != null && !json.blank(latestSftRun.outputAdapterPath())) {
                smokeTrainArgs.add("--reference-adapter-path");
                smokeTrainArgs.add(latestSftRun.outputAdapterPath());
            }
            trainCommand = new ReviewCommandSpec(commandRunner.tsxBinary().toString(), smokeTrainArgs);
            deriveCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    mockScriptPath.toString(),
                    "--mode",
                    "derive_runtime",
                    "--adapter-path",
                    adapterPath.toString(),
                    "--runtime-artifact-path",
                    runtimeArtifactPath.toString(),
                    "--runtime-artifact-kind",
                    runtimeArtifactKind,
                    "--manifest-path",
                    trainingResultPath.toString(),
                    "--canonical-model-family",
                    canonicalModelFamily,
                    "--run-id",
                    runUid
                )
            );
        } else if (isTogetherTrainingMode()) {
            if (!"sft".equals(kind)) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Together serverless LoRA 전환 1차에서는 DPO를 지원하지 않습니다.");
            }
            buildCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    commandRunner.resolveRequiredProjectPath(EXPORT_TOGETHER_SFT_SCRIPT).toString(),
                    "--snapshot-id",
                    String.valueOf(snapshot.get().snapshotId()),
                    "--output-dir",
                    datasetDir.toString(),
                    "--input-format",
                    "compact",
                    "--assistant-format",
                    "reply_text"
                )
            );
            trainCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    commandRunner.resolveRequiredProjectPath(TRAINING_WORKER_SCRIPT).toString(),
                    "--run-id",
                    runUid,
                    "--remote-backend",
                    TOGETHER_REMOTE_PROVIDER
                )
            );
            remoteProvider = TOGETHER_REMOTE_PROVIDER;
            adapterPath = null;
            runtimeArtifactPath = null;
            runtimeArtifactKind = null;
        } else {
            buildCommand = "sft".equals(kind)
                ? new ReviewCommandSpec(
                    commandRunner.tsxBinary().toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(EXPORT_MLX_SFT_SCRIPT).toString(),
                        "--snapshot-id",
                        String.valueOf(snapshot.get().snapshotId()),
                        "--output-dir",
                        datasetDir.toString(),
                        "--input-format",
                        "compact",
                        "--assistant-format",
                        "reply_text"
                    )
                )
                : new ReviewCommandSpec(
                    commandRunner.tsxBinary().toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(BUILD_MLX_DPO_SCRIPT).toString(),
                        "--snapshot-id",
                        String.valueOf(snapshot.get().snapshotId()),
                        "--output-dir",
                        datasetDir.toString()
                    )
                );

            trainCommand = "sft".equals(kind)
                ? new ReviewCommandSpec(
                    commandRunner.resolveRequiredProjectPath(".venv/bin/python").toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(TRAIN_PEFT_SFT_SCRIPT).toString(),
                        "--model",
                        trainingBaseModel,
                        "--data-dir",
                        datasetDir.toString(),
                        "--output-dir",
                        adapterPath.toString(),
                        "--iters",
                        String.valueOf(sftIters),
                        "--batch-size",
                        String.valueOf(sftBatchSize),
                        "--learning-rate",
                        sftLearningRate,
                        "--max-seq-length",
                        String.valueOf(sftMaxSeqLength)
                    )
                )
                : new ReviewCommandSpec(
                    commandRunner.resolveRequiredProjectPath(".venv/bin/python").toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(TRAIN_PEFT_DPO_SCRIPT).toString(),
                        "--model",
                        trainingBaseModel,
                        "--data-dir",
                        datasetDir.toString(),
                        "--reference-adapter-dir",
                        latestSftRun.outputAdapterPath(),
                        "--output-dir",
                        adapterPath.toString(),
                        "--iters",
                        String.valueOf(dpoIters),
                        "--batch-size",
                        String.valueOf(dpoBatchSize),
                        "--learning-rate",
                        dpoLearningRate,
                        "--num-layers",
                        String.valueOf(dpoNumLayers),
                        "--steps-per-report",
                        String.valueOf(dpoStepsPerReport),
                        "--steps-per-eval",
                        String.valueOf(dpoStepsPerEval),
                        "--save-every",
                        String.valueOf(dpoSaveEvery),
                        "--beta",
                        dpoBeta,
                        "--max-seq-length",
                        String.valueOf(dpoMaxSeqLength)
                    )
                );
            deriveCommand = new ReviewCommandSpec(
                commandRunner.resolveRequiredProjectPath(".venv/bin/python").toString(),
                List.of(
                    commandRunner.resolveRequiredProjectPath(DERIVE_MLX_RUNTIME_SCRIPT).toString(),
                    "--model",
                    trainingBaseModel,
                    "--canonical-model-family",
                    canonicalModelFamily,
                    "--runtime-base-model",
                    localReplyMlxModel,
                    "--adapter-dir",
                    adapterPath.toString(),
                    "--output-dir",
                    runtimeArtifactPath.toString(),
                    "--runtime-kind",
                    runtimeArtifactKind,
                    "--manifest-path",
                    trainingResultPath.toString()
                )
            );
        }

        return new ReviewTrainingRunSpec(
            runUid,
            kind,
            trainingBackend,
            canonicalModelFamily,
            fingerprint,
            sourceFingerprint,
            snapshot.get().datasetVersion(),
            parentRunUid,
            snapshot.get().snapshotId(),
            trainingBaseModel,
            datasetDir.toString(),
            outputRootDir.toString(),
            adapterPath == null ? null : adapterPath.toString(),
            runtimeArtifactPath == null ? null : runtimeArtifactPath.toString(),
            runtimeArtifactKind,
            remoteProvider,
            trainingResultPath.toString(),
            logPath.toString(),
            new ReviewTrainingCommandBundle(buildCommand, trainCommand, deriveCommand)
        );
    }

    private boolean isSmokeTrainingMode() {
        return "smoke".equals(trainingExecutionMode);
    }

    private boolean isTogetherTrainingMode() {
        return "together_serverless_lora".equals(trainingExecutionMode);
    }

    private String currentTrainingBackend() {
        if (isSmokeTrainingMode()) {
            return "smoke";
        }
        if (isTogetherTrainingMode()) {
            return "together_serverless_lora";
        }
        return "local_peft";
    }

    private static String normalizeTrainingExecutionMode(String rawMode) {
        if (rawMode == null || rawMode.isBlank()) {
            return "local_peft";
        }
        String normalized = rawMode.trim().toLowerCase();
        if ("smoke".equals(normalized)) {
            return "smoke";
        }
        if ("together_serverless_lora".equals(normalized)) {
            return "together_serverless_lora";
        }
        return "local_peft";
    }

    private static String resolveLocalTrainingBaseModel(
        String configuredLocalBaseModel,
        String legacyBaseModel,
        ReviewCanonicalModelCatalog.CanonicalModelDefaults canonicalDefaults
    ) {
        String configuredBaseModel = configuredLocalBaseModel;
        if (configuredBaseModel == null || configuredBaseModel.isBlank()) {
            configuredBaseModel = legacyBaseModel;
        }
        if (configuredBaseModel != null && !configuredBaseModel.isBlank()) {
            return configuredBaseModel.trim();
        }
        return canonicalDefaults.localTrainingBaseModelId();
    }

    private static String resolveLocalReplyMlxModel(
        String configuredRuntimeBaseModel,
        ReviewCanonicalModelCatalog.CanonicalModelDefaults canonicalDefaults
    ) {
        if (configuredRuntimeBaseModel != null && !configuredRuntimeBaseModel.isBlank()) {
            return configuredRuntimeBaseModel.trim();
        }
        return canonicalDefaults.localReplyMlxModelId();
    }

    private static String resolveRemoteTrainingBaseModel(
        String configuredRemoteBaseModel,
        String legacyBaseModel,
        ReviewCanonicalModelCatalog.CanonicalModelDefaults canonicalDefaults
    ) {
        String configuredBaseModel = configuredRemoteBaseModel;
        if (configuredBaseModel == null || configuredBaseModel.isBlank()) {
            configuredBaseModel = legacyBaseModel;
        }
        if (configuredBaseModel != null && !configuredBaseModel.isBlank()) {
            return configuredBaseModel.trim();
        }
        return canonicalDefaults.remoteTrainingBaseModelId();
    }

    private static String resolveTrainingBaseModel(
        String localBaseModel,
        String remoteBaseModel,
        String executionMode
    ) {
        return "together_serverless_lora".equals(executionMode) ? remoteBaseModel : localBaseModel;
    }

    private boolean shouldRunTrainingInline() {
        return isSmokeTrainingMode() && (json.blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:"));
    }

    private boolean isSmokeTrainingEvaluationMode() {
        return "smoke".equals(trainingEvalMode);
    }

    private boolean shouldRunTrainingEvaluationInline() {
        return isSmokeTrainingEvaluationMode();
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

    private String missingModuleMessage(List<String> modules) {
        return "PEFT/MLX 학습 의존성이 없습니다: " + String.join(", ", modules) +
            ". `.venv/bin/pip install -r backend/requirements-peft.txt`가 필요합니다.";
    }

}
