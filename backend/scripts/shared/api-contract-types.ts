import type { components } from "@contracts/openapi-types";

type Schema = components["schemas"];

export type OpenApiSchema = Schema;

export type InteractionRequestPayload = Schema["InteractionRequest"];
export type InteractionResponsePayload = Schema["InteractionResponse"];
export type WorldSnapshot = Schema["WorldSnapshot"];
export type InspectorResponse = Schema["InspectorResponse"];

export type NpcId = Schema["NpcId"];
export type ResolutionType = Schema["ResolutionType"];
export type AutonomyMoveType = Schema["AutonomyMoveType"];
export type ImpactTag = Schema["ImpactTag"];
export type InputMode = Schema["InputMode"];
export type LlmProviderMode = Schema["LlmProviderMode"];
export type KnowledgeEvidenceType = Schema["KnowledgeEvidenceType"];

export type NpcPersona = Schema["NpcPersona"];
export type NpcEmotionState = Schema["NpcEmotionState"];
export type RelationshipState = Schema["RelationshipState"];
export type NpcGoalState = Schema["NpcGoalState"];
export type NpcDecisionProfile = Schema["NpcDecisionProfile"];
export type MemoryEntry = Schema["MemoryEntry"];
export type RetrievalScoreBreakdown = Schema["RetrievalScoreBreakdown"];
export type RetrievedMemoryEntry = Schema["RetrievedMemoryEntry"];
export type RetrievedKnowledgeEvidence = Schema["RetrievedKnowledgeEvidence"];
export type NpcState = Schema["NpcState"];
export type EventLogEntry = Schema["EventLogEntry"];
export type ChatMessage = Schema["ChatMessage"];
export type RoundState = Schema["RoundState"];
export type IntentSummary = Schema["IntentSummary"];
export type CandidateAction = Schema["CandidateAction"];
export type SelectedAction = Schema["SelectedAction"];
export type StructuredImpactInference = Schema["StructuredImpactInference"];
export type RelationshipDelta = Schema["RelationshipDelta"];
export type PressureChange = Schema["PressureChange"];
export type ResolutionState = Schema["ResolutionState"];
export type ShadowComparisonStatus = Schema["ShadowComparisonStatus"];
export type RuntimeArtifactKind = Schema["RuntimeArtifactKind"];
export type ReplyPayload = Schema["ReplyPayload"];
export type LlmInteractionResult = Schema["LlmInteractionResult"];
export type ShadowComparisonPayload = Schema["ShadowComparisonPayload"];
export type AutonomyRngSample = Schema["AutonomyRngSample"];
export type AutonomyOpinionDelta = Schema["AutonomyOpinionDelta"];
export type AutonomyJudgementChange = Schema["AutonomyJudgementChange"];
export type AutonomyStepResult = Schema["AutonomyStepResult"];
export type AutonomyPhaseResult = Schema["AutonomyPhaseResult"];
export type InspectorPayload = Schema["InspectorPayload"];
export type RuntimeStatus = Schema["RuntimeStatus"];
export type ScenarioPresentationSnapshot = Schema["ScenarioPresentationSnapshot"];
export type ScenarioScoringSnapshot = Schema["ScenarioScoringSnapshot"];
export type AvailableActionDefinition = Schema["AvailableActionDefinition"];
export type WorldMeta = Schema["WorldMeta"];
export type EpisodeExportPaths = Schema["EpisodeExportPaths"];
