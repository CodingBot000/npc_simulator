import type {
  InteractionRequestPayload as ApiInteractionRequestPayload,
  InteractionResponsePayload as ApiInteractionResponsePayload,
  OpenApiSchema,
  WorldSnapshot as ApiWorldSnapshot,
} from "@/lib/api-contract";
export {
  allowedActionTypes,
  autonomyMoveTypes,
  emotionPrimaries,
  impactTags,
  playerActions,
} from "@sim-shared/type-sets";
import type {
  AllowedActionType as SharedAllowedActionType,
  AutonomyMoveType as SharedAutonomyMoveType,
  CandidateId as SharedCandidateId,
  ConsensusBoardEntry as SharedConsensusBoardEntry,
  EmotionPrimary as SharedEmotionPrimary,
  ImpactTag as SharedImpactTag,
  JudgementDimensions as SharedJudgementDimensions,
  PlayerAction as SharedPlayerAction,
} from "@sim-shared/types";

type Schema = OpenApiSchema;

export type EmotionPrimary = SharedEmotionPrimary;
export type AllowedActionType = SharedAllowedActionType;
export type PlayerAction = SharedPlayerAction;
export type AutonomyMoveType = SharedAutonomyMoveType;
export type ImpactTag = SharedImpactTag;
export type InputMode = Schema["InputMode"];
export type LlmProviderMode = Schema["LlmProviderMode"];

export type NpcId = Schema["NpcId"];
export type CandidateId = SharedCandidateId;
export type ResolutionType = Schema["ResolutionType"];

export type NpcPersona = Schema["NpcPersona"];
export type NpcEmotionState = Schema["NpcEmotionState"];
export type RelationshipState = Schema["RelationshipState"];
export type MemoryEntry = Schema["MemoryEntry"];
export type RetrievalScoreBreakdown = Schema["RetrievalScoreBreakdown"];
export type RetrievedMemoryEntry = Schema["RetrievedMemoryEntry"];
export type KnowledgeEvidenceType = Schema["KnowledgeEvidenceType"];
export type RetrievedKnowledgeEvidence = Schema["RetrievedKnowledgeEvidence"];
export type NpcGoalState = Schema["NpcGoalState"];
export type NpcDecisionProfile = Schema["NpcDecisionProfile"];
export type NpcState = Schema["NpcState"];
export type EventLogEntry = Schema["EventLogEntry"];
export type CandidateAction = Schema["CandidateAction"];
export type IntentSummary = Schema["IntentSummary"];
export type SelectedAction = Schema["SelectedAction"];
export type StructuredImpactInference = Schema["StructuredImpactInference"];
export type ReplyPayload = Schema["ReplyPayload"];
export type LlmInteractionResult = Schema["LlmInteractionResult"];
export type RuntimeArtifactKind = Schema["RuntimeArtifactKind"];
export type ShadowComparisonStatus = Schema["ShadowComparisonStatus"];
export type ShadowComparisonPayload = Schema["ShadowComparisonPayload"];
export type PressureChange = Schema["PressureChange"];
export type RelationshipDelta = Schema["RelationshipDelta"];
export type AutonomyRngSample = Schema["AutonomyRngSample"];
export type AutonomyOpinionDelta = Schema["AutonomyOpinionDelta"];
export type AutonomyJudgementChange = Schema["AutonomyJudgementChange"];
export type AutonomyStepResult = Schema["AutonomyStepResult"];
export type AutonomyPhaseResult = Schema["AutonomyPhaseResult"];
export type InspectorPayload = Schema["InspectorPayload"];
export type ChatMessage = Schema["ChatMessage"];
export type RuntimeStatus = Schema["RuntimeStatus"];
export type ScenarioPresentationSnapshot = Schema["ScenarioPresentationSnapshot"];
export type ScenarioScoringSnapshot = Schema["ScenarioScoringSnapshot"];
export type AvailableActionDefinition = Schema["AvailableActionDefinition"];
export type WorldMeta = Schema["WorldMeta"];
export type RoundState = Schema["RoundState"];
export type JudgementDimensions = SharedJudgementDimensions;
export type ConsensusBoardEntry = SharedConsensusBoardEntry;
export type ResolutionState = Schema["ResolutionState"];
export type EpisodeExportPaths = Schema["EpisodeExportPaths"];
export type WorldSnapshot = ApiWorldSnapshot;
export type InteractionRequestPayload = ApiInteractionRequestPayload;
export type InteractionResponsePayload = ApiInteractionResponsePayload;
