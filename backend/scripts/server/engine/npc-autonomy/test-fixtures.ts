import type { WorldStateFile } from "@backend-shared/types";
import { createAutonomyRuntimeState } from "@server/engine/npc-autonomy/random";
import { getCurrentScenario } from "@server/scenario";

export function buildAutonomyTestFixture() {
  const scenario = getCurrentScenario();

  return {
    autonomy: structuredClone(scenario.autonomy),
    npcs: structuredClone(scenario.seeds.npcs),
    judgements: structuredClone(scenario.seeds.judgements),
    round: structuredClone(scenario.seeds.round),
    recentEvents: structuredClone(scenario.seeds.events),
  };
}

export function buildAutonomyWorldStateFixture(): WorldStateFile {
  const scenario = getCurrentScenario();
  const startedAt = new Date().toISOString();

  return {
    scenarioId: scenario.id,
    episodeId: crypto.randomUUID(),
    startedAt,
    endedAt: null,
    datasetExportedAt: null,
    exportPaths: {
      richTrace: null,
      sft: null,
      review: null,
    },
    world: structuredClone(scenario.seeds.world),
    npcs: structuredClone(scenario.seeds.npcs),
    events: structuredClone(scenario.seeds.events),
    lastInspector: null,
    round: structuredClone(scenario.seeds.round),
    judgements: structuredClone(scenario.seeds.judgements),
    resolution: structuredClone(scenario.seeds.resolution),
    autonomyRuntime: createAutonomyRuntimeState("autonomy-test-seed"),
  };
}
