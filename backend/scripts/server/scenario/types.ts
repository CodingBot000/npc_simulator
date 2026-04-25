import type {
  EventLogEntry,
  MemoryEntry,
  ResolutionState,
  RoundState,
  WorldMeta,
} from "@backend-contracts/api";
import type { JudgementState } from "@backend-persistence";
import type {
  KnowledgeEvidence,
  PersistedNpcState,
} from "@backend-domain";
import type { AutonomyMoveType, PlayerAction } from "@sim-shared/types";

export interface ScenarioPrompt {
  systemContext: string;
  replyGuidance: string;
}

export interface ScenarioPresentation {
  appTitle: string;
  npcListTitle: string;
  npcListSubtitle: string;
  interactionTitle: string;
  interactionSubtitle: string;
  interactionPlaceholder: string;
  boardTitle: string;
  boardSubtitle: string;
}

export interface ScenarioActionDefinition {
  id: PlayerAction;
  label: string;
  description: string;
  requiresTarget: boolean;
}

export interface ScenarioRoundEvent {
  round: number;
  title: string;
  detail: string;
  tags: readonly string[];
  tone: EventLogEntry["tone"];
  rescueEtaLabel: string;
  facilityStatus: string;
}

export interface ScenarioScoringConfig {
  minRoundsBeforeResolution: number;
  maxRounds: number;
  instantConsensusVotes: number;
  leadGapThreshold: number;
}

export interface ScenarioAutonomyRoundVolatility {
  fromRound: number;
  toRound: number;
  scale: number;
}

export interface ScenarioAutonomyActorBias {
  actorWeight: number;
  preferredTargets?: string[];
  protectedTargets?: string[];
  moveWeights?: Partial<Record<AutonomyMoveType, number>>;
  eventTagAffinity?: string[];
}

export interface ScenarioAutonomyEventBias {
  tag: string;
  actorWeights?: Record<string, number>;
  targetWeights?: Record<string, number>;
  moveWeights?: Partial<Record<AutonomyMoveType, number>>;
}

export interface ScenarioAutonomyConfig {
  enabled: boolean;
  minStepsPerTurn: number;
  maxStepsPerTurn: number;
  debugSeed: string | null;
  moveWeights: Record<AutonomyMoveType, number>;
  roundVolatility: ScenarioAutonomyRoundVolatility[];
  actorBias: Record<string, ScenarioAutonomyActorBias>;
  eventBiases: ScenarioAutonomyEventBias[];
}

export interface ScenarioSeeds {
  world: WorldMeta;
  npcs: PersistedNpcState[];
  memories: Record<string, MemoryEntry[]>;
  events: EventLogEntry[];
  round: RoundState;
  judgements: JudgementState[];
  resolution: ResolutionState;
}

export interface ScenarioDefinition {
  id: string;
  prompt: ScenarioPrompt;
  presentation: ScenarioPresentation;
  actions: ScenarioActionDefinition[];
  roundEvents: ScenarioRoundEvent[];
  knowledge: KnowledgeEvidence[];
  scoring: ScenarioScoringConfig;
  autonomy: ScenarioAutonomyConfig;
  seeds: ScenarioSeeds;
}
