import type {
  AutonomyMoveType as ApiAutonomyMoveType,
  AutonomyJudgementChange as ApiAutonomyJudgementChange,
  AutonomyOpinionDelta as ApiAutonomyOpinionDelta,
  AutonomyPhaseResult as ApiAutonomyPhaseResult,
  AutonomyRngSample as ApiAutonomyRngSample,
  AutonomyStepResult as ApiAutonomyStepResult,
  AvailableActionDefinition as ApiAvailableActionDefinition,
  CandidateAction as ApiCandidateAction,
  ChatMessage as ApiChatMessage,
  EpisodeExportPaths as ApiEpisodeExportPaths,
  EventLogEntry as ApiEventLogEntry,
  ImpactTag as ApiImpactTag,
  InputMode as ApiInputMode,
  InspectorPayload as ApiInspectorPayload,
  InteractionRequestPayload,
  InteractionResponsePayload,
  IntentSummary as ApiIntentSummary,
  KnowledgeEvidenceType as ApiKnowledgeEvidenceType,
  LlmInteractionResult as ApiLlmInteractionResult,
  LlmProviderMode as ApiLlmProviderMode,
  MemoryEntry as ApiMemoryEntry,
  NpcDecisionProfile as ApiNpcDecisionProfile,
  NpcEmotionState as ApiNpcEmotionState,
  NpcGoalState as ApiNpcGoalState,
  NpcId as ApiNpcId,
  NpcPersona as ApiNpcPersona,
  NpcState as ApiNpcState,
  PressureChange as ApiPressureChange,
  RelationshipDelta as ApiRelationshipDelta,
  RelationshipState as ApiRelationshipState,
  ReplyPayload as ApiReplyPayload,
  ResolutionState as ApiResolutionState,
  ResolutionType as ApiResolutionType,
  RetrievedKnowledgeEvidence as ApiRetrievedKnowledgeEvidence,
  RetrievedMemoryEntry as ApiRetrievedMemoryEntry,
  RetrievalScoreBreakdown as ApiRetrievalScoreBreakdown,
  RoundState as ApiRoundState,
  RuntimeArtifactKind as ApiRuntimeArtifactKind,
  RuntimeStatus as ApiRuntimeStatus,
  ScenarioPresentationSnapshot as ApiScenarioPresentationSnapshot,
  ScenarioScoringSnapshot as ApiScenarioScoringSnapshot,
  SelectedAction as ApiSelectedAction,
  ShadowComparisonPayload as ApiShadowComparisonPayload,
  ShadowComparisonStatus as ApiShadowComparisonStatus,
  StructuredImpactInference as ApiStructuredImpactInference,
  WorldMeta as ApiWorldMeta,
  WorldSnapshot,
} from "./api-contract-types";
export type {
  AutonomyRuntimeState,
  GenerateInteractionInput,
  InteractionLogEntry,
  InteractionLogFile,
  JudgementState,
  KnowledgeEvidence,
  LlmProvider,
  NormalizedInteractionInput,
  NpcMemoryFile,
  PersistedNpcState,
  PressureImpact,
  Quest,
  QuestStatus,
  QuestUpdate,
  WorldStateFile,
} from "./domain-types";
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
export {
  allowedActionTypes,
  autonomyMoveTypes,
  emotionPrimaries,
  impactTags,
  playerActions,
} from "@sim-shared/type-sets";

export type EmotionPrimary = SharedEmotionPrimary;
export type AllowedActionType = SharedAllowedActionType;
export type PlayerAction = SharedPlayerAction;
export type AutonomyMoveType = SharedAutonomyMoveType;
export type ImpactTag = SharedImpactTag;
export type InputMode = ApiInputMode;
export type LlmProviderMode = ApiLlmProviderMode;

export type NpcId = ApiNpcId;
export type CandidateId = SharedCandidateId;
export type ResolutionType = ApiResolutionType;

export type NpcPersona = ApiNpcPersona;
export type NpcEmotionState = ApiNpcEmotionState;
export type RelationshipState = ApiRelationshipState;
export type MemoryEntry = ApiMemoryEntry;
export type RetrievalScoreBreakdown = ApiRetrievalScoreBreakdown;
export type RetrievedMemoryEntry = ApiRetrievedMemoryEntry;
export type KnowledgeEvidenceType = ApiKnowledgeEvidenceType;
export type RetrievedKnowledgeEvidence = ApiRetrievedKnowledgeEvidence;
export type NpcGoalState = ApiNpcGoalState;
export type NpcDecisionProfile = ApiNpcDecisionProfile;
export type NpcState = ApiNpcState;
export type EventLogEntry = ApiEventLogEntry;
export type CandidateAction = ApiCandidateAction;
export type IntentSummary = ApiIntentSummary;
export type SelectedAction = ApiSelectedAction;
export type StructuredImpactInference = ApiStructuredImpactInference;
export type ReplyPayload = ApiReplyPayload;
export type LlmInteractionResult = ApiLlmInteractionResult;
export type RuntimeArtifactKind = ApiRuntimeArtifactKind;
export type ShadowComparisonStatus = ApiShadowComparisonStatus;
export type ShadowComparisonPayload = ApiShadowComparisonPayload;
export type PressureChange = ApiPressureChange;
export type RelationshipDelta = ApiRelationshipDelta;

export type AutonomyRngSample = ApiAutonomyRngSample;
export type AutonomyOpinionDelta = ApiAutonomyOpinionDelta;
export type AutonomyJudgementChange = ApiAutonomyJudgementChange;
export type AutonomyStepResult = ApiAutonomyStepResult;
export type AutonomyPhaseResult = ApiAutonomyPhaseResult;
export type InspectorPayload = ApiInspectorPayload;

export type ChatMessage = ApiChatMessage;
export type RuntimeStatus = ApiRuntimeStatus;
export type ScenarioPresentationSnapshot = ApiScenarioPresentationSnapshot;
export type ScenarioScoringSnapshot = ApiScenarioScoringSnapshot;
export type AvailableActionDefinition = ApiAvailableActionDefinition;
export type WorldMeta = ApiWorldMeta;
export type RoundState = ApiRoundState;

export type JudgementDimensions = SharedJudgementDimensions;

export type ConsensusBoardEntry = SharedConsensusBoardEntry;

export type ResolutionState = ApiResolutionState;
export type EpisodeExportPaths = ApiEpisodeExportPaths;

export type {
  InteractionRequestPayload,
  InteractionResponsePayload,
  WorldSnapshot,
} from "./api-contract-types";
