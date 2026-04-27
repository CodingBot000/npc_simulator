import type { ReviewTrainingBackend } from "@backend-contracts/review";
import {
  getServerEnv,
} from "@server/config";
import { canonicalModelConfig } from "@server/config/canonical-models";

export interface LocalTrainingArgs {
  batchSize: number;
  iters: number;
  learningRate: string;
  numLayers: number;
  stepsPerReport: number;
  stepsPerEval: number;
  saveEvery: number;
  maxSeqLength: number;
}

const LEGACY_CANONICAL_TRAINING_BASE_MODEL = getServerEnv(
  "CANONICAL_TRAINING_BASE_MODEL",
);

const executionMode: ReviewTrainingBackend =
  getServerEnv("TRAINING_EXECUTION_MODE") === "together_serverless_lora"
    ? "together_serverless_lora"
    : getServerEnv("TRAINING_EXECUTION_MODE") === "smoke" ||
        getServerEnv("LOCAL_TRAINING_EXECUTION_MODE") === "smoke"
      ? "smoke"
      : "local_peft";

const localCanonicalTrainingBaseModel =
  canonicalModelConfig.localTrainingBaseModelId;

const localReplyMlxModel =
  canonicalModelConfig.localReplyMlxModelId;

const remoteTrainingBaseModel =
  canonicalModelConfig.remoteTrainingBaseModelId;

const sftTrainingArgs: LocalTrainingArgs = {
  batchSize: Number(getServerEnv("LOCAL_TRAINING_SFT_BATCH_SIZE") || "1"),
  iters: Number(getServerEnv("LOCAL_TRAINING_SFT_ITERS") || "40"),
  learningRate: getServerEnv("LOCAL_TRAINING_SFT_LEARNING_RATE") || "1e-6",
  numLayers: Number(getServerEnv("LOCAL_TRAINING_SFT_NUM_LAYERS") || "2"),
  stepsPerReport: Number(getServerEnv("LOCAL_TRAINING_SFT_STEPS_PER_REPORT") || "10"),
  stepsPerEval: Number(getServerEnv("LOCAL_TRAINING_SFT_STEPS_PER_EVAL") || "10"),
  saveEvery: Number(getServerEnv("LOCAL_TRAINING_SFT_SAVE_EVERY") || "20"),
  maxSeqLength: Number(getServerEnv("LOCAL_TRAINING_SFT_MAX_SEQ_LENGTH") || "2048"),
};

const dpoTrainingArgs: LocalTrainingArgs & { beta: string } = {
  batchSize: Number(getServerEnv("LOCAL_TRAINING_DPO_BATCH_SIZE") || "1"),
  iters: Number(getServerEnv("LOCAL_TRAINING_DPO_ITERS") || "30"),
  learningRate: getServerEnv("LOCAL_TRAINING_DPO_LEARNING_RATE") || "5e-7",
  numLayers: Number(getServerEnv("LOCAL_TRAINING_DPO_NUM_LAYERS") || "2"),
  stepsPerReport: Number(getServerEnv("LOCAL_TRAINING_DPO_STEPS_PER_REPORT") || "5"),
  stepsPerEval: Number(getServerEnv("LOCAL_TRAINING_DPO_STEPS_PER_EVAL") || "10"),
  saveEvery: Number(getServerEnv("LOCAL_TRAINING_DPO_SAVE_EVERY") || "10"),
  beta: getServerEnv("LOCAL_TRAINING_DPO_BETA") || "0.1",
  maxSeqLength: Number(getServerEnv("LOCAL_TRAINING_DPO_MAX_SEQ_LENGTH") || "2048"),
};

export const reviewTrainingConfig = {
  executionMode,
  baseModels: {
    canonicalFamily: canonicalModelConfig.familyId,
    canonicalFamilyDisplayName: canonicalModelConfig.family.displayName,
    legacyCanonical: LEGACY_CANONICAL_TRAINING_BASE_MODEL,
    localCanonical: localCanonicalTrainingBaseModel,
    localReplyMlx: localReplyMlxModel,
    remoteCanonical: remoteTrainingBaseModel,
    active:
      executionMode === "together_serverless_lora"
        ? remoteTrainingBaseModel
        : localCanonicalTrainingBaseModel,
  },
  together: {
    remoteProvider: "together",
    pollIntervalMs: Number(getServerEnv("TOGETHER_POLL_INTERVAL_MS") || "10000"),
    suffixPrefix: getServerEnv("TOGETHER_TRAINING_SUFFIX_PREFIX") || "npc-sim",
    nEvals: Number(getServerEnv("TOGETHER_TRAINING_N_EVALS") || "8"),
    nCheckpoints: Number(getServerEnv("TOGETHER_TRAINING_N_CHECKPOINTS") || "1"),
    epochs: Number(getServerEnv("TOGETHER_TRAINING_EPOCHS") || "3"),
    batchSize: Number(getServerEnv("TOGETHER_TRAINING_BATCH_SIZE") || "8"),
    learningRate: Number(getServerEnv("TOGETHER_TRAINING_LEARNING_RATE") || "1e-5"),
    warmupRatio: Number(getServerEnv("TOGETHER_TRAINING_WARMUP_RATIO") || "0"),
  },
  localTraining: {
    sft: sftTrainingArgs,
    dpo: dpoTrainingArgs,
  },
} as const;
