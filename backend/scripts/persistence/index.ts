import type {
  AutonomyPhaseResult,
  CandidateAction,
  EpisodeExportPaths,
  EventLogEntry,
  InputMode,
  InspectorPayload,
  IntentSummary,
  MemoryEntry,
  NpcState,
  PressureChange,
  RelationshipDelta,
  RetrievedKnowledgeEvidence,
  RetrievedMemoryEntry,
  RoundState,
  StructuredImpactInference,
  WorldMeta,
  WorldSnapshot,
} from "@backend-contracts/api";
import type { PersistedNpcState } from "@backend-domain";
import type {
  AllowedActionType,
  CandidateId,
  ConsensusBoardEntry,
  JudgementDimensions,
  PlayerAction,
} from "@sim-shared/types";

export interface AutonomyRuntimeState {
  liveSeed: string;
  drawCount: number;
}

export interface InteractionLogEntry {
  id: string;
  npcId: string;
  targetNpcId: string | null;
  playerId: string;
  inputMode: InputMode;
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
