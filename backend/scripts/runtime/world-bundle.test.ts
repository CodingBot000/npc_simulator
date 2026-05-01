import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSeedStateBundle,
  normalizeBundle,
} from "./world-bundle";

test("seed runtime bundle matches the persisted storage envelope", () => {
  const bundle = createSeedStateBundle();

  assert.equal(typeof bundle.worldState.scenarioId, "string");
  assert.equal(typeof bundle.worldState.episodeId, "string");
  assert.ok(Array.isArray(bundle.worldState.npcs));
  assert.ok(Array.isArray(bundle.worldState.events));
  assert.ok(Array.isArray(bundle.worldState.judgements));
  assert.equal(typeof bundle.memoryFile.memories, "object");
  assert.ok(Array.isArray(bundle.interactionLog.entries));
});

test("normalizes missing optional storage fields without changing the scenario", () => {
  const bundle = createSeedStateBundle();
  const normalized = normalizeBundle({
    worldState: {
      ...bundle.worldState,
      episodeId: "",
      startedAt: "",
      exportPaths: undefined,
      autonomyRuntime: undefined,
    },
    memoryFile: null,
    interactionLog: null,
  });

  assert.equal(normalized.worldState.scenarioId, bundle.worldState.scenarioId);
  assert.notEqual(normalized.worldState.episodeId, "");
  assert.notEqual(normalized.worldState.startedAt, "");
  assert.equal(typeof normalized.worldState.exportPaths, "object");
  assert.equal(typeof normalized.worldState.autonomyRuntime, "object");
  assert.deepEqual(normalized.memoryFile.memories, {});
  assert.deepEqual(normalized.interactionLog.entries, []);
});

test("rejects persisted world bundles for a different scenario", () => {
  const bundle = createSeedStateBundle();

  assert.throws(
    () =>
      normalizeBundle({
        worldState: {
          ...bundle.worldState,
          scenarioId: "different-scenario",
        },
        memoryFile: bundle.memoryFile,
        interactionLog: bundle.interactionLog,
      }),
    /active scenario/u,
  );
});
