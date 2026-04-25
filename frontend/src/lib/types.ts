import type {
  InteractionRequestPayload as ApiInteractionRequestPayload,
  InteractionResponsePayload as ApiInteractionResponsePayload,
  OpenApiSchema,
  WorldSnapshot as ApiWorldSnapshot,
} from "@/lib/api-contract";
import type {
  AllowedActionType as SharedAllowedActionType,
  CandidateId as SharedCandidateId,
  ConsensusBoardEntry as SharedConsensusBoardEntry,
  EmotionPrimary as SharedEmotionPrimary,
  JudgementDimensions as SharedJudgementDimensions,
  PlayerAction as SharedPlayerAction,
} from "@sim-shared/types";

type Schema = OpenApiSchema;

export type EmotionPrimary = SharedEmotionPrimary;
export type AllowedActionType = SharedAllowedActionType;
export type PlayerAction = SharedPlayerAction;
export type AutonomyMoveType = Schema["AutonomyMoveType"];
export type ImpactTag = Schema["ImpactTag"];
export type InputMode = Schema["InputMode"];
export type LlmProviderMode = Schema["LlmProviderMode"];

export const emotionPrimaries = [
  "focused",
  "fearful",
  "angry",
  "guilty",
  "cold",
  "desperate",
] as const satisfies readonly EmotionPrimary[];

export const allowedActionTypes = [
  "accuse",
  "defend",
  "deflect",
  "appeal",
  "ally",
  "stall",
  "probe",
] as const satisfies readonly AllowedActionType[];

export const playerActions = [
  "make_case",
  "expose",
  "appeal",
  "ally",
  "deflect",
  "stall",
  "confess",
] as const satisfies readonly PlayerAction[];

export const autonomyMoveTypes = [
  "pile_on",
  "shield",
  "redirect",
  "freeze",
] as const satisfies readonly AutonomyMoveType[];

export const impactTags = [
  "player_distrust_up",
  "player_distrust_down",
  "player_blame_up",
  "player_blame_down",
  "player_sympathy_up",
  "player_sympathy_down",
  "target_blame_up",
  "target_blame_high_up",
  "target_blame_down",
  "target_distrust_up",
  "target_distrust_down",
  "target_hostility_up",
  "target_hostility_down",
  "target_sympathy_up",
  "target_sympathy_down",
  "target_utility_down",
  "target_utility_up",
  "target_dispensability_up",
  "target_dispensability_down",
  "room_pressure_shift",
  "no_major_shift",
] as const satisfies readonly ImpactTag[];

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
