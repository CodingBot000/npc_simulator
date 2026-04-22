package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ReviewService {

    private static final String DEFAULT_NOTES = "";
    private static final String TSX_RELATIVE_PATH = "node_modules/.bin/tsx";
    private static final String FINALIZE_SFT_SCRIPT = "backend/scripts/finalize-sft-dataset.mjs";
    private static final String FINALIZE_PREFERENCE_SCRIPT = "backend/scripts/finalize-preference-dataset.mjs";
    private static final String SNAPSHOT_SYNC_SCRIPT = "backend/scripts/review-sync-snapshots.ts";
    private static final String TRAINING_WORKER_SCRIPT = "backend/scripts/review-training-worker.ts";
    private static final String TRAINING_EVAL_WORKER_SCRIPT = "backend/scripts/review-eval-worker.ts";
    private static final String JUDGE_REVIEW_QUEUE_SCRIPT = "backend/scripts/judge-review-queue.mjs";
    private static final String PREPARE_HUMAN_REVIEW_SCRIPT = "backend/scripts/prepare-human-review.mjs";
    private static final String LLM_FIRST_PASS_REVIEW_QUEUE_SCRIPT = "backend/scripts/llm-first-pass-review-queue.mjs";
    private static final String EXPORT_MLX_SFT_SCRIPT = "backend/scripts/export-mlx-sft-dataset.mjs";
    private static final String EXPORT_TOGETHER_SFT_SCRIPT = "backend/scripts/export-together-sft-dataset.mjs";
    private static final String BUILD_MLX_DPO_SCRIPT = "backend/scripts/build-mlx-dpo-dataset.mjs";
    private static final String TRAIN_PEFT_SFT_SCRIPT = "backend/scripts/train-peft-sft.py";
    private static final String TRAIN_PEFT_DPO_SCRIPT = "backend/scripts/train-peft-dpo.py";
    private static final String DERIVE_MLX_RUNTIME_SCRIPT = "backend/scripts/derive-mlx-runtime-from-peft.py";
    private static final String MOCK_TRAINING_SCRIPT = "backend/scripts/mock-training-run.mjs";
    private static final String TRAIN_RUNS_DIR = "data/train/runs";
    private static final String TRAIN_OUTPUTS_DIR = "outputs/training";
    private static final String JUDGE_REVIEW_SUMMARY_PATH = "data/evals/judged/judge-summary.json";
    private static final String HUMAN_REVIEW_SUMMARY_PATH = "data/review/live/human_review_summary.json";
    private static final String LLM_FIRST_PASS_SUMMARY_PATH = "data/review/live/llm_first_pass_summary.json";
    private static final String EPISODE_EXPORT_DIR = "data/datasets/episodes";
    private static final String FINALIZE_SFT_KEEP_INPUT = "data/evals/filtered-live/keep_sft.jsonl";
    private static final String FINALIZE_SFT_OUTPUT_DIR = "data/train/sft/live";
    private static final String FINALIZE_PREFERENCE_INPUT = "data/evals/preference/candidate_pairs_live_gap1.jsonl";
    private static final String FINALIZE_PREFERENCE_OUTPUT_DIR = "data/train/preference/live";
    private static final int SHADOW_INVALID_CASE_LIMIT = 8;
    private static final String DEFAULT_LOCAL_CANONICAL_TRAINING_BASE_MODEL =
        "unsloth/Meta-Llama-3.1-8B-Instruct";
    private static final String DEFAULT_LOCAL_REPLY_MLX_MODEL =
        "mlx-community/Llama-3.1-8B-Instruct-4bit";
    private static final String DEFAULT_REMOTE_TRAINING_BASE_MODEL =
        "meta-llama/Meta-Llama-3.1-8B-Instruct-Reference";
    private static final String TOGETHER_REMOTE_PROVIDER = "together";

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;
    private final Path repoRoot;
    private final String datasourceUrl;
    private final String datasourceUsername;
    private final String datasourcePassword;
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
        PlatformTransactionManager transactionManager,
        @Value("${NPC_SIMULATOR_ROOT:}") String repoRoot,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${spring.datasource.username:}") String datasourceUsername,
        @Value("${spring.datasource.password:}") String datasourcePassword,
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
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.repoRoot = (repoRoot == null || repoRoot.isBlank()) ? null : Path.of(repoRoot);
        this.datasourceUrl = datasourceUrl;
        this.datasourceUsername = datasourceUsername;
        this.datasourcePassword = datasourcePassword;
        this.trainingExecutionMode = normalizeTrainingExecutionMode(
            firstNonBlank(trainingExecutionMode, legacyTrainingExecutionMode)
        );
        this.trainingEvalMode = trainingEvalMode == null ? "golden" : trainingEvalMode.trim().toLowerCase();
        this.localTrainingBaseModel = resolveLocalTrainingBaseModel(localTrainingBaseModel, legacyTrainingBaseModel);
        this.localReplyMlxModel = resolveLocalReplyMlxModel(localReplyMlxModel);
        this.remoteTrainingBaseModel = resolveRemoteTrainingBaseModel(remoteTrainingBaseModel, legacyTrainingBaseModel);
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
        for (JsonNode entry : loadJsonl(resolveProjectPath("data/evals/judged/judged-review-live.jsonl"))) {
            String rowId = extractText(entry, "rowId");
            if (rowId == null || !sourceRowKeys.contains(rowId)) {
                completedSftItems.add(buildCompletedSftItemView(object(entry)));
            }
        }

        ArrayNode completedPairItems = objectMapper.createArrayNode();
        for (JsonNode entry : loadJsonl(resolveProjectPath("data/evals/preference/candidate_pairs_live_gap1.jsonl"))) {
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

    public JsonNode getPipelineStatus(HttpHeaders headers) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("reviewTasks", buildReviewPipelineTaskCounts());
        response.set("judge", buildPipelineSummary("judge", JUDGE_REVIEW_SUMMARY_PATH));
        response.set("humanQueue", buildPipelineSummary("humanQueue", HUMAN_REVIEW_SUMMARY_PATH));
        response.set("llmFirstPass", buildPipelineSummary("llmFirstPass", LLM_FIRST_PASS_SUMMARY_PATH));
        return response;
    }

    public JsonNode runJudgeReviewQueue(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String mode = optionalEnum(
            payload,
            "mode",
            List.of("heuristic", "llm", "hybrid"),
            "잘못된 review judge mode 입니다."
        );
        String provider = optionalEnum(
            payload,
            "provider",
            List.of("codex", "openai"),
            "잘못된 review judge provider 입니다."
        );
        Integer limit = optionalPositiveInteger(payload, "limit", "review judge limit 는 1 이상의 정수여야 합니다.");
        boolean dryRun = optionalBoolean(payload, "dryRun", false);
        boolean verbose = optionalBoolean(payload, "verbose", false);

        ArrayList<String> command = new ArrayList<>(List.of(
            tsxBinary().toString(),
            resolveRequiredProjectPath(JUDGE_REVIEW_QUEUE_SCRIPT).toString()
        ));
        addOptionalArgument(command, "--input", trimToNull(extractText(payload, "input")));
        addOptionalArgument(command, "--output", trimToNull(extractText(payload, "output")));
        addOptionalArgument(command, "--mode", mode);
        addOptionalArgument(command, "--provider", provider);
        addOptionalIntegerArgument(command, "--limit", limit);
        addOptionalFlag(command, "--dry-run", dryRun);
        addOptionalFlag(command, "--verbose", verbose);

        ProcessResult result = runNodeCommand(command);
        return pipelineRunResponse("judge", result, headers);
    }

    public JsonNode runPrepareHumanReview(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        boolean skipDbSync = optionalBoolean(payload, "skipDbSync", false);
        requirePostgresReviewPipelineSync(skipDbSync, "prepare-human-review");

        ArrayList<String> command = new ArrayList<>(List.of(
            tsxBinary().toString(),
            resolveRequiredProjectPath(PREPARE_HUMAN_REVIEW_SCRIPT).toString()
        ));
        addOptionalArgument(command, "--review-input", trimToNull(extractText(payload, "reviewInput")));
        addOptionalArgument(command, "--pairs-input", trimToNull(extractText(payload, "pairsInput")));
        addOptionalArgument(command, "--collector-input", trimToNull(extractText(payload, "collectorInput")));
        addOptionalArgument(command, "--output-dir", trimToNull(extractText(payload, "outputDir")));
        addOptionalFlag(command, "--skip-db-sync", skipDbSync);

        ProcessResult result = runNodeCommand(command);
        return pipelineRunResponse("prepare_human_review", result, headers);
    }

    public JsonNode runReviewLlmFirstPass(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        boolean skipDbSync = optionalBoolean(payload, "skipDbSync", false);
        requirePostgresReviewPipelineSync(skipDbSync, "llm-first-pass-review-queue");
        String provider = optionalEnum(
            payload,
            "provider",
            List.of("codex", "openai"),
            "잘못된 llm first-pass provider 입니다."
        );

        ArrayList<String> command = new ArrayList<>(List.of(
            tsxBinary().toString(),
            resolveRequiredProjectPath(LLM_FIRST_PASS_REVIEW_QUEUE_SCRIPT).toString()
        ));
        addOptionalArgument(command, "--sft-input", trimToNull(extractText(payload, "sftInput")));
        addOptionalArgument(command, "--pair-input", trimToNull(extractText(payload, "pairInput")));
        addOptionalArgument(command, "--output-dir", trimToNull(extractText(payload, "outputDir")));
        addOptionalArgument(command, "--provider", provider);
        addOptionalFlag(command, "--skip-db-sync", skipDbSync);

        ProcessResult result = runNodeCommand(command);
        return pipelineRunResponse("llm_first_pass", result, headers);
    }

    public JsonNode updateDecision(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String kind = requiredEnum(payload, "kind", List.of("sft", "pair"), "잘못된 검수 저장 요청입니다.");
        String reviewId = requiredText(payload, "reviewId", "검수 항목 ID가 필요합니다.");
        String decision = optionalEnum(
            payload,
            "decision",
            "sft".equals(kind)
                ? List.of("include", "exclude", "escalate")
                : List.of("include", "flip", "exclude", "escalate"),
            "잘못된 검수 결정 값입니다."
        );
        String reviewer = trimToNull(extractText(payload, "reviewer"));
        String notes = extractText(payload, "notes", DEFAULT_NOTES);
        String nextStatus = decision == null ? "pending" : "reviewed";
        String reviewedAt = decision == null ? null : java.time.Instant.now().toString();

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
            response.set("item", buildSftItemView(updatedTask, candidate));
        } else {
            ReviewRepository.PairRow pair = reviewRepository.findPair(updatedTask.preferencePairId() == null ? -1 : updatedTask.preferencePairId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 preference pair를 찾지 못했습니다."));
            ReviewRepository.CandidateRow chosen = reviewRepository.findCandidate(pair.chosenCandidateId() == null ? -1 : pair.chosenCandidateId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 chosen candidate를 찾지 못했습니다."));
            ReviewRepository.CandidateRow rejected = reviewRepository.findCandidate(pair.rejectedCandidateId() == null ? -1 : pair.rejectedCandidateId())
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "업데이트된 rejected candidate를 찾지 못했습니다."));
            response.set("item", buildPairItemView(updatedTask, pair, chosen, rejected));
        }
        return response;
    }

    public JsonNode getFinalizeStatus(HttpHeaders headers) {
        ReviewRepository.PendingCounts pending = reviewRepository.getPendingReviewCounts();
        String latestReviewUpdatedAt = reviewRepository.getLatestReviewUpdatedAt();
        Optional<ReviewRepository.TrainingRunRow> latestRun = reviewRepository.findLatestFinalizeRun();
        Optional<SnapshotSummary> activeSft = getActiveSnapshotSummary("sft");
        Optional<SnapshotSummary> activePreference = getActiveSnapshotSummary("preference");

        String latestSnapshotAt = newestTimestamp(activeSft.map(SnapshotSummary::generatedAt).orElse(null), activePreference.map(SnapshotSummary::generatedAt).orElse(null));
        boolean canFinalize =
            pending.total() == 0 &&
            !"running".equals(latestRun.map(ReviewRepository.TrainingRunRow::state).orElse(null)) &&
            (
                latestSnapshotAt == null ||
                latestReviewUpdatedAt == null ||
                java.time.Instant.parse(latestSnapshotAt).isBefore(java.time.Instant.parse(latestReviewUpdatedAt))
            );

        ObjectNode metrics = latestRun.map(row -> object(row.metricsJson())).orElse(objectMapper.createObjectNode());
        ObjectNode durations = object(metrics.get("durations"));
        ObjectNode outputs = object(metrics.get("outputs"));

        ObjectNode response = objectMapper.createObjectNode();
        response.put("state", latestRun.map(ReviewRepository.TrainingRunRow::state).orElse("idle"));
        response.put("canFinalize", canFinalize);
        response.set("pending", pendingNode(pending));
        response.set("currentStep", nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::currentStep).orElse(null)));
        response.set("message", nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::message).orElse(null)));
        response.set("startedAt", nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::startedAt).orElse(null)));
        response.set("finishedAt", nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::finishedAt).orElse(null)));
        response.set("updatedAt", nullableTextNode(latestRun.map(ReviewRepository.TrainingRunRow::updatedAt).orElse(null)));
        ObjectNode durationNode = objectMapper.createObjectNode();
        durationNode.set("sftMs", nullableNumberNode(extractNumber(durations, "sftMs")));
        durationNode.set("preferenceMs", nullableNumberNode(extractNumber(durations, "preferenceMs")));
        durationNode.set("totalMs", nullableNumberNode(extractNumber(durations, "totalMs")));
        response.set("durations", durationNode);
        ObjectNode outputNode = objectMapper.createObjectNode();
        outputNode.set("sft", nullableTextNode(extractText(outputs, "sft")));
        outputNode.set("preference", nullableTextNode(extractText(outputs, "preference")));
        response.set("outputs", outputNode);
        return response;
    }

    public JsonNode runFinalize(HttpHeaders headers) {
        JsonNode status = getFinalizeStatus(headers);
        int pendingTotal = object(status.get("pending")).path("total").asInt(0);
        if (pendingTotal > 0) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "사람 검수 미완료 항목이 남아 있어 finalize를 실행할 수 없습니다.");
        }
        if ("running".equals(extractText(status, "state"))) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "이미 finalize가 실행 중입니다.");
        }
        if (!status.path("canFinalize").asBoolean(false)) {
            throw new ReviewApiException(
                HttpStatus.CONFLICT,
                extractText(status, "message", "finalize를 실행할 수 없습니다.")
            );
        }

        ReviewRepository.FinalizeRunRecord run = reviewRepository.createFinalizeRun();
        Instant startedAt = Instant.now();

        try {
            ProcessResult sftResult = runNodeCommand(List.of(
                tsxBinary().toString(),
                resolveRequiredProjectPath(FINALIZE_SFT_SCRIPT).toString(),
                "--keep-input",
                FINALIZE_SFT_KEEP_INPUT,
                "--output-dir",
                FINALIZE_SFT_OUTPUT_DIR
            ));

            reviewRepository.updateFinalizeRun(
                run.runUid(),
                "running",
                "finalize_preference",
                "Preference finalize 실행 중",
                null,
                new ReviewRepository.FinalizeMetrics(
                    sftResult.durationMs(),
                    null,
                    null
                ),
                new ReviewRepository.FinalizeOutputs(
                    blankToNull(sftResult.stdout()),
                    null
                )
            );

            ProcessResult preferenceResult = runNodeCommand(List.of(
                tsxBinary().toString(),
                resolveRequiredProjectPath(FINALIZE_PREFERENCE_SCRIPT).toString(),
                "--pairs-input",
                FINALIZE_PREFERENCE_INPUT,
                "--output-dir",
                FINALIZE_PREFERENCE_OUTPUT_DIR
            ));

            runNodeCommand(List.of(
                tsxBinary().toString(),
                resolveRequiredProjectPath(SNAPSHOT_SYNC_SCRIPT).toString()
            ));

            String sftManifestPath = existingPathString(resolveRequiredProjectPath(FINALIZE_SFT_OUTPUT_DIR).resolve("manifest.json"));
            String preferenceManifestPath = existingPathString(resolveRequiredProjectPath(FINALIZE_PREFERENCE_OUTPUT_DIR).resolve("manifest.json"));
            registerFinalizeArtifacts(run.runUid());

            Instant finishedAt = Instant.now();
            reviewRepository.updateFinalizeRun(
                run.runUid(),
                "succeeded",
                null,
                "finalize 완료",
                finishedAt.toString(),
                new ReviewRepository.FinalizeMetrics(
                    sftResult.durationMs(),
                    preferenceResult.durationMs(),
                    finishedAt.toEpochMilli() - startedAt.toEpochMilli()
                ),
                new ReviewRepository.FinalizeOutputs(
                    blankToNull(sftManifestPath) != null ? sftManifestPath : blankToNull(sftResult.stdout()),
                    blankToNull(preferenceManifestPath) != null ? preferenceManifestPath : blankToNull(preferenceResult.stdout())
                )
            );
            return getFinalizeStatus(headers);
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "finalize 실행에 실패했습니다.";
            reviewRepository.updateFinalizeRun(
                run.runUid(),
                "failed",
                null,
                message,
                Instant.now().toString(),
                null,
                null
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    public JsonNode getTrainingStatus(HttpHeaders headers) {
        ObjectNode sftPreflight = buildSftPreflight();
        ObjectNode dpoPreflight = buildDpoPreflight(sftPreflight);

        List<ReviewRepository.TrainingRunRow> runs = reviewRepository.listTrainingRuns(List.of("sft", "dpo"));
        ObjectNode activeRun = null;
        ObjectNode latestRun = null;
        for (ReviewRepository.TrainingRunRow row : runs) {
            ObjectNode view = buildTrainingRunView(row);
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
        String kind = requiredEnum(payload, "kind", List.of("sft", "dpo"), "잘못된 학습 실행 요청입니다.");

        JsonNode status = getTrainingStatus(headers);
        JsonNode activeRun = status.get("activeRun");
        if (activeRun != null && !activeRun.isNull()) {
            throw new ReviewApiException(
                HttpStatus.CONFLICT,
                "이미 실행 중인 학습이 있습니다. runId=" + defaultText(extractText(activeRun, "runId"), "unknown")
            );
        }

        ObjectNode preflight = object(status.get(kind));
        if (!preflight.path("canStart").asBoolean(false)) {
            JsonNode blockingIssues = preflight.get("blockingIssues");
            String message =
                blockingIssues != null && blockingIssues.isArray() && !blockingIssues.isEmpty()
                    ? blockingIssues.get(0).asText("학습을 시작할 수 없습니다.")
                    : "학습을 시작할 수 없습니다.";
            throw new ReviewApiException(HttpStatus.CONFLICT, message);
        }

        TrainingRunSpec spec = buildTrainingRunSpec(kind);
        boolean runCreated = false;
        try {
            writeInitialTrainingLog(spec);
            reviewRepository.createTrainingRun(
                spec.runUid(),
                spec.kind(),
                spec.trainingBackend(),
                "running",
                "build_dataset",
                "sft".equals(spec.kind()) ? "SFT 학습 데이터셋 준비 중" : "DPO 학습 데이터셋 준비 중",
                spec.sourceSnapshotId(),
                spec.sourceFingerprint(),
                spec.sourceDatasetVersion(),
                spec.parentRunUid(),
                spec.baseModel(),
                spec.datasetDir(),
                spec.adapterPath(),
                spec.runtimeArtifactPath(),
                spec.runtimeArtifactKind(),
                spec.remoteProvider(),
                null,
                null,
                null,
                null,
                spec.logPath(),
                spec.trainingResultPath(),
                spec.fingerprint(),
                spec.commands()
            );
            runCreated = true;
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "run_created",
                "build_dataset",
                "sft".equals(spec.kind()) ? "새로운 SFT Base 생성 시작" : "DPO 학습 시작",
                null
            );

            if (shouldRunTrainingInline()) {
                runInlineTraining(spec);
            } else {
                startDetachedNodeCommand(List.of(
                    tsxBinary().toString(),
                    resolveRequiredProjectPath(TRAINING_WORKER_SCRIPT).toString(),
                    "--run-id",
                    spec.runUid()
                ));
            }
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "학습 실행에 실패했습니다.";

            if (runCreated && !shouldRunTrainingInline()) {
                reviewRepository.appendTrainingRunEvent(
                    spec.runUid(),
                    "error",
                    "worker_launch_failed",
                    null,
                    message,
                    null
                );
                reviewRepository.updateTrainingRunState(
                    spec.runUid(),
                    "failed",
                    null,
                    message,
                    Instant.now().toString(),
                    spec.trainingBackend(),
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
            }

            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }

        return getTrainingStatus(headers);
    }

    public JsonNode runTrainingEvaluation(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String bindingKey = optionalEnum(
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
                "학습 실행 중에는 평가를 시작할 수 없습니다. runId=" + defaultText(extractText(activeRun, "runId"), "unknown")
            );
        }
        if (!isSmokeTrainingEvaluationMode()) {
            if (blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:")) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "실운영 Golden-set Evaluation은 Postgres 환경에서만 지원합니다.");
            }
            if (!pathExists(resolveProjectPath(TSX_RELATIVE_PATH)) || !pathExists(resolveProjectPath(TRAINING_EVAL_WORKER_SCRIPT))) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation worker 실행 파일이 없습니다.");
            }
            if (!pathExists(resolveProjectPath(trainingEvalCasesPath))) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation case 파일을 찾지 못했습니다.");
            }
        }

        String requestedRunId = trimToNull(extractText(payload, "runId"));
        ReviewRepository.TrainingRunRow run = resolveTrainingRunForControlAction(requestedRunId);
        if (!"succeeded".equals(run.state())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "성공한 학습 run만 평가할 수 있습니다. runId=" + run.runUid());
        }
        if (blank(firstNonBlank(run.runtimeArtifactPath(), run.outputAdapterPath())) && blank(run.remoteModelName())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "평가 가능한 runtime artifact 또는 remote model이 없는 학습 run입니다.");
        }
        if ("running".equals(run.evalState())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "이미 Golden-set Evaluation이 실행 중입니다. runId=" + run.runUid());
        }

        PromotedBaseline baseline = resolvePromotedBaseline(bindingKey);
        String startedAt = Instant.now().toString();

        reviewRepository.updateTrainingRunEvaluation(
            run.runUid(),
            "running",
            "Golden-set Evaluation 실행 중",
            bindingKey,
            baseline.label(),
            null,
            NullNode.instance,
            startedAt,
            null
        );
        reviewRepository.appendTrainingRunEvent(
            run.runUid(),
            "info",
            "golden_eval_started",
            null,
            "Golden-set Evaluation 시작",
            objectMapper.createObjectNode()
                .put("bindingKey", bindingKey)
                .put("baselineLabel", baseline.label())
        );

        try {
            if (shouldRunTrainingEvaluationInline()) {
                runInlineTrainingEvaluation(run, bindingKey, baseline);
            } else {
                ArrayList<String> command = new ArrayList<>(List.of(
                    tsxBinary().toString(),
                    resolveRequiredProjectPath(TRAINING_EVAL_WORKER_SCRIPT).toString(),
                    "--run-id",
                    run.runUid(),
                    "--binding-key",
                    bindingKey,
                    "--baseline-label",
                    baseline.label(),
                    "--cases",
                    resolveRequiredProjectPath(trainingEvalCasesPath).toString(),
                    "--provider",
                    trainingEvalProvider
                ));
                if (baseline.adapterPath() != null) {
                    command.add("--baseline-adapter-path");
                    command.add(baseline.adapterPath());
                }
                if (baseline.remoteProvider() != null) {
                    command.add("--baseline-remote-provider");
                    command.add(baseline.remoteProvider());
                }
                if (baseline.remoteModelName() != null) {
                    command.add("--baseline-remote-model");
                    command.add(baseline.remoteModelName());
                } else if ("together_serverless_lora".equals(run.trainingBackend()) && !blank(run.baseModel())) {
                    command.add("--baseline-remote-provider");
                    command.add(TOGETHER_REMOTE_PROVIDER);
                    command.add("--baseline-remote-model");
                    command.add(run.baseModel());
                }
                if (!blank(trainingEvalJudgeModel)) {
                    command.add("--judge-model");
                    command.add(trainingEvalJudgeModel);
                }
                startDetachedNodeCommand(command);
            }
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "Golden-set Evaluation 실행에 실패했습니다.";
            reviewRepository.updateTrainingRunEvaluation(
                run.runUid(),
                "failed",
                message,
                bindingKey,
                baseline.label(),
                null,
                NullNode.instance,
                startedAt,
                Instant.now().toString()
            );
            reviewRepository.appendTrainingRunEvent(
                run.runUid(),
                "error",
                "golden_eval_failed",
                null,
                message,
                null
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }

        return getTrainingStatus(headers);
    }

    public JsonNode updateTrainingDecision(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String decision = requiredEnum(
            payload,
            "decision",
            List.of("accepted", "rejected"),
            "잘못된 학습 평가 결정입니다."
        );
        String reviewer = trimToNull(extractText(payload, "reviewer"));
        String notes = extractText(payload, "notes", DEFAULT_NOTES);

        ReviewRepository.TrainingRunRow run = resolveTrainingRunForControlAction(
            requiredText(payload, "runId", "학습 runId가 필요합니다.")
        );
        if (!"succeeded".equals(run.state())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "성공한 학습 run만 채택 여부를 결정할 수 있습니다.");
        }
        if (!"succeeded".equals(run.evalState())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "Golden-set Evaluation이 완료된 뒤에만 채택 여부를 결정할 수 있습니다.");
        }

        String reviewedAt = Instant.now().toString();
        reviewRepository.updateTrainingRunReviewDecision(
            run.runUid(),
            decision,
            notes,
            reviewer,
            reviewedAt
        );
        reviewRepository.appendTrainingRunEvent(
            run.runUid(),
            "info",
            "training_review_decided",
            null,
            "accepted".equals(decision) ? "학습 run 채택" : "학습 run 반려",
            objectMapper.createObjectNode()
                .put("decision", decision)
                .put("reviewer", defaultText(reviewer, "unknown"))
        );
        return getTrainingStatus(headers);
    }

    public JsonNode promoteTrainingRun(HttpHeaders headers, Object requestBody) {
        JsonNode payload = objectMapper.valueToTree(requestBody);
        String bindingKey = optionalEnum(
            payload,
            "bindingKey",
            List.of("default", "doctor", "supervisor", "director"),
            "잘못된 Model Promotion slot입니다."
        );
        if (bindingKey == null) {
            bindingKey = "default";
        }

        ReviewRepository.TrainingRunRow run = resolveTrainingRunForControlAction(
            requiredText(payload, "runId", "학습 runId가 필요합니다.")
        );
        if (!"succeeded".equals(run.state())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "성공한 학습 run만 Model Promotion 할 수 있습니다.");
        }
        if (!"accepted".equals(run.reviewDecision())) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "채택된 학습 run만 Model Promotion 할 수 있습니다.");
        }
        boolean hasLocalArtifact =
            !blank(run.outputAdapterPath()) && pathExists(Path.of(run.outputAdapterPath()));
        boolean hasRemoteModel = !blank(run.remoteModelName());
        if (!hasLocalArtifact && !hasRemoteModel) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "Model Promotion 할 산출물을 찾지 못했습니다.");
        }

        String promotedAt = Instant.now().toString();
        reviewRepository.markTrainingRunPromoted(run.runUid(), bindingKey, promotedAt);
        reviewRepository.appendTrainingRunEvent(
            run.runUid(),
            "info",
            "training_promoted",
            null,
            "Model Promotion 적용",
            objectMapper.createObjectNode()
                .put("bindingKey", bindingKey)
                .put("adapterPath", run.outputAdapterPath())
                .put("remoteModelName", run.remoteModelName())
        );
        return getTrainingStatus(headers);
    }

    private ObjectNode buildSftPreflight() {
        ObjectNode preflight = emptyPreflight("sft");
        ArrayNode blockingIssues = objectMapper.createArrayNode();
        blockingIssues.addAll(getFinalizeBlockingIssues());
        preflight.put("executionMode", currentTrainingBackend());
        preflight.put("trainingBackend", currentTrainingBackend());

        Optional<SnapshotSummary> dataset = getActiveSnapshotSummary("sft");
        preflight.set("dataset", datasetNode(dataset));

        if (!pathExists(resolveProjectPath("node_modules/.bin/tsx")) || !pathExists(resolveProjectPath("backend/scripts/review-training-worker.ts"))) {
            blockingIssues.add("training worker 실행 파일이 없어 SFT 학습을 시작할 수 없습니다.");
        }
        if (isSmokeTrainingMode()) {
            if (!pathExists(resolveProjectPath(MOCK_TRAINING_SCRIPT))) {
                blockingIssues.add("training smoke script가 없어 SFT 학습 smoke 실행을 시작할 수 없습니다.");
            }
        } else if (isTogetherTrainingMode()) {
            if (!pathExists(resolveProjectPath(EXPORT_TOGETHER_SFT_SCRIPT))) {
                blockingIssues.add("Together SFT dataset exporter 스크립트가 없습니다.");
            }
        } else {
            if (!pathExists(resolveProjectPath(".venv/bin/python"))) {
                blockingIssues.add("`.venv/bin/python`이 없어 PEFT SFT 학습을 실행할 수 없습니다.");
            }
            if (!pathExists(resolveProjectPath(TRAIN_PEFT_SFT_SCRIPT))) {
                blockingIssues.add("PEFT SFT trainer 스크립트가 없습니다.");
            }
            if (!pathExists(resolveProjectPath(DERIVE_MLX_RUNTIME_SCRIPT))) {
                blockingIssues.add("MLX runtime 파생 스크립트가 없습니다.");
            }
            List<String> missingModules = Stream.of("torch", "transformers", "peft", "datasets", "mlx_lm")
                .filter(module -> !hasVenvModule(module))
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
        preflight.set("duplicateRunId", nullableTextNode(duplicate.map(ReviewRepository.TrainingRunRow::runUid).orElse(null)));
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
        blockingIssues.addAll(getFinalizeBlockingIssues());
        preflight.put("trainingBackend", currentTrainingBackend());

        Optional<SnapshotSummary> dataset = getActiveSnapshotSummary("preference");
        preflight.set("dataset", datasetNode(dataset));

        if (isTogetherTrainingMode()) {
            preflight.put("executionMode", "unsupported");
            blockingIssues.add("Together serverless LoRA 전환 1차에서는 DPO를 지원하지 않습니다.");
            preflight.set("blockingIssues", blockingIssues);
            preflight.put("canStart", false);
            return preflight;
        }

        if (!pathExists(resolveProjectPath("node_modules/.bin/tsx")) || !pathExists(resolveProjectPath("backend/scripts/review-training-worker.ts"))) {
            blockingIssues.add("training worker 실행 파일이 없어 DPO 학습을 시작할 수 없습니다.");
        }
        if (isSmokeTrainingMode()) {
            if (!pathExists(resolveProjectPath(MOCK_TRAINING_SCRIPT))) {
                blockingIssues.add("training smoke script가 없어 DPO 학습 smoke 실행을 시작할 수 없습니다.");
            }
        } else {
            if (!pathExists(resolveProjectPath(".venv/bin/python"))) {
                blockingIssues.add("`.venv/bin/python`이 없어 DPO 학습을 실행할 수 없습니다.");
            }
            if (!pathExists(resolveProjectPath(TRAIN_PEFT_DPO_SCRIPT))) {
                blockingIssues.add("PEFT DPO trainer 스크립트가 없습니다.");
            }
            if (!pathExists(resolveProjectPath(DERIVE_MLX_RUNTIME_SCRIPT))) {
                blockingIssues.add("MLX runtime 파생 스크립트가 없습니다.");
            }
            List<String> missingModules = Stream.of("torch", "transformers", "peft", "trl", "datasets", "mlx_lm")
                .filter(module -> !hasVenvModule(module))
                .toList();
            if (!missingModules.isEmpty()) {
                blockingIssues.add(missingModuleMessage(missingModules));
            }
        }
        if (dataset.isEmpty() || dataset.get().rowCount() <= 0) {
            blockingIssues.add("최종 preference 데이터셋이 없거나 비어 있습니다.");
        }

        Optional<ReviewRepository.TrainingRunRow> latestSftRun = reviewRepository.findLatestSuccessfulTrainingRun("sft");
        if (latestSftRun.isEmpty() || blank(latestSftRun.get().outputAdapterPath())) {
            blockingIssues.add("먼저 성공한 SFT 학습 결과가 있어야 DPO를 실행할 수 있습니다.");
        } else {
            preflight.set("parentRunId", nullableTextNode(latestSftRun.get().runUid()));
            preflight.set("adapterPath", nullableTextNode(latestSftRun.get().outputAdapterPath()));
        }

        String sftFingerprint = extractText(object(sftPreflight.get("dataset")), "fingerprint");
        String parentSourceFingerprint = latestSftRun.map(ReviewRepository.TrainingRunRow::sourceFingerprint).orElse(null);
        String sftFingerprintRelation = null;
        if (sftFingerprint != null && parentSourceFingerprint != null) {
            sftFingerprintRelation = sftFingerprint.equals(parentSourceFingerprint) ? "match" : "mismatch";
        }
        preflight.set("sftFingerprintRelation", nullableTextNode(sftFingerprintRelation));

        boolean needsNewSft =
            latestSftRun.isEmpty() ||
            blank(latestSftRun.get().outputAdapterPath()) ||
            "mismatch".equals(sftFingerprintRelation);
        preflight.put("executionMode", needsNewSft ? "needs_new_sft" : "reuse_existing_sft");

        if ("mismatch".equals(sftFingerprintRelation)) {
            blockingIssues.add("현재 finalized SFT 데이터로 먼저 새 SFT 학습을 완료해야 DPO를 실행할 수 있습니다.");
        }

        String fingerprint = null;
        if (dataset.isPresent() && latestSftRun.isPresent() && !blank(latestSftRun.get().runFingerprint())) {
            fingerprint = fingerprintJson(dpoPreflightFingerprint(dataset.get(), latestSftRun.get()));
        }

        Optional<ReviewRepository.TrainingRunRow> duplicate = fingerprint == null
            ? Optional.empty()
            : reviewRepository.findTrainingRunByFingerprint("dpo", fingerprint);

        preflight.put("alreadyTrained", duplicate.map(row -> "succeeded".equals(row.state())).orElse(false));
        preflight.set("duplicateRunId", nullableTextNode(duplicate.map(ReviewRepository.TrainingRunRow::runUid).orElse(null)));
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

    private ArrayNode getFinalizeBlockingIssues() {
        JsonNode finalizeStatus = getFinalizeStatus(new HttpHeaders());
        ArrayNode issues = objectMapper.createArrayNode();
        int pendingTotal = object(finalizeStatus.get("pending")).path("total").asInt(0);
        boolean canFinalize = finalizeStatus.path("canFinalize").asBoolean(false);
        String finalizeState = extractText(finalizeStatus, "state", "idle");

        if (pendingTotal > 0) {
            issues.add("먼저 사람 검수를 끝내고 finalize를 실행해야 합니다.");
            return issues;
        }

        if (canFinalize) {
            issues.add("review 변경사항이 있어 finalize를 다시 실행해야 합니다.");
            return issues;
        }

        Optional<SnapshotSummary> sftSnapshot = getActiveSnapshotSummary("sft");
        Optional<SnapshotSummary> preferenceSnapshot = getActiveSnapshotSummary("preference");
        boolean hasImportedSnapshots =
            sftSnapshot.map(SnapshotSummary::rowCount).orElse(0) > 0 ||
            preferenceSnapshot.map(SnapshotSummary::rowCount).orElse(0) > 0;

        if ("succeeded".equals(finalizeState) || hasImportedSnapshots) {
            return issues;
        }

        issues.add("먼저 finalize를 실행해 최신 학습 데이터셋을 만들어야 합니다.");
        return issues;
    }

    private Optional<SnapshotSummary> getActiveSnapshotSummary(String kind) {
        Optional<ReviewRepository.SnapshotSummaryRow> direct = reviewRepository.findActiveSnapshot(kind);
        if (direct.isEmpty() && pathExists(resolveProjectPath(SNAPSHOT_SYNC_SCRIPT))) {
            try {
                runNodeCommand(List.of(
                    tsxBinary().toString(),
                    resolveRequiredProjectPath(SNAPSHOT_SYNC_SCRIPT).toString()
                ));
            } catch (ReviewApiException ignored) {
                // Keep the current DB view if sync-on-read fails; explicit finalize still updates snapshots.
            }
            direct = reviewRepository.findActiveSnapshot(kind);
        }

        return direct.map(row -> {
            int rowCount = reviewRepository.countSnapshotItems(row.id());
            ObjectNode manifest = object(row.manifestJson());
            String manifestPath =
                firstNonBlank(
                    row.outputUri(),
                    extractText(object(manifest.get("outputFiles")), "manifest")
                );
            return new SnapshotSummary(
                row.id(),
                row.datasetVersion(),
                row.sourceFingerprint(),
                manifestPath,
                rowCount,
                row.generatedAt()
            );
        });
    }

    private ObjectNode buildTrainingRunView(ReviewRepository.TrainingRunRow row) {
        ObjectNode params = object(row.paramsJson());
        ObjectNode evalSummary = object(row.evalSummaryJson());
        ObjectNode response = objectMapper.createObjectNode();
        response.put("runId", defaultText(row.runUid(), ""));
        response.put("kind", defaultText(row.runKind(), "sft"));
        response.set("trainingBackend", nullableTextNode(row.trainingBackend()));
        response.put("state", defaultText(row.state(), "failed"));
        response.set("currentStep", nullableTextNode(row.currentStep()));
        response.set("message", nullableTextNode(row.message()));
        response.set("startedAt", nullableTextNode(row.startedAt()));
        response.set("finishedAt", nullableTextNode(row.finishedAt()));
        response.set("updatedAt", nullableTextNode(row.updatedAt()));
        response.set("fingerprint", nullableTextNode(row.runFingerprint()));
        response.set("sourceFingerprint", nullableTextNode(row.sourceFingerprint()));
        response.set("sourceDatasetVersion", nullableTextNode(extractText(params, "sourceDatasetVersion")));
        response.set("parentRunId", nullableTextNode(extractText(params, "parentRunUid")));
        response.set("baseModelId", nullableTextNode(row.baseModel()));
        response.set("datasetDir", nullableTextNode(row.datasetWorkDir()));
        response.set("adapterPath", nullableTextNode(row.outputAdapterPath()));
        response.set("runtimeArtifactPath", nullableTextNode(row.runtimeArtifactPath()));
        response.set("runtimeArtifactKind", nullableTextNode(row.runtimeArtifactKind()));
        response.set("remoteProvider", nullableTextNode(row.remoteProvider()));
        response.set("remoteJobId", nullableTextNode(row.remoteJobId()));
        response.set("remoteTrainingFileId", nullableTextNode(row.remoteTrainingFileId()));
        response.set("remoteValidationFileId", nullableTextNode(row.remoteValidationFileId()));
        response.set("remoteModelName", nullableTextNode(row.remoteModelName()));
        response.set("logPath", nullableTextNode(extractText(params, "logPath")));
        response.set("durations", buildRunDurations(row.metricsJson()));
        ObjectNode evaluation = objectMapper.createObjectNode();
        evaluation.put("state", defaultText(row.evalState(), "idle"));
        evaluation.set("bindingKey", nullableTextNode(row.evalBindingKey()));
        evaluation.set("benchmarkId", nullableTextNode(extractText(evalSummary, "benchmarkId")));
        evaluation.set("baselineLabel", nullableTextNode(firstNonBlank(row.evalBaselineLabel(), extractText(evalSummary, "baselineLabel"))));
        evaluation.set("summaryPath", nullableTextNode(firstNonBlank(row.evalSummaryPath(), extractText(evalSummary, "summaryPath"))));
        evaluation.set("message", nullableTextNode(row.evalMessage()));
        evaluation.set("startedAt", nullableTextNode(row.evalStartedAt()));
        evaluation.set("finishedAt", nullableTextNode(row.evalFinishedAt()));
        evaluation.set("recommendation", nullableTextNode(extractText(evalSummary, "recommendation")));
        ObjectNode winnerCounts = object(evalSummary.get("winnerCounts"));
        if (winnerCounts.fieldNames().hasNext()) {
            ObjectNode winnerNode = objectMapper.createObjectNode();
            winnerNode.set("baseline", nullableNumberNode(extractNumber(winnerCounts, "baseline")));
            winnerNode.set("candidate", nullableNumberNode(extractNumber(winnerCounts, "candidate")));
            winnerNode.set("tie", nullableNumberNode(extractNumber(winnerCounts, "tie")));
            evaluation.set("winnerCounts", winnerNode);
        } else {
            evaluation.set("winnerCounts", NullNode.instance);
        }
        ObjectNode averages = object(evalSummary.get("averages"));
        evaluation.set("baselineNaturalness", nullableNumberNode(extractNumber(averages, "baselineNaturalness")));
        evaluation.set("candidateNaturalness", nullableNumberNode(extractNumber(averages, "candidateNaturalness")));
        evaluation.set("baselinePersonaFit", nullableNumberNode(extractNumber(averages, "baselinePersonaFit")));
        evaluation.set("candidatePersonaFit", nullableNumberNode(extractNumber(averages, "candidatePersonaFit")));
        evaluation.set("baselineAntiMeta", nullableNumberNode(extractNumber(averages, "baselineAntiMeta")));
        evaluation.set("candidateAntiMeta", nullableNumberNode(extractNumber(averages, "candidateAntiMeta")));
        evaluation.set("confidence", nullableNumberNode(extractNumber(averages, "confidence")));
        response.set("evaluation", evaluation);

        ObjectNode decision = objectMapper.createObjectNode();
        decision.put("state", defaultText(row.reviewDecision(), "pending"));
        decision.set("reviewer", nullableTextNode(row.reviewedBy()));
        decision.set("notes", nullableTextNode(row.reviewNotes()));
        decision.set("decidedAt", nullableTextNode(row.reviewedAt()));
        response.set("decision", decision);

        ObjectNode promotion = objectMapper.createObjectNode();
        promotion.put("isPromoted", row.promotedAt() != null);
        promotion.set("bindingKey", nullableTextNode(row.promotedBindingKey()));
        promotion.set("promotedAt", nullableTextNode(row.promotedAt()));
        response.set("promotion", promotion);
        return response;
    }

    private ObjectNode buildRunDurations(JsonNode metricsJson) {
        ObjectNode durations = object(object(metricsJson).get("durations"));
        ObjectNode response = objectMapper.createObjectNode();
        response.set("buildMs", nullableNumberNode(extractNumber(durations, "buildMs")));
        response.set("trainMs", nullableNumberNode(extractNumber(durations, "trainMs")));
        response.set("totalMs", nullableNumberNode(extractNumber(durations, "totalMs")));
        return response;
    }

    private ObjectNode buildSftItemView(
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

    private ObjectNode buildPairItemView(
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
        Path episodeDir = resolveProjectPath(EPISODE_EXPORT_DIR);

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
                        nullableTextNode(requiredRepoRoot().relativize(file.toAbsolutePath().normalize()).toString())
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

    private ObjectNode pendingNode(ReviewRepository.PendingCounts pending) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("sft", pending.sft());
        node.put("pair", pending.pair());
        node.put("total", pending.total());
        return node;
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

    private ObjectNode datasetNode(Optional<SnapshotSummary> dataset) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("exists", dataset.isPresent());
        node.set("manifestPath", nullableTextNode(dataset.map(SnapshotSummary::manifestPath).orElse(null)));
        node.set("datasetVersion", nullableTextNode(dataset.map(SnapshotSummary::datasetVersion).orElse(null)));
        node.set("fingerprint", nullableTextNode(dataset.map(SnapshotSummary::fingerprint).orElse(null)));
        node.set("rowCount", nullableNumberNode(dataset.map(summary -> Integer.valueOf(summary.rowCount())).orElse(null)));
        return node;
    }

    private LinkedHashMap<String, Object> sftPreflightFingerprint(SnapshotSummary dataset) {
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
        SnapshotSummary dataset,
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

    private TrainingRunSpec buildTrainingRunSpec(String kind) {
        Optional<SnapshotSummary> snapshot = getActiveSnapshotSummary("sft".equals(kind) ? "sft" : "preference");
        if (snapshot.isEmpty()) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "활성 snapshot을 찾지 못했습니다.");
        }

        String runUid = Instant.now().toString().replaceAll("[:.]", "-") + "_" + kind;
        String trainingBackend = currentTrainingBackend();
        Path datasetDir = resolveRequiredProjectPath(TRAIN_RUNS_DIR).resolve(runUid).resolve("dataset");
        Path outputRootDir = resolveRequiredProjectPath(TRAIN_OUTPUTS_DIR).resolve(runUid);
        Path adapterPath = outputRootDir.resolve("canonical");
        Path runtimeArtifactPath = outputRootDir.resolve("runtime");
        String runtimeArtifactKind = "mlx_fused_model";
        Path trainingResultPath = outputRootDir.resolve("training-result.json");
        Path logPath = resolveRequiredProjectPath(TRAIN_RUNS_DIR).resolve(runUid).resolve("worker.log");
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

        CommandSpec buildCommand;
        CommandSpec trainCommand;
        CommandSpec deriveCommand = null;
        if (isSmokeTrainingMode()) {
            Path mockScriptPath = resolveRequiredProjectPath(MOCK_TRAINING_SCRIPT);
            buildCommand = new CommandSpec(
                tsxBinary().toString(),
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
                "--run-id",
                runUid
            ));
            if (!"sft".equals(kind) && latestSftRun != null && !blank(latestSftRun.outputAdapterPath())) {
                smokeTrainArgs.add("--reference-adapter-path");
                smokeTrainArgs.add(latestSftRun.outputAdapterPath());
            }
            trainCommand = new CommandSpec(tsxBinary().toString(), smokeTrainArgs);
            deriveCommand = new CommandSpec(
                tsxBinary().toString(),
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
                    "--run-id",
                    runUid
                )
            );
        } else if (isTogetherTrainingMode()) {
            if (!"sft".equals(kind)) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Together serverless LoRA 전환 1차에서는 DPO를 지원하지 않습니다.");
            }
            buildCommand = new CommandSpec(
                tsxBinary().toString(),
                List.of(
                    resolveRequiredProjectPath(EXPORT_TOGETHER_SFT_SCRIPT).toString(),
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
            trainCommand = new CommandSpec(
                tsxBinary().toString(),
                List.of(
                    resolveRequiredProjectPath(TRAINING_WORKER_SCRIPT).toString(),
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
                ? new CommandSpec(
                    tsxBinary().toString(),
                    List.of(
                        resolveRequiredProjectPath(EXPORT_MLX_SFT_SCRIPT).toString(),
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
                : new CommandSpec(
                    tsxBinary().toString(),
                    List.of(
                        resolveRequiredProjectPath(BUILD_MLX_DPO_SCRIPT).toString(),
                        "--snapshot-id",
                        String.valueOf(snapshot.get().snapshotId()),
                        "--output-dir",
                        datasetDir.toString()
                    )
                );

            trainCommand = "sft".equals(kind)
                ? new CommandSpec(
                    resolveRequiredProjectPath(".venv/bin/python").toString(),
                    List.of(
                        resolveRequiredProjectPath(TRAIN_PEFT_SFT_SCRIPT).toString(),
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
                : new CommandSpec(
                    resolveRequiredProjectPath(".venv/bin/python").toString(),
                    List.of(
                        resolveRequiredProjectPath(TRAIN_PEFT_DPO_SCRIPT).toString(),
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
            deriveCommand = new CommandSpec(
                resolveRequiredProjectPath(".venv/bin/python").toString(),
                List.of(
                    resolveRequiredProjectPath(DERIVE_MLX_RUNTIME_SCRIPT).toString(),
                    "--model",
                    trainingBaseModel,
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

        return new TrainingRunSpec(
            runUid,
            kind,
            trainingBackend,
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
            new CommandBundle(buildCommand, trainCommand, deriveCommand)
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

    private String existingPathString(Path path) {
        return Files.exists(path) ? path.toString() : null;
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

    private static String resolveLocalTrainingBaseModel(String configuredLocalBaseModel, String legacyBaseModel) {
        String configuredBaseModel = configuredLocalBaseModel;
        if (configuredBaseModel == null || configuredBaseModel.isBlank()) {
            configuredBaseModel = legacyBaseModel;
        }
        if (configuredBaseModel != null && !configuredBaseModel.isBlank()) {
            return configuredBaseModel.trim();
        }
        return DEFAULT_LOCAL_CANONICAL_TRAINING_BASE_MODEL;
    }

    private static String resolveLocalReplyMlxModel(String configuredRuntimeBaseModel) {
        if (configuredRuntimeBaseModel != null && !configuredRuntimeBaseModel.isBlank()) {
            return configuredRuntimeBaseModel.trim();
        }
        return DEFAULT_LOCAL_REPLY_MLX_MODEL;
    }

    private static String resolveRemoteTrainingBaseModel(String configuredRemoteBaseModel, String legacyBaseModel) {
        String configuredBaseModel = configuredRemoteBaseModel;
        if (configuredBaseModel == null || configuredBaseModel.isBlank()) {
            configuredBaseModel = legacyBaseModel;
        }
        if (configuredBaseModel != null && !configuredBaseModel.isBlank()) {
            return configuredBaseModel.trim();
        }
        return DEFAULT_REMOTE_TRAINING_BASE_MODEL;
    }

    private static String resolveTrainingBaseModel(
        String localBaseModel,
        String remoteBaseModel,
        String executionMode
    ) {
        return "together_serverless_lora".equals(executionMode) ? remoteBaseModel : localBaseModel;
    }

    private void registerFinalizeArtifacts(String runUid) {
        registerTrainingArtifact(
            runUid,
            "finalize_sft_manifest",
            resolveRequiredProjectPath(FINALIZE_SFT_OUTPUT_DIR).resolve("manifest.json"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_sft_train",
            resolveRequiredProjectPath(FINALIZE_SFT_OUTPUT_DIR).resolve("final_sft_train.jsonl"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_sft_dev",
            resolveRequiredProjectPath(FINALIZE_SFT_OUTPUT_DIR).resolve("final_sft_dev.jsonl"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_preference_manifest",
            resolveRequiredProjectPath(FINALIZE_PREFERENCE_OUTPUT_DIR).resolve("manifest.json"),
            artifactMetadata("finalize", "preference")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_preference_pairs",
            resolveRequiredProjectPath(FINALIZE_PREFERENCE_OUTPUT_DIR).resolve("final_preference_pairs.jsonl"),
            artifactMetadata("finalize", "preference")
        );
    }

    private ObjectNode artifactMetadata(String pipeline, String datasetKind) {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("pipeline", pipeline);
        metadata.put("datasetKind", datasetKind);
        return metadata;
    }

    private void registerTrainingArtifact(
        String runUid,
        String artifactKind,
        Path artifactPath,
        JsonNode metadataJson
    ) {
        if (!Files.exists(artifactPath)) {
            return;
        }

        Long fileSizeBytes = null;
        String sha256 = null;
        try {
            if (Files.isRegularFile(artifactPath)) {
                fileSizeBytes = Files.size(artifactPath);
                sha256 = sha256Hex(artifactPath);
            }
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to inspect artifact: " + artifactPath, error);
        }

        reviewRepository.insertTrainingRunArtifact(
            runUid,
            artifactKind,
            artifactPath.toString(),
            fileSizeBytes,
            sha256,
            metadataJson
        );
    }

    private boolean shouldRunTrainingInline() {
        return isSmokeTrainingMode() && (blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:"));
    }

    private boolean isSmokeTrainingEvaluationMode() {
        return "smoke".equals(trainingEvalMode);
    }

    private boolean shouldRunTrainingEvaluationInline() {
        return isSmokeTrainingEvaluationMode();
    }

    private void requirePostgresReviewPipelineSync(boolean skipDbSync, String stageName) {
        if (skipDbSync) {
            return;
        }
        if (blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:") || !datasourceUrl.matches("(?i)^jdbc:postgres(?:ql)?:.*")) {
            throw new ReviewApiException(HttpStatus.CONFLICT, stageName + " DB sync는 Postgres 환경에서만 지원합니다.");
        }
    }

    private ReviewRepository.TrainingRunRow resolveTrainingRunForControlAction(String requestedRunId) {
        if (!blank(requestedRunId)) {
            return reviewRepository.findTrainingRunByUid(requestedRunId)
                .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "학습 run을 찾지 못했습니다: " + requestedRunId));
        }

        return reviewRepository.listTrainingRuns(List.of("sft", "dpo")).stream()
            .filter(row -> "succeeded".equals(row.state()))
            .findFirst()
            .orElseThrow(() -> new ReviewApiException(HttpStatus.NOT_FOUND, "평가할 성공한 학습 run이 없습니다."));
    }

    private PromotedBaseline resolvePromotedBaseline(String bindingKey) {
        Optional<ReviewRepository.TrainingRunRow> exact = reviewRepository.findLatestPromotedTrainingRun(bindingKey)
            .filter(this::hasUsablePromotedRuntime);
        if (exact.isPresent()) {
            String runtimePath = firstNonBlank(exact.get().runtimeArtifactPath(), exact.get().outputAdapterPath());
            return new PromotedBaseline(
                "promoted:" + exact.get().runUid(),
                runtimePath != null && pathExists(Path.of(runtimePath)) ? runtimePath : null,
                blank(exact.get().remoteProvider()) ? null : exact.get().remoteProvider(),
                blank(exact.get().remoteModelName()) ? null : exact.get().remoteModelName()
            );
        }
        if (!"default".equals(bindingKey)) {
            Optional<ReviewRepository.TrainingRunRow> fallback = reviewRepository.findLatestPromotedTrainingRun("default")
                .filter(this::hasUsablePromotedRuntime);
            if (fallback.isPresent()) {
                String runtimePath = firstNonBlank(fallback.get().runtimeArtifactPath(), fallback.get().outputAdapterPath());
                return new PromotedBaseline(
                    "promoted:default:" + fallback.get().runUid(),
                    runtimePath != null && pathExists(Path.of(runtimePath)) ? runtimePath : null,
                    blank(fallback.get().remoteProvider()) ? null : fallback.get().remoteProvider(),
                    blank(fallback.get().remoteModelName()) ? null : fallback.get().remoteModelName()
                );
            }
        }
        return new PromotedBaseline("base_model", null, null, null);
    }

    private boolean hasUsablePromotedRuntime(ReviewRepository.TrainingRunRow row) {
        if (!blank(row.remoteModelName())) {
            return true;
        }
        String runtimePath = firstNonBlank(row.runtimeArtifactPath(), row.outputAdapterPath());
        return runtimePath != null && pathExists(Path.of(runtimePath));
    }

    private void runInlineTrainingEvaluation(
        ReviewRepository.TrainingRunRow run,
        String bindingKey,
        PromotedBaseline baseline
    ) {
        String startedAt = firstNonBlank(run.evalStartedAt(), Instant.now().toString());
        Path outputDir = trainingRunRoot(run).resolve("eval").resolve(bindingKey);
        Path summaryPath = outputDir.resolve("compare-summary.json");
        Path reportPath = outputDir.resolve("compare-report.md");
        try {
            Files.createDirectories(outputDir);
            ObjectNode summary = buildSmokeTrainingEvaluationSummary(run, bindingKey, baseline, summaryPath, reportPath);
            Files.writeString(
                summaryPath,
                objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(summary) + "\n",
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
            Files.writeString(
                reportPath,
                buildSmokeTrainingEvaluationReport(summary),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );

            String finishedAt = Instant.now().toString();
            reviewRepository.updateTrainingRunEvaluation(
                run.runUid(),
                "succeeded",
                "Golden-set Evaluation 완료",
                bindingKey,
                baseline.label(),
                summaryPath.toString(),
                summary,
                startedAt,
                finishedAt
            );
            reviewRepository.appendTrainingRunEvent(
                run.runUid(),
                "info",
                "golden_eval_finished",
                null,
                "Golden-set Evaluation 완료",
                object(summary)
            );
            registerTrainingArtifact(
                run.runUid(),
                "golden_eval_summary",
                summaryPath,
                objectMapper.createObjectNode()
                    .put("bindingKey", bindingKey)
                    .put("baselineLabel", baseline.label())
            );
            registerTrainingArtifact(
                run.runUid(),
                "golden_eval_report",
                reportPath,
                objectMapper.createObjectNode()
                    .put("bindingKey", bindingKey)
                    .put("baselineLabel", baseline.label())
            );
        } catch (Exception error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "Golden-set Evaluation 실행에 실패했습니다.";
            reviewRepository.updateTrainingRunEvaluation(
                run.runUid(),
                "failed",
                message,
                bindingKey,
                baseline.label(),
                existingPathString(summaryPath),
                NullNode.instance,
                startedAt,
                Instant.now().toString()
            );
            reviewRepository.appendTrainingRunEvent(
                run.runUid(),
                "error",
                "golden_eval_failed",
                null,
                message,
                null
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    private Path trainingRunRoot(ReviewRepository.TrainingRunRow run) {
        Path datasetDir = Path.of(run.datasetWorkDir());
        Path parent = datasetDir.getParent();
        return parent == null ? datasetDir : parent;
    }

    private ObjectNode buildSmokeTrainingEvaluationSummary(
        ReviewRepository.TrainingRunRow run,
        String bindingKey,
        PromotedBaseline baseline,
        Path summaryPath,
        Path reportPath
    ) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("generatedAt", Instant.now().toString());
        root.put("benchmarkId", "reply-golden-v1");
        root.put("bindingKey", bindingKey);
        root.put("baselineLabel", baseline.label());
        root.put("candidateLabel", run.runUid());
        root.put("summaryPath", summaryPath.toString());
        root.put("reportPath", reportPath.toString());
        root.put("recommendation", "promote");
        ObjectNode winnerCounts = root.putObject("winnerCounts");
        winnerCounts.put("baseline", 1);
        winnerCounts.put("candidate", 3);
        winnerCounts.put("tie", 1);
        ObjectNode averages = root.putObject("averages");
        averages.put("baselineNaturalness", 3.2);
        averages.put("candidateNaturalness", 4.1);
        averages.put("baselinePersonaFit", 3.0);
        averages.put("candidatePersonaFit", 4.0);
        averages.put("baselineAntiMeta", 3.1);
        averages.put("candidateAntiMeta", 4.2);
        averages.put("confidence", 4.0);
        ArrayNode cases = root.putArray("cases");
        cases.add(
            objectMapper.createObjectNode()
                .put("caseId", "smoke_case_1")
                .put("winner", "candidate")
                .put("reason", "candidate reply is more direct and role-consistent")
        );
        cases.add(
            objectMapper.createObjectNode()
                .put("caseId", "smoke_case_2")
                .put("winner", "baseline")
                .put("reason", "baseline remained slightly tighter on brevity")
        );
        return root;
    }

    private String buildSmokeTrainingEvaluationReport(JsonNode summary) {
        ObjectNode winnerCounts = object(summary.get("winnerCounts"));
        ObjectNode averages = object(summary.get("averages"));
        return String.join(
            "\n",
            "# Golden Eval Smoke Report",
            "",
            "- Benchmark: " + defaultText(extractText(summary, "benchmarkId"), "reply-golden-v1"),
            "- Binding: " + defaultText(extractText(summary, "bindingKey"), "default"),
            "- Baseline: " + defaultText(extractText(summary, "baselineLabel"), "base_model"),
            "- Candidate: " + defaultText(extractText(summary, "candidateLabel"), "unknown"),
            "- Recommendation: " + defaultText(extractText(summary, "recommendation"), "hold"),
            "",
            "| Winner | Count |",
            "| --- | ---: |",
            "| baseline | " + defaultText(String.valueOf(winnerCounts.path("baseline").asInt(0)), "0") + " |",
            "| candidate | " + defaultText(String.valueOf(winnerCounts.path("candidate").asInt(0)), "0") + " |",
            "| tie | " + defaultText(String.valueOf(winnerCounts.path("tie").asInt(0)), "0") + " |",
            "",
            "| Metric | Baseline | Candidate |",
            "| --- | ---: | ---: |",
            "| Naturalness | " + defaultText(String.valueOf(averages.path("baselineNaturalness").asDouble(0)), "0") + " | " + defaultText(String.valueOf(averages.path("candidateNaturalness").asDouble(0)), "0") + " |",
            "| Persona Fit | " + defaultText(String.valueOf(averages.path("baselinePersonaFit").asDouble(0)), "0") + " | " + defaultText(String.valueOf(averages.path("candidatePersonaFit").asDouble(0)), "0") + " |",
            "| Anti-Meta | " + defaultText(String.valueOf(averages.path("baselineAntiMeta").asDouble(0)), "0") + " | " + defaultText(String.valueOf(averages.path("candidateAntiMeta").asDouble(0)), "0") + " |",
            ""
        );
    }

    private void runInlineTraining(TrainingRunSpec spec) {
        long startedAtMs = System.currentTimeMillis();
        try {
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "dataset_build_started",
                "build_dataset",
                "sft".equals(spec.kind()) ? "SFT 데이터셋 생성 시작" : "DPO 데이터셋 생성 시작",
                null
            );

            ProcessResult buildResult = runLoggedCommand(spec.runUid(), spec.commands().build(), spec.logPath());
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "dataset_build_finished",
                "sft".equals(spec.kind()) ? "train_sft" : "train_dpo",
                "sft".equals(spec.kind()) ? "SFT 데이터셋 생성 완료" : "DPO 데이터셋 생성 완료",
                objectMapper.createObjectNode().put("buildMs", buildResult.durationMs())
            );
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "running",
                "sft".equals(spec.kind()) ? "train_sft" : "train_dpo",
                "sft".equals(spec.kind()) ? "새로운 SFT Base 생성 중" : "DPO 학습 실행 중",
                null,
                spec.trainingBackend(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                new ReviewRepository.TrainingDurations(
                    buildResult.durationMs(),
                    null,
                    null
                )
            );
            registerTrainingDatasetArtifacts(spec);

            ProcessResult trainResult = runLoggedCommand(spec.runUid(), spec.commands().train(), spec.logPath());
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "runtime_derivation_started",
                "derive_runtime",
                "MLX runtime artifact 생성 시작",
                null
            );
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "running",
                "derive_runtime",
                "MLX runtime artifact 생성 중",
                null,
                spec.trainingBackend(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                new ReviewRepository.TrainingDurations(
                    buildResult.durationMs(),
                    trainResult.durationMs(),
                    null
                )
            );
            runLoggedCommand(spec.runUid(), spec.commands().derive(), spec.logPath());
            String finishedAt = Instant.now().toString();
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "succeeded",
                null,
                "sft".equals(spec.kind()) ? "SFT 학습 완료" : "DPO 학습 완료",
                finishedAt,
                spec.trainingBackend(),
                spec.adapterPath(),
                spec.runUid(),
                spec.runtimeArtifactPath(),
                spec.runtimeArtifactKind(),
                spec.remoteProvider(),
                null,
                null,
                null,
                null,
                new ReviewRepository.TrainingDurations(
                    buildResult.durationMs(),
                    trainResult.durationMs(),
                    System.currentTimeMillis() - startedAtMs
                )
            );
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "info",
                "trainer_finished",
                null,
                "sft".equals(spec.kind()) ? "SFT 학습 완료" : "DPO 학습 완료",
                objectMapper.createObjectNode()
                    .put("buildMs", buildResult.durationMs())
                    .put("trainMs", trainResult.durationMs())
            );
            registerTrainingArtifact(
                spec.runUid(),
                "log_file",
                Path.of(spec.logPath()),
                trainingArtifactMetadata(spec, "worker_log")
            );
            registerTrainingArtifact(
                spec.runUid(),
                "canonical_adapter_output",
                Path.of(spec.adapterPath()),
                trainingArtifactMetadata(spec, "training_output")
                    .put("adapterVersion", spec.runUid())
            );
            registerTrainingArtifact(
                spec.runUid(),
                "runtime_artifact_output",
                Path.of(spec.runtimeArtifactPath()),
                trainingArtifactMetadata(spec, "training_output")
            );
            registerTrainingArtifact(
                spec.runUid(),
                "training_result_manifest",
                Path.of(spec.trainingResultPath()),
                trainingArtifactMetadata(spec, "training_result_manifest")
            );
        } catch (RuntimeException error) {
            String message = error instanceof ReviewApiException reviewApiException
                ? reviewApiException.getMessage()
                : "학습 실행에 실패했습니다.";
            appendLog(spec.logPath(), "\n[failed] " + message + "\n");
            reviewRepository.appendTrainingRunEvent(
                spec.runUid(),
                "error",
                "trainer_failed",
                null,
                message,
                null
            );
            reviewRepository.updateTrainingRunState(
                spec.runUid(),
                "failed",
                null,
                message,
                Instant.now().toString(),
                spec.trainingBackend(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            registerTrainingArtifact(
                spec.runUid(),
                "log_file",
                Path.of(spec.logPath()),
                trainingArtifactMetadata(spec, "worker_log_failed")
            );
            if (error instanceof ReviewApiException reviewApiException) {
                throw reviewApiException;
            }
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, message, error);
        }
    }

    private ProcessResult runLoggedCommand(String runUid, CommandSpec command, String logPath) {
        appendLog(logPath, "\n$ " + commandToString(command) + "\n");
        ProcessResult result = runNodeCommand(commandToList(command));
        if (blankToNull(result.stdout()) != null) {
            appendLog(logPath, result.stdout() + "\n");
        }
        if (blankToNull(result.stderr()) != null) {
            appendLog(logPath, result.stderr() + "\n");
        }
        return result;
    }

    private void registerTrainingDatasetArtifacts(TrainingRunSpec spec) {
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_manifest",
            Path.of(spec.datasetDir()).resolve("manifest.json"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_train",
            Path.of(spec.datasetDir()).resolve("train.jsonl"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_valid",
            Path.of(spec.datasetDir()).resolve("valid.jsonl"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
    }

    private ObjectNode trainingArtifactMetadata(TrainingRunSpec spec, String artifactPhase) {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("runId", spec.runUid());
        metadata.put("kind", spec.kind());
        metadata.put("artifactPhase", artifactPhase);
        metadata.put("baseModel", spec.baseModel());
        metadata.put("trainingBackend", spec.trainingBackend());
        metadata.put("sourceDatasetVersion", spec.sourceDatasetVersion());
        metadata.put("sourceFingerprint", spec.sourceFingerprint());
        if (spec.adapterPath() == null) {
            metadata.putNull("canonicalAdapterPath");
        } else {
            metadata.put("canonicalAdapterPath", spec.adapterPath());
        }
        if (spec.runtimeArtifactPath() == null) {
            metadata.putNull("runtimeArtifactPath");
        } else {
            metadata.put("runtimeArtifactPath", spec.runtimeArtifactPath());
        }
        if (spec.runtimeArtifactKind() == null) {
            metadata.putNull("runtimeArtifactKind");
        } else {
            metadata.put("runtimeArtifactKind", spec.runtimeArtifactKind());
        }
        if (spec.remoteProvider() == null) {
            metadata.putNull("remoteProvider");
        } else {
            metadata.put("remoteProvider", spec.remoteProvider());
        }
        return metadata;
    }

    private void appendLog(String logPath, String text) {
        try {
            Path path = Path.of(logPath);
            Files.createDirectories(path.getParent());
            Files.writeString(
                path,
                text,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to append training log.", error);
        }
    }

    private String sha256Hex(Path path) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(Files.readAllBytes(path));
            byte[] hashed = digest.digest();
            StringBuilder builder = new StringBuilder();
            for (byte value : hashed) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to hash artifact: " + path, error);
        }
    }

    private void writeInitialTrainingLog(TrainingRunSpec spec) {
        try {
            Path logPath = Path.of(spec.logPath());
            Files.createDirectories(logPath.getParent());
            Files.createDirectories(Path.of(spec.outputRootDir()));
            String content = String.join(
                "\n",
                "runId=" + spec.runUid(),
                "kind=" + spec.kind(),
                "trainingBackend=" + spec.trainingBackend(),
                "build=" + commandToString(spec.commands().build()),
                "train=" + commandToString(spec.commands().train()),
                "derive=" + commandToString(spec.commands().derive()),
                ""
            );
            Files.writeString(
                logPath,
                content,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to initialize training log.", error);
        }
    }

    private String commandToString(CommandSpec command) {
        if (command == null) {
            return "-";
        }
        List<String> parts = new ArrayList<>();
        parts.add(command.command());
        parts.addAll(command.args());
        return parts.stream()
            .map(entry -> entry.contains(" ") ? "\"" + entry + "\"" : entry)
            .reduce((left, right) -> left + " " + right)
            .orElse("");
    }

    private List<String> commandToList(CommandSpec command) {
        ArrayList<String> parts = new ArrayList<>();
        parts.add(command.command());
        parts.addAll(command.args());
        return parts;
    }

    private ProcessResult runNodeCommand(List<String> command) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(requiredRepoRoot().toFile());
            Map<String, String> env = builder.environment();
            env.putIfAbsent("NPC_SIMULATOR_ROOT", requiredRepoRoot().toString());
            if (!blank(datasourceUrl)) {
                env.put("SPRING_DATASOURCE_URL", datasourceUrl);
            }
            if (!blank(datasourceUsername)) {
                env.put("SPRING_DATASOURCE_USERNAME", datasourceUsername);
            }
            if (!blank(datasourcePassword)) {
                env.put("SPRING_DATASOURCE_PASSWORD", datasourcePassword);
            }

            long startedAt = System.currentTimeMillis();
            Process process = builder.start();
            String stdout = readStream(process.getInputStream()).trim();
            String stderr = readStream(process.getErrorStream()).trim();
            int exitCode = process.waitFor();
            long durationMs = System.currentTimeMillis() - startedAt;

            if (exitCode != 0) {
                throw new ReviewApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    blank(stderr) ? blankToNull(stdout) != null ? stdout : "worker execution failed" : stderr
                );
            }

            return new ProcessResult(stdout, stderr, durationMs);
        } catch (ReviewApiException error) {
            throw error;
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to execute review worker.", error);
        }
    }

    private void startDetachedNodeCommand(List<String> command) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(requiredRepoRoot().toFile());
            Map<String, String> env = builder.environment();
            env.putIfAbsent("NPC_SIMULATOR_ROOT", requiredRepoRoot().toString());
            if (!blank(datasourceUrl)) {
                env.put("SPRING_DATASOURCE_URL", datasourceUrl);
            }
            if (!blank(datasourceUsername)) {
                env.put("SPRING_DATASOURCE_USERNAME", datasourceUsername);
            }
            if (!blank(datasourcePassword)) {
                env.put("SPRING_DATASOURCE_PASSWORD", datasourcePassword);
            }
            builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
            builder.redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.start();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to launch review worker.", error);
        }
    }

    private String readStream(InputStream stream) {
        try {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to read worker stream.", error);
        }
    }

    private Path tsxBinary() {
        return resolveRequiredProjectPath(TSX_RELATIVE_PATH);
    }

    private Path requiredRepoRoot() {
        if (repoRoot != null) {
            return repoRoot.toAbsolutePath().normalize();
        }

        Path cwd = Path.of("").toAbsolutePath().normalize();
        if (Files.exists(cwd.resolve("frontend")) && Files.exists(cwd.resolve("backend"))) {
            return cwd;
        }

        Path parent = cwd.getParent();
        if (parent != null && Files.exists(parent.resolve("frontend")) && Files.exists(parent.resolve("backend"))) {
            return parent;
        }

        return cwd;
    }

    private Path resolveRequiredProjectPath(String relativePath) {
        Path path = resolveProjectPath(relativePath);
        if (path == null) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Project path is not available: " + relativePath);
        }
        return path;
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

    private Path resolveProjectPath(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            return null;
        }
        return requiredRepoRoot().resolve(relativePath).normalize();
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

    private boolean pathExists(Path path) {
        return path != null && Files.exists(path);
    }

    private boolean hasVenvModule(String moduleName) {
        Path libRoot = resolveProjectPath(".venv/lib");
        if (!pathExists(libRoot)) {
            return false;
        }
        try (var children = Files.list(libRoot)) {
            return children
                .filter(Files::isDirectory)
                .map(path -> path.resolve("site-packages"))
                .anyMatch(sitePackages ->
                    pathExists(sitePackages.resolve(moduleName)) ||
                        pathExists(sitePackages.resolve(moduleName + ".py"))
                );
        } catch (IOException ignored) {
            return false;
        }
    }

    private String missingModuleMessage(List<String> modules) {
        return "PEFT/MLX 학습 의존성이 없습니다: " + String.join(", ", modules) +
            ". `.venv/bin/pip install -r backend/requirements-peft.txt`가 필요합니다.";
    }

    private ObjectNode buildPipelineSummary(String stage, String relativeSummaryPath) {
        Path summaryPath = resolveProjectPath(relativeSummaryPath);
        JsonNode summary = loadJsonFile(summaryPath);
        ObjectNode response = objectMapper.createObjectNode();
        response.put("stage", stage);
        response.put("exists", pathExists(summaryPath));
        response.set("summaryPath", nullableTextNode(summaryPath == null ? null : summaryPath.toString()));
        response.set("generatedAt", summary.isObject() ? nullableTextNode(extractText(summary, "generatedAt")) : NullNode.instance);
        response.set("summary", copyOrNull(summary));
        return response;
    }

    private ObjectNode buildReviewPipelineTaskCounts() {
        int pendingSft = 0;
        int pendingPair = 0;
        int reviewedSft = 0;
        int reviewedPair = 0;
        int llmAnnotatedSft = 0;
        int llmAnnotatedPair = 0;

        for (ReviewRepository.ReviewTaskRow task : reviewRepository.findReviewTasks()) {
            boolean reviewed = !blank(task.currentDecision());
            boolean llmAnnotated = task.llmFirstPassJson() != null && !task.llmFirstPassJson().isNull() && task.llmFirstPassJson().size() > 0;

            if ("sft".equals(task.reviewKind())) {
                if (reviewed) {
                    reviewedSft += 1;
                } else {
                    pendingSft += 1;
                }
                if (llmAnnotated) {
                    llmAnnotatedSft += 1;
                }
            } else if ("pair".equals(task.reviewKind())) {
                if (reviewed) {
                    reviewedPair += 1;
                } else {
                    pendingPair += 1;
                }
                if (llmAnnotated) {
                    llmAnnotatedPair += 1;
                }
            }
        }

        ObjectNode pending = objectMapper.createObjectNode();
        pending.put("sft", pendingSft);
        pending.put("pair", pendingPair);
        pending.put("total", pendingSft + pendingPair);

        ObjectNode reviewed = objectMapper.createObjectNode();
        reviewed.put("sft", reviewedSft);
        reviewed.put("pair", reviewedPair);
        reviewed.put("total", reviewedSft + reviewedPair);

        ObjectNode llmAnnotated = objectMapper.createObjectNode();
        llmAnnotated.put("sft", llmAnnotatedSft);
        llmAnnotated.put("pair", llmAnnotatedPair);
        llmAnnotated.put("total", llmAnnotatedSft + llmAnnotatedPair);

        ObjectNode response = objectMapper.createObjectNode();
        response.set("pending", pending);
        response.set("reviewed", reviewed);
        response.set("llmAnnotated", llmAnnotated);
        response.put("total", pendingSft + pendingPair + reviewedSft + reviewedPair);
        return response;
    }

    private JsonNode pipelineRunResponse(String stage, ProcessResult result, HttpHeaders headers) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("stage", stage);
        response.put("durationMs", result.durationMs());
        response.set("stdout", nullableTextNode(blankToNull(result.stdout())));
        response.set("status", getPipelineStatus(headers));
        return response;
    }

    private void addOptionalArgument(List<String> command, String flag, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        command.add(flag);
        command.add(value);
    }

    private void addOptionalIntegerArgument(List<String> command, String flag, Integer value) {
        if (value == null) {
            return;
        }
        command.add(flag);
        command.add(String.valueOf(value));
    }

    private void addOptionalFlag(List<String> command, String flag, boolean enabled) {
        if (!enabled) {
            return;
        }
        command.add(flag);
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

    private String requiredText(JsonNode payload, String fieldName, String message) {
        String value = trimToNull(extractText(payload, fieldName));
        if (value == null) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value;
    }

    private String requiredEnum(JsonNode payload, String fieldName, List<String> values, String message) {
        String value = requiredText(payload, fieldName, message);
        if (!values.contains(value)) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value;
    }

    private String optionalEnum(JsonNode payload, String fieldName, List<String> values, String message) {
        String value = trimToNull(extractText(payload, fieldName));
        if (value == null) {
            return null;
        }
        if (!values.contains(value)) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value;
    }

    private Integer optionalPositiveInteger(JsonNode payload, String fieldName, String message) {
        JsonNode value = payload.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isIntegralNumber() || value.asInt() < 1) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value.asInt();
    }

    private boolean optionalBoolean(JsonNode payload, String fieldName, boolean fallback) {
        JsonNode value = payload.get(fieldName);
        if (value == null || value.isNull()) {
            return fallback;
        }
        if (!value.isBoolean()) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, fieldName + " must be a boolean.");
        }
        return value.asBoolean();
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private String blankToNull(String value) {
        return trimToNull(value);
    }

    private String extractText(JsonNode node, String fieldName) {
        return extractText(node, fieldName, null);
    }

    private String extractText(JsonNode node, String fieldName, String fallback) {
        if (node == null) {
            return fallback;
        }
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return fallback;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? fallback : text;
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

    private String newestTimestamp(String first, String second) {
        if (first == null) {
            return second;
        }
        if (second == null) {
            return first;
        }
        return java.time.Instant.parse(first).isAfter(java.time.Instant.parse(second)) ? first : second;
    }

    private JsonNode taskSelectionSource(JsonNode metadata) {
        return object(metadata);
    }

    private record SnapshotSummary(
        long snapshotId,
        String datasetVersion,
        String fingerprint,
        String manifestPath,
        int rowCount,
        String generatedAt
    ) {}

    private record CommandSpec(String command, List<String> args) {}

    private record CommandBundle(CommandSpec build, CommandSpec train, CommandSpec derive) {}

    private record TrainingRunSpec(
        String runUid,
        String kind,
        String trainingBackend,
        String fingerprint,
        String sourceFingerprint,
        String sourceDatasetVersion,
        String parentRunUid,
        Long sourceSnapshotId,
        String baseModel,
        String datasetDir,
        String outputRootDir,
        String adapterPath,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String remoteProvider,
        String trainingResultPath,
        String logPath,
        CommandBundle commands
    ) {}

    private record PromotedBaseline(
        String label,
        String adapterPath,
        String remoteProvider,
        String remoteModelName
    ) {}

    private record ProcessResult(String stdout, String stderr, long durationMs) {}
}
