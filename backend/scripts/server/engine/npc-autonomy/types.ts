import type {
  AutonomyPhaseResult,
  AutonomyStepResult,
  EventLogEntry,
  RoundState,
} from "@backend-shared/api-contract-types";
import type {
  AutonomyRuntimeState,
  JudgementState,
  WorldStateFile,
} from "@backend-shared/persistence-types";
import type { PersistedNpcState } from "@backend-shared/domain-types";
import type {
  AutonomyMoveType,
  ConsensusBoardEntry,
} from "@sim-shared/types";
import type { ScenarioAutonomyConfig } from "@server/scenario/types";

export interface AutonomyRandom {
  readonly runtime: AutonomyRuntimeState;
  nextFloat(label: string): number;
  pickInt(min: number, max: number, label: string): number;
  pickWeighted<T>(
    options: Array<{ value: T; weight: number }>,
    label: string,
  ): T | null;
  drainSamples(): AutonomyPhaseResult["rngSamples"];
}

export interface AutonomyPlannerInput {
  autonomy: ScenarioAutonomyConfig;
  npcs: PersistedNpcState[];
  judgements: JudgementState[];
  round: RoundState;
  recentEvents: EventLogEntry[];
  excludedActorNpcIds: string[];
}

export interface AutonomyPlannedStep {
  actorNpcId: string;
  moveType: AutonomyMoveType;
  targetNpcId: string | null;
  secondaryTargetNpcId: string | null;
  rationale: string;
  tone: EventLogEntry["tone"];
  volatilityScale: number;
  boardBefore: ConsensusBoardEntry[];
}

export type AutonomyStepWithoutRng = Omit<AutonomyStepResult, "rngSamples">;

export interface AutonomyApplyInput {
  plannedStep: AutonomyPlannedStep;
  npcs: PersistedNpcState[];
  judgements: JudgementState[];
  rng: AutonomyRandom;
}

export interface AutonomyApplyResult {
  npcs: PersistedNpcState[];
  judgements: JudgementState[];
  step: AutonomyStepWithoutRng;
}

export interface SimulateNpcAutonomyPhaseInput {
  worldState: WorldStateFile;
  requestNpcId: string;
  recentEvents: EventLogEntry[];
}

export interface SimulateNpcAutonomyPhaseResult {
  worldState: WorldStateFile;
  phase: AutonomyPhaseResult;
  eventEntries: EventLogEntry[];
}
