package com.npcsimulator.review;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingSettings {

    static final String TSX_RELATIVE_PATH = "node_modules/.bin/tsx";
    static final String TRAINING_WORKER_SCRIPT = "backend/scripts/review-training-worker.ts";
    static final String TRAINING_EVAL_WORKER_SCRIPT = "backend/scripts/review-eval-worker.ts";
    static final String EXPORT_MLX_SFT_SCRIPT = "backend/scripts/export-mlx-sft-dataset.mjs";
    static final String EXPORT_TOGETHER_SFT_SCRIPT = "backend/scripts/export-together-sft-dataset.mjs";
    static final String BUILD_MLX_DPO_SCRIPT = "backend/scripts/build-mlx-dpo-dataset.mjs";
    static final String TRAIN_PEFT_SFT_SCRIPT = "backend/scripts/train-peft-sft.py";
    static final String TRAIN_PEFT_DPO_SCRIPT = "backend/scripts/train-peft-dpo.py";
    static final String DERIVE_MLX_RUNTIME_SCRIPT = "backend/scripts/derive-mlx-runtime-from-peft.py";
    static final String MOCK_TRAINING_SCRIPT = "backend/scripts/mock-training-run.mjs";
    static final String TRAIN_RUNS_DIR = "data/train/runs";
    static final String TRAIN_OUTPUTS_DIR = "outputs/training";
    static final String TOGETHER_REMOTE_PROVIDER = "together";

    private final String datasourceUrl;
    private final String canonicalModelFamily;
    private final String trainingExecutionMode;
    private final String trainingEvalMode;
    private final String localReplyMlxModel;
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

    ReviewTrainingSettings(
        ReviewJsonSupport json,
        ReviewCanonicalModelCatalog canonicalModelCatalog,
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
        this.datasourceUrl = datasourceUrl;

        ReviewCanonicalModelCatalog.CanonicalModelDefaults canonicalModelDefaults =
            canonicalModelCatalog.resolve(configuredCanonicalModelFamily);
        this.canonicalModelFamily = canonicalModelDefaults.familyId();
        this.trainingExecutionMode = normalizeTrainingExecutionMode(
            json.firstNonBlank(trainingExecutionMode, legacyTrainingExecutionMode)
        );
        this.trainingEvalMode = trainingEvalMode == null ? "golden" : trainingEvalMode.trim().toLowerCase();
        String resolvedLocalTrainingBaseModel = resolveLocalTrainingBaseModel(
            localTrainingBaseModel,
            legacyTrainingBaseModel,
            canonicalModelDefaults
        );
        this.localReplyMlxModel = resolveLocalReplyMlxModel(
            localReplyMlxModel,
            canonicalModelDefaults
        );
        String resolvedRemoteTrainingBaseModel = resolveRemoteTrainingBaseModel(
            remoteTrainingBaseModel,
            legacyTrainingBaseModel,
            canonicalModelDefaults
        );
        this.trainingBaseModel = resolveTrainingBaseModel(
            resolvedLocalTrainingBaseModel,
            resolvedRemoteTrainingBaseModel,
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

    String datasourceUrl() {
        return datasourceUrl;
    }

    String canonicalModelFamily() {
        return canonicalModelFamily;
    }

    String trainingExecutionMode() {
        return trainingExecutionMode;
    }

    String localReplyMlxModel() {
        return localReplyMlxModel;
    }

    String trainingBaseModel() {
        return trainingBaseModel;
    }

    String trainingEvalCasesPath() {
        return trainingEvalCasesPath;
    }

    String trainingEvalProvider() {
        return trainingEvalProvider;
    }

    String trainingEvalJudgeModel() {
        return trainingEvalJudgeModel;
    }

    int sftBatchSize() {
        return sftBatchSize;
    }

    int sftIters() {
        return sftIters;
    }

    String sftLearningRate() {
        return sftLearningRate;
    }

    int sftNumLayers() {
        return sftNumLayers;
    }

    int sftStepsPerReport() {
        return sftStepsPerReport;
    }

    int sftStepsPerEval() {
        return sftStepsPerEval;
    }

    int sftSaveEvery() {
        return sftSaveEvery;
    }

    int sftMaxSeqLength() {
        return sftMaxSeqLength;
    }

    int dpoBatchSize() {
        return dpoBatchSize;
    }

    int dpoIters() {
        return dpoIters;
    }

    String dpoLearningRate() {
        return dpoLearningRate;
    }

    int dpoNumLayers() {
        return dpoNumLayers;
    }

    int dpoStepsPerReport() {
        return dpoStepsPerReport;
    }

    int dpoStepsPerEval() {
        return dpoStepsPerEval;
    }

    int dpoSaveEvery() {
        return dpoSaveEvery;
    }

    String dpoBeta() {
        return dpoBeta;
    }

    int dpoMaxSeqLength() {
        return dpoMaxSeqLength;
    }

    boolean isSmokeTrainingMode() {
        return "smoke".equals(trainingExecutionMode);
    }

    boolean isTogetherTrainingMode() {
        return "together_serverless_lora".equals(trainingExecutionMode);
    }

    String currentTrainingBackend() {
        if (isSmokeTrainingMode()) {
            return "smoke";
        }
        if (isTogetherTrainingMode()) {
            return "together_serverless_lora";
        }
        return "local_peft";
    }

    boolean shouldRunTrainingInline(ReviewJsonSupport json) {
        return isSmokeTrainingMode() && (json.blank(datasourceUrl) || datasourceUrl.startsWith("jdbc:h2:"));
    }

    boolean isSmokeTrainingEvaluationMode() {
        return "smoke".equals(trainingEvalMode);
    }

    boolean shouldRunTrainingEvaluationInline() {
        return isSmokeTrainingEvaluationMode();
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
}
