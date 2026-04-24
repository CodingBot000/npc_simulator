import assert from "node:assert/strict";
import test from "node:test";
import { createAutonomyRandom, createAutonomyRuntimeState } from "@server/engine/npc-autonomy/random";

test("same debug seed produces the same draw sequence", () => {
  const first = createAutonomyRandom(createAutonomyRuntimeState("shared-seed"));
  const second = createAutonomyRandom(createAutonomyRuntimeState("shared-seed"));

  const firstValues = [
    first.nextFloat("alpha"),
    first.nextFloat("beta"),
    first.pickInt(1, 6, "gamma"),
  ];
  const secondValues = [
    second.nextFloat("alpha"),
    second.nextFloat("beta"),
    second.pickInt(1, 6, "gamma"),
  ];

  assert.deepEqual(firstValues, secondValues);
});

test("different live seeds produce different draw sequences", () => {
  const first = createAutonomyRandom(createAutonomyRuntimeState("seed-one"));
  const second = createAutonomyRandom(createAutonomyRuntimeState("seed-two"));

  const firstValues = [
    first.nextFloat("alpha"),
    first.nextFloat("beta"),
    first.pickInt(1, 6, "gamma"),
  ];
  const secondValues = [
    second.nextFloat("alpha"),
    second.nextFloat("beta"),
    second.pickInt(1, 6, "gamma"),
  ];

  assert.notDeepEqual(firstValues, secondValues);
});
