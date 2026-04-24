import type { AutonomyPhaseResult } from "@backend-shared/types";
import { applyAutonomyStep } from "@server/engine/npc-autonomy/apply";
import { buildAutonomyEventLogEntry } from "@server/engine/npc-autonomy/event";
import {
  planAutonomyStep,
  determineAutonomyStepCount,
} from "@server/engine/npc-autonomy/planner";
import { createAutonomyRandom } from "@server/engine/npc-autonomy/random";
import type {
  SimulateNpcAutonomyPhaseInput,
  SimulateNpcAutonomyPhaseResult,
} from "@server/engine/npc-autonomy/types";
import { buildConsensusBoard } from "@server/engine/pressure-engine";
import { getCurrentScenario } from "@server/scenario";

/**
 * Execute the NPC autonomy phase after the round has advanced but before final
 * resolution is checked.
 */
export function simulateNpcAutonomyPhase(
  input: SimulateNpcAutonomyPhaseInput,
): SimulateNpcAutonomyPhaseResult {
  const scenario = getCurrentScenario();
  const boardBefore = buildConsensusBoard({
    judgements: input.worldState.judgements,
    npcs: input.worldState.npcs,
  });
  const drawCountBefore = input.worldState.autonomyRuntime.drawCount;

  if (!scenario.autonomy.enabled) {
    return {
      worldState: input.worldState,
      eventEntries: [],
      phase: {
        executed: false,
        round: input.worldState.round.currentRound,
        drawCountBefore,
        drawCountAfter: input.worldState.autonomyRuntime.drawCount,
        leaderBefore: boardBefore[0] ?? null,
        leaderAfter: boardBefore[0] ?? null,
        boardTopBefore: boardBefore.slice(0, 3),
        boardTopAfter: boardBefore.slice(0, 3),
        rngSamples: [],
        steps: [],
      } satisfies AutonomyPhaseResult,
    };
  }

  const rng = createAutonomyRandom(input.worldState.autonomyRuntime);
  const excludedActorNpcIds = [input.requestNpcId];
  const phaseRngSamples = [];
  const eventEntries = [];
  const steps = [];
  let nextNpcs = input.worldState.npcs;
  let nextJudgements = input.worldState.judgements;

  const stepCount = determineAutonomyStepCount(
    {
      autonomy: scenario.autonomy,
      npcs: nextNpcs,
      judgements: nextJudgements,
      round: input.worldState.round,
      recentEvents: input.recentEvents,
      excludedActorNpcIds,
    },
    rng,
  );
  phaseRngSamples.push(...rng.drainSamples());

  for (let index = 0; index < stepCount; index += 1) {
    const plannedStep = planAutonomyStep(
      {
        autonomy: scenario.autonomy,
        npcs: nextNpcs,
        judgements: nextJudgements,
        round: input.worldState.round,
        recentEvents: input.recentEvents,
        excludedActorNpcIds,
      },
      rng,
    );

    if (!plannedStep) {
      phaseRngSamples.push(...rng.drainSamples());
      break;
    }

    const applied = applyAutonomyStep({
      plannedStep,
      npcs: nextNpcs,
      judgements: nextJudgements,
      rng,
    });
    const step = {
      ...applied.step,
      rngSamples: rng.drainSamples(),
    };

    nextNpcs = applied.npcs;
    nextJudgements = applied.judgements;
    excludedActorNpcIds.push(step.actorNpcId);
    steps.push(step);
    eventEntries.push(buildAutonomyEventLogEntry(step));
  }

  input.worldState.npcs = nextNpcs;
  input.worldState.judgements = nextJudgements;

  const boardAfter = buildConsensusBoard({
    judgements: nextJudgements,
    npcs: nextNpcs,
  });

  return {
    worldState: input.worldState,
    eventEntries,
    phase: {
      executed: steps.length > 0,
      round: input.worldState.round.currentRound,
      drawCountBefore,
      drawCountAfter: input.worldState.autonomyRuntime.drawCount,
      leaderBefore: boardBefore[0] ?? null,
      leaderAfter: boardAfter[0] ?? null,
      boardTopBefore: boardBefore.slice(0, 3),
      boardTopAfter: boardAfter.slice(0, 3),
      rngSamples: phaseRngSamples,
      steps,
    } satisfies AutonomyPhaseResult,
  };
}
