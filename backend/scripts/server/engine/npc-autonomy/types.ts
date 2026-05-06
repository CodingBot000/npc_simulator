import type {
  AutonomyPhaseResult,
  AutonomyStepResult,
  ConsensusBoardEntry,
  EventLogEntry,
  ImpactTag,
  PlayerSuspicionContext,
  PressureChange,
  RoundState,
} from "@backend-contracts/api";
import type {
  AutonomyRuntimeState,
  JudgementState,
  WorldStateFile,
} from "@backend-persistence";
import type { PersistedNpcState } from "@backend-domain";
import type {
  AutonomyMoveType,
  PlayerAction,
} from "@sim-shared/types";
import type { ScenarioAutonomyConfig } from "@server/scenario/types";

export type { PlayerSuspicionContext } from "@backend-contracts/api";

export interface PlayerMovePressureContext {
  targetPressureBefore: number | null;
  playerPressureBefore: number | null;
  targetWasLowPressure: boolean;
  leaderBeforeCandidateId: string | null;
  leaderBeforePressure: number | null;
}

export interface RecentPlayerMoveContext extends PlayerMovePressureContext {
  round: number;
  action: PlayerAction | null;
  targetNpcId: string | null;
  impactTags: ImpactTag[];
}

export interface LastPlayerMoveContext extends RecentPlayerMoveContext {
  pressureChanges: PressureChange[];
}

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
  playerSuspicion?: PlayerSuspicionContext;
}

export interface AutonomyPlannedStep {
  actorNpcId: string;
  moveType: AutonomyMoveType;
  targetNpcId: string | null;
  secondaryTargetNpcId: string | null;
  rationale: string;
  tone: EventLogEntry["tone"];
  volatilityScale: number;
  targetDeltaScale?: number;
  secondaryTargetDeltaScale?: number;
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
  lastPlayerMove?: LastPlayerMoveContext | null;
  recentPlayerMoves?: RecentPlayerMoveContext[];
}

export interface SimulateNpcAutonomyPhaseResult {
  worldState: WorldStateFile;
  phase: AutonomyPhaseResult;
  eventEntries: EventLogEntry[];
}
