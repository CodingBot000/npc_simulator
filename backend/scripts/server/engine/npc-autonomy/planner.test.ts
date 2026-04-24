import assert from "node:assert/strict";
import test from "node:test";
import { createAutonomyRandom, createAutonomyRuntimeState } from "@server/engine/npc-autonomy/random";
import { determineAutonomyStepCount, planAutonomyStep } from "@server/engine/npc-autonomy/planner";
import { buildAutonomyTestFixture } from "@server/engine/npc-autonomy/test-fixtures";

test("planner excludes the NPC who just acted and never targets itself", () => {
  const fixture = buildAutonomyTestFixture();
  const rng = createAutonomyRandom(createAutonomyRuntimeState("planner-seed"));
  const step = planAutonomyStep(
    {
      autonomy: fixture.autonomy,
      npcs: fixture.npcs,
      judgements: fixture.judgements,
      round: fixture.round,
      recentEvents: fixture.recentEvents,
      excludedActorNpcIds: ["engineer"],
    },
    rng,
  );

  assert.ok(step);
  assert.notEqual(step.actorNpcId, "engineer");
  if (step.targetNpcId) {
    assert.notEqual(step.actorNpcId, step.targetNpcId);
  }
  if (step.secondaryTargetNpcId) {
    assert.notEqual(step.actorNpcId, step.secondaryTargetNpcId);
    assert.notEqual(step.targetNpcId, step.secondaryTargetNpcId);
  }
});

test("disabled autonomy returns no step", () => {
  const fixture = buildAutonomyTestFixture();
  const rng = createAutonomyRandom(createAutonomyRuntimeState("planner-disabled"));

  const step = planAutonomyStep(
    {
      autonomy: {
        ...fixture.autonomy,
        enabled: false,
      },
      npcs: fixture.npcs,
      judgements: fixture.judgements,
      round: fixture.round,
      recentEvents: fixture.recentEvents,
      excludedActorNpcIds: [],
    },
    rng,
  );

  assert.equal(step, null);
});

test("step count stays within configured bounds", () => {
  const fixture = buildAutonomyTestFixture();
  const rng = createAutonomyRandom(createAutonomyRuntimeState("planner-step-count"));
  const count = determineAutonomyStepCount(
    {
      autonomy: fixture.autonomy,
      npcs: fixture.npcs,
      judgements: fixture.judgements,
      round: fixture.round,
      recentEvents: fixture.recentEvents,
      excludedActorNpcIds: [],
    },
    rng,
  );

  assert.ok(count >= fixture.autonomy.minStepsPerTurn);
  assert.ok(count <= fixture.autonomy.maxStepsPerTurn);
});
