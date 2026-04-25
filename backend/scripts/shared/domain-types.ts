import type {
  AutonomyMoveType,
  AutonomyPhaseResult,
  CandidateAction,
  ChatMessage,
  EpisodeExportPaths,
  EventLogEntry,
  InspectorPayload,
  InteractionRequestPayload,
  IntentSummary,
  LlmInteractionResult,
  LlmProviderMode,
  MemoryEntry,
  NpcState,
  PressureChange,
  RelationshipDelta,
  RetrievedKnowledgeEvidence,
  RetrievedMemoryEntry,
  RoundState,
  RuntimeStatus,
  SelectedAction,
  StructuredImpactInference,
  WorldMeta,
  WorldSnapshot,
} from "./api-contract-types";
import type {
  AllowedActionType,
  CandidateId,
  ConsensusBoardEntry,
  JudgementDimensions,
  PlayerAction,
} from "@sim-shared/types";

export type KnowledgeEvidence = Omit<
  RetrievedKnowledgeEvidence,
  "score" | "scoreBreakdown" | "matchReasons"
>;

export type PersistedNpcState = Omit<NpcState, "memories">;
export type PressureImpact = JudgementDimensions;

export interface AutonomyRuntimeState {
  liveSeed: string;
  drawCount: number;
}

export interface InteractionLogEntry {
  id: string;
  npcId: string;
  targetNpcId: string | null;
  playerId: string;
  inputMode: "free_text" | "action" | "combined";
  fallbackUsed?: boolean;
  roundBefore?: number;
  roundAfter?: number;
  playerText: string;
  rawPlayerText?: string;
  normalizedInputSummary?: string;
  playerAction: PlayerAction | null;
  replyText: string;
  timestamp: string;
  retrievedMemories?: RetrievedMemoryEntry[];
  retrievedKnowledge?: RetrievedKnowledgeEvidence[];
  llmPromptContextSummary?: string;
  emotion?: NpcState["emotion"];
  intent?: IntentSummary;
  candidateActions?: CandidateAction[];
  selectedAction: AllowedActionType;
  selectedActionReason?: string;
  structuredImpact?: StructuredImpactInference;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  leaderBefore?: ConsensusBoardEntry | null;
  leaderAfter?: ConsensusBoardEntry | null;
  resolutionAfter?: WorldSnapshot["resolution"];
  round: number;
  shadowComparison?: InspectorPayload["shadowComparison"];
  autonomyPhase?: AutonomyPhaseResult | null;
}

export interface JudgementState {
  evaluatorNpcId: string;
  candidateId: CandidateId;
  dimensions: JudgementDimensions;
  sacrificePreference: number;
}

export interface WorldStateFile {
  scenarioId: string;
  episodeId: string;
  startedAt: string;
  endedAt: string | null;
  datasetExportedAt: string | null;
  exportPaths: EpisodeExportPaths;
  world: WorldMeta;
  npcs: PersistedNpcState[];
  events: EventLogEntry[];
  lastInspector: InspectorPayload | null;
  round: RoundState;
  judgements: JudgementState[];
  resolution: WorldSnapshot["resolution"];
  autonomyRuntime: AutonomyRuntimeState;
}

export interface NpcMemoryFile {
  memories: Record<string, MemoryEntry[]>;
}

export interface InteractionLogFile {
  entries: InteractionLogEntry[];
}

export interface NormalizedInteractionInput {
  text: string;
  action: PlayerAction | null;
  actionLabel: string | null;
  promptSummary: string;
}

export interface GenerateInteractionInput {
  request: InteractionRequestPayload;
  world: WorldMeta;
  npc: NpcState;
  targetNpc: PersistedNpcState | null;
  round: RoundState;
  consensusBoard: ConsensusBoardEntry[];
  recentEvents: EventLogEntry[];
  recentConversation: ChatMessage[];
  retrievedMemories: RetrievedMemoryEntry[];
  retrievedKnowledge: RetrievedKnowledgeEvidence[];
  normalizedInput: NormalizedInteractionInput;
  promptContextSummary: string;
}

export interface LlmProvider {
  mode: LlmProviderMode;
  generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult>;
}

export type QuestStatus =
  | "locked"
  | "available"
  | "active"
  | "completed"
  | "failed";

export interface Quest {
  id: string;
  title: string;
  giverNpcId: string;
  status: QuestStatus;
  summary: string;
  requirements: string[];
  rewards: string[];
}

export interface QuestUpdate {
  questId: string;
  title: string;
  from: QuestStatus;
  to: QuestStatus;
  note: string;
}
