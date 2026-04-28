import canonicalModelFamiliesJson from "./canonical-model-families.json";
import { getServerEnv } from "./env-loader";

type LocalReplyRuntimeFamily = "llama" | "qwen";

type CanonicalModelFamilyEntry = {
  displayName: string;
  localTrainingBaseModelId: string;
  localReplyMlxModelId: string;
  remoteTrainingBaseModelId: string;
  localReplyRuntimeFamily: LocalReplyRuntimeFamily;
};

type CanonicalModelFamilyCatalog = {
  defaultFamily: string;
  families: Record<string, CanonicalModelFamilyEntry>;
};

const canonicalModelCatalogData =
  canonicalModelFamiliesJson as CanonicalModelFamilyCatalog;

function resolveCanonicalModelFamilyId() {
  const configuredFamilyId = getServerEnv("CANONICAL_MODEL_FAMILY");
  if (!configuredFamilyId) {
    return canonicalModelCatalogData.defaultFamily;
  }

  if (canonicalModelCatalogData.families[configuredFamilyId]) {
    return configuredFamilyId;
  }

  throw new Error(
    `Unsupported CANONICAL_MODEL_FAMILY: ${configuredFamilyId}. Supported families: ${Object.keys(
      canonicalModelCatalogData.families,
    ).join(", ")}`,
  );
}

function resolveLocalReplyRuntimeFamily(
  defaultFamily: LocalReplyRuntimeFamily,
): LocalReplyRuntimeFamily {
  const configuredFamily = getServerEnv("LOCAL_REPLY_MODEL_FAMILY");
  if (configuredFamily === "llama" || configuredFamily === "qwen") {
    return configuredFamily;
  }
  return defaultFamily;
}

const canonicalModelFamilyId = resolveCanonicalModelFamilyId();
const canonicalModelFamily =
  canonicalModelCatalogData.families[canonicalModelFamilyId];
const legacyCanonicalTrainingBaseModel = getServerEnv(
  "CANONICAL_TRAINING_BASE_MODEL",
);

export const canonicalModelCatalog = canonicalModelCatalogData;

export const canonicalModelConfig = {
  familyId: canonicalModelFamilyId,
  family: canonicalModelFamily,
  localTrainingBaseModelId:
    getServerEnv("LOCAL_CANONICAL_TRAINING_BASE_MODEL") ||
    legacyCanonicalTrainingBaseModel ||
    canonicalModelFamily.localTrainingBaseModelId,
  localReplyMlxModelId:
    getServerEnv("LOCAL_REPLY_MLX_MODEL") ||
    canonicalModelFamily.localReplyMlxModelId,
  remoteTrainingBaseModelId:
    getServerEnv("REMOTE_TRAINING_BASE_MODEL") ||
    legacyCanonicalTrainingBaseModel ||
    canonicalModelFamily.remoteTrainingBaseModelId,
  localReplyRuntimeFamily: resolveLocalReplyRuntimeFamily(
    canonicalModelFamily.localReplyRuntimeFamily,
  ),
  legacyCanonicalTrainingBaseModel,
} as const;
