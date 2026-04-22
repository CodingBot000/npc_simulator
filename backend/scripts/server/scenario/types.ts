import type {
  EventLogEntry,
  JudgementState,
  KnowledgeEvidence,
  MemoryEntry,
  PersistedNpcState,
  ResolutionState,
  RoundState,
  WorldMeta,
} from "@/lib/types";

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
  id: import("@/lib/types").PlayerAction;
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
  seeds: ScenarioSeeds;
}
