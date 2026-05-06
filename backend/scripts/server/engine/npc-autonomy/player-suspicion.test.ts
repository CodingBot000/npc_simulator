import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import { buildPlayerSuspicionContext } from "@server/engine/npc-autonomy/player-suspicion";
import { buildConsensusBoard } from "@server/engine/pressure-engine";
import { buildAutonomyTestFixture } from "@server/engine/npc-autonomy/test-fixtures";

test("player suspicion rises when the player rotates aggressive targets", () => {
  const fixture = buildAutonomyTestFixture();
  const board = buildConsensusBoard({
    judgements: fixture.judgements,
    npcs: fixture.npcs,
  });
  const suspicion = buildPlayerSuspicionContext({
    board,
    round: fixture.round,
    recentEvents: fixture.recentEvents,
    recentPlayerMoves: [
      {
        round: 0,
        action: "expose",
        targetNpcId: "director",
        impactTags: ["target_blame_high_up"],
        targetPressureBefore: 103,
        playerPressureBefore: 125,
        targetWasLowPressure: false,
        leaderBeforeCandidateId: DEFAULT_PLAYER_ID,
        leaderBeforePressure: 125,
      },
      {
        round: 1,
        action: "deflect",
        targetNpcId: "supervisor",
        impactTags: ["player_blame_down", "target_blame_up"],
        targetPressureBefore: 121,
        playerPressureBefore: 125,
        targetWasLowPressure: false,
        leaderBeforeCandidateId: DEFAULT_PLAYER_ID,
        leaderBeforePressure: 125,
      },
    ],
    lastPlayerMove: {
      round: 2,
      action: "make_case",
      targetNpcId: "doctor",
      impactTags: ["target_blame_up"],
      pressureChanges: [],
      targetPressureBefore: 39,
      playerPressureBefore: 125,
      targetWasLowPressure: true,
      leaderBeforeCandidateId: DEFAULT_PLAYER_ID,
      leaderBeforePressure: 125,
    },
  });

  assert.ok(suspicion.score >= 45);
  assert.ok(suspicion.targetWeightMultiplier > 1);
  assert.ok(suspicion.deltaScale > 1);
  assert.ok(suspicion.reasons.some((reason) => reason.includes("공격 타깃")));
});

test("confession keeps player suspicion low without recent manipulation", () => {
  const fixture = buildAutonomyTestFixture();
  const board = buildConsensusBoard({
    judgements: fixture.judgements,
    npcs: fixture.npcs,
  });
  const suspicion = buildPlayerSuspicionContext({
    board,
    round: fixture.round,
    recentEvents: [],
    recentPlayerMoves: [],
    lastPlayerMove: {
      round: 0,
      action: "confess",
      targetNpcId: null,
      impactTags: ["player_blame_down", "player_sympathy_up"],
      pressureChanges: [],
      targetPressureBefore: null,
      playerPressureBefore: 125,
      targetWasLowPressure: false,
      leaderBeforeCandidateId: DEFAULT_PLAYER_ID,
      leaderBeforePressure: 125,
    },
  });

  assert.equal(suspicion.score, 0);
  assert.equal(suspicion.targetWeightMultiplier, 1);
  assert.equal(suspicion.deltaScale, 1);
});
