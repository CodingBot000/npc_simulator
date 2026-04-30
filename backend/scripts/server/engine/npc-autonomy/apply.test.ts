import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import { createAutonomyRandom, createAutonomyRuntimeState } from "@server/engine/npc-autonomy/random";
import { applyAutonomyStep } from "@server/engine/npc-autonomy/apply";
import { buildAutonomyTestFixture } from "@server/engine/npc-autonomy/test-fixtures";
import { buildConsensusBoard } from "@server/engine/pressure-engine";

test("pile_on raises the actor judgement against the selected target", () => {
  const fixture = buildAutonomyTestFixture();
  const before = fixture.judgements.find(
    (entry) => entry.evaluatorNpcId === "engineer" && entry.candidateId === "director",
  );
  const rng = createAutonomyRandom(createAutonomyRuntimeState("apply-pile-on"));

  const result = applyAutonomyStep({
    plannedStep: {
      actorNpcId: "engineer",
      moveType: "pile_on",
      targetNpcId: "director",
      secondaryTargetNpcId: null,
      rationale: "테스트용 pile_on",
      tone: "warning",
      volatilityScale: 1,
      boardBefore: buildConsensusBoard({
        judgements: fixture.judgements,
        npcs: fixture.npcs,
      }),
    },
    npcs: fixture.npcs,
    judgements: fixture.judgements,
    rng,
  });
  const after = result.judgements.find(
    (entry) => entry.evaluatorNpcId === "engineer" && entry.candidateId === "director",
  );

  assert.ok(before);
  assert.ok(after);
  assert.ok(after.sacrificePreference > before.sacrificePreference);
  assert.ok(result.step.opinionDeltas.some((entry) => entry.npcId === "director" && entry.delta < 0));
  assert.ok(result.step.judgementChanges.some((entry) => entry.candidateId === "director"));
  assert.ok(buildConsensusBoard({ judgements: result.judgements, npcs: result.npcs }).length > 0);
});

test("freeze leaves judgements unchanged while still updating actor state", () => {
  const fixture = buildAutonomyTestFixture();
  const rng = createAutonomyRandom(createAutonomyRuntimeState("apply-freeze"));

  const result = applyAutonomyStep({
    plannedStep: {
      actorNpcId: "doctor",
      moveType: "freeze",
      targetNpcId: "engineer",
      secondaryTargetNpcId: null,
      rationale: "테스트용 freeze",
      tone: "info",
      volatilityScale: 1,
      boardBefore: buildConsensusBoard({
        judgements: fixture.judgements,
        npcs: fixture.npcs,
      }),
    },
    npcs: fixture.npcs,
    judgements: fixture.judgements,
    rng,
  });

  assert.deepEqual(result.judgements, fixture.judgements);
  assert.equal(result.step.judgementChanges.length, 0);
  assert.ok(result.npcs.find((npc) => npc.persona.id === "doctor")?.statusLine);
});

test("pile_on can isolate the player without storing the player as an NPC opinion", () => {
  const fixture = buildAutonomyTestFixture();
  const before = fixture.judgements.find(
    (entry) => entry.evaluatorNpcId === "director" && entry.candidateId === DEFAULT_PLAYER_ID,
  );
  const beforeActor = fixture.npcs.find((npc) => npc.persona.id === "director");
  const rng = createAutonomyRandom(createAutonomyRuntimeState("apply-player-pile-on"));

  const result = applyAutonomyStep({
    plannedStep: {
      actorNpcId: "director",
      moveType: "pile_on",
      targetNpcId: DEFAULT_PLAYER_ID,
      secondaryTargetNpcId: null,
      rationale: "테스트용 player pile_on",
      tone: "warning",
      volatilityScale: 1,
      boardBefore: buildConsensusBoard({
        judgements: fixture.judgements,
        npcs: fixture.npcs,
      }),
    },
    npcs: fixture.npcs,
    judgements: fixture.judgements,
    rng,
  });
  const after = result.judgements.find(
    (entry) => entry.evaluatorNpcId === "director" && entry.candidateId === DEFAULT_PLAYER_ID,
  );
  const afterActor = result.npcs.find((npc) => npc.persona.id === "director");

  assert.ok(before);
  assert.ok(after);
  assert.ok(beforeActor);
  assert.ok(afterActor);
  assert.ok(after.sacrificePreference > before.sacrificePreference);
  assert.ok(afterActor.relationship.playerTrust < beforeActor.relationship.playerTrust);
  assert.ok(afterActor.relationship.playerTension > beforeActor.relationship.playerTension);
  assert.equal(afterActor.relationship.npcOpinions[DEFAULT_PLAYER_ID], undefined);
});
