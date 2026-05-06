import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
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

test("overfocused non-player leader redirects pressure toward the safest candidate", () => {
  const fixture = buildAutonomyTestFixture();
  const rng = createAutonomyRandom(createAutonomyRuntimeState("planner-overfocus"));
  const judgements = fixture.judgements.map((entry) => {
    if (entry.candidateId === "supervisor") {
      return {
        ...entry,
        sacrificePreference: entry.sacrificePreference + 120,
      };
    }

    if (entry.candidateId === "engineer") {
      return {
        ...entry,
        sacrificePreference: entry.sacrificePreference - 20,
      };
    }

    return entry;
  });

  const step = planAutonomyStep(
    {
      autonomy: fixture.autonomy,
      npcs: fixture.npcs,
      judgements,
      round: fixture.round,
      recentEvents: fixture.recentEvents,
      excludedActorNpcIds: [],
    },
    rng,
  );

  assert.ok(step);
  assert.equal(step.actorNpcId, "supervisor");
  assert.equal(step.moveType, "redirect");
  assert.equal(step.secondaryTargetNpcId, "supervisor");
  assert.notEqual(step.targetNpcId, DEFAULT_PLAYER_ID);
  assert.equal(step.targetNpcId, "engineer");
});

test("overfocused leader redirects toward the player when manipulation suspicion is high", () => {
  const fixture = buildAutonomyTestFixture();
  const rng = createAutonomyRandom(createAutonomyRuntimeState("planner-overfocus-player"));
  const judgements = fixture.judgements.map((entry) => {
    if (entry.candidateId === "supervisor") {
      return {
        ...entry,
        sacrificePreference: entry.sacrificePreference + 120,
      };
    }

    return entry;
  });

  const step = planAutonomyStep(
    {
      autonomy: fixture.autonomy,
      npcs: fixture.npcs,
      judgements,
      round: fixture.round,
      recentEvents: fixture.recentEvents,
      excludedActorNpcIds: [],
      playerSuspicion: {
        score: 70,
        targetWeightMultiplier: 2.1,
        deltaScale: 1.35,
        reasons: ["공격 타깃이 짧은 시간 안에 여러 명으로 바뀌었다."],
      },
    },
    rng,
  );

  assert.ok(step);
  assert.equal(step.actorNpcId, "supervisor");
  assert.equal(step.moveType, "redirect");
  assert.equal(step.secondaryTargetNpcId, "supervisor");
  assert.equal(step.targetNpcId, DEFAULT_PLAYER_ID);
  assert.ok((step.targetDeltaScale ?? 1) > 1);
});
