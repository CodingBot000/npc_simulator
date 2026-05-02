import { NPC_ACTION_LABELS } from "@backend-support/constants";
import type {
  ConsensusBoardEntry,
  InteractionRequestPayload,
  InteractionResponsePayload,
  InteractionTraceEntry,
  LlmInteractionResult,
  NpcState,
} from "@backend-contracts/api";
import type { WorldStateFile } from "@backend-persistence";
import { simulateNpcAutonomyPhase } from "@server/engine/npc-autonomy";
import type { SimulateNpcAutonomyPhaseResult } from "@server/engine/npc-autonomy/types";
import { persistNpc } from "@server/engine/interaction-context";
import {
  applyInteractionPressure,
  boardTargetLabel,
  buildConsensusBoard,
  nextSpeakerState,
  progressRound,
  resolveIfNeeded,
} from "@server/engine/pressure-engine";
import {
  composeInteractionEventLogEntry,
  composeRoundEventLogEntry,
} from "@server/engine/world-state";
import {
  finishInteractionTraceStage,
  startInteractionTraceStage,
} from "@server/engine/interaction-trace";

export interface InteractionTurnStateTransitionInput {
  worldState: WorldStateFile;
  request: InteractionRequestPayload;
  npc: NpcState;
  llmResult: LlmInteractionResult;
  effectiveTargetNpcId: string | null;
  normalizedInputSummary: string;
  roundBefore: number;
  turnStartedAtMs: number;
  interactionTraceEntries: InteractionTraceEntry[];
}

export interface InteractionTurnStateTransitionResult {
  timestamp: string;
  targetLabel: string | null;
  relationshipDelta: InteractionResponsePayload["relationshipDelta"];
  pressureChanges: InteractionResponsePayload["pressureChanges"];
  eventLogEntry: InteractionResponsePayload["eventLogEntry"];
  leadingCandidate: ConsensusBoardEntry | null;
  resolution: InteractionResponsePayload["resolution"];
  autonomyPhase: SimulateNpcAutonomyPhaseResult;
}

export function applyInteractionTurnStateTransition(
  input: InteractionTurnStateTransitionInput,
): InteractionTurnStateTransitionResult {
  const {
    worldState,
    request,
    npc,
    llmResult,
    effectiveTargetNpcId,
    normalizedInputSummary,
    roundBefore,
    turnStartedAtMs,
    interactionTraceEntries,
  } = input;

  const { npc: nextNpc, relationshipDelta } = nextSpeakerState({
    npc,
    action: request.action,
    structuredImpact: llmResult.structuredImpact,
  });
  persistNpc(nextNpc, worldState.npcs);

  const pressureTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "pressure_update",
    "압력도 반영",
  );
  const pressureUpdate = applyInteractionPressure({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
    targetNpcId: effectiveTargetNpcId,
    action: request.action,
    structuredImpact: llmResult.structuredImpact,
    round: worldState.round,
  });
  worldState.judgements = pressureUpdate.judgements;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    pressureTrace,
    "ok",
    `changes=${pressureUpdate.pressureChanges.length}`,
  );

  const roundTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "round_progress",
    "라운드 진행",
  );
  const roundProgress = progressRound(worldState.round);
  worldState.round = roundProgress.round;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    roundTrace,
    "ok",
    `round=${roundBefore}->${worldState.round.currentRound}`,
  );

  const roundEventEntry = roundProgress.roundEvent
    ? composeRoundEventLogEntry(roundProgress.roundEvent)
    : null;
  const autonomyTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "autonomy_phase",
    "NPC 자율 턴",
  );
  const autonomyPhase = simulateNpcAutonomyPhase({
    worldState,
    requestNpcId: request.npcId,
    recentEvents: [
      ...(roundEventEntry ? [roundEventEntry] : []),
      ...worldState.events.slice(0, 4),
    ],
  });
  const consensusBoard = buildConsensusBoard({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
  });
  const resolution = resolveIfNeeded({
    round: worldState.round,
    consensusBoard,
  });
  worldState.resolution = resolution;
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    autonomyTrace,
    "ok",
    `executed=${autonomyPhase.phase.executed}, steps=${autonomyPhase.phase.steps.length}, resolved=${resolution.resolved}`,
  );

  const turnEventBaseTime = Date.now();
  const timestamp = new Date(turnEventBaseTime).toISOString();
  const targetLabel = effectiveTargetNpcId
    ? boardTargetLabel(effectiveTargetNpcId, worldState.npcs)
    : null;

  const eventLogEntry = composeInteractionEventLogEntry({
    npcId: request.npcId,
    npcName: npc.persona.name,
    selectedActionLabel: NPC_ACTION_LABELS[llmResult.selectedAction.type],
    promptSummary: normalizedInputSummary,
    targetLabel,
    pressureChanges: pressureUpdate.pressureChanges,
    resolution,
  });
  eventLogEntry.timestamp = timestamp;

  if (roundEventEntry) {
    roundEventEntry.timestamp = new Date(turnEventBaseTime + 1).toISOString();
  }

  autonomyPhase.eventEntries.forEach((entry, index) => {
    entry.timestamp = new Date(turnEventBaseTime + 2 + index).toISOString();
  });

  if (eventLogEntry) {
    worldState.events.unshift(eventLogEntry);
  }
  if (roundEventEntry) {
    worldState.events.unshift(roundEventEntry);
  }
  for (const entry of autonomyPhase.eventEntries) {
    worldState.events.unshift(entry);
  }

  return {
    timestamp,
    targetLabel,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    eventLogEntry,
    leadingCandidate: consensusBoard[0] ?? null,
    resolution,
    autonomyPhase,
  };
}
