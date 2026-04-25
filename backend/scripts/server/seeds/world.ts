import type {
  EpisodeExportPaths,
} from "@backend-shared/api-contract-types";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@backend-shared/persistence-types";
import { createAutonomyRuntimeState } from "@server/engine/npc-autonomy/random";
import { getCurrentScenario } from "@server/scenario";

function cloneSeed<T>(value: T): T {
  return structuredClone(value);
}

export function emptyEpisodeExportPaths(): EpisodeExportPaths {
  return {
    richTrace: null,
    sft: null,
    review: null,
  };
}

export function createSeedWorldState(): WorldStateFile {
  const scenario = getCurrentScenario();
  const startedAt = new Date().toISOString();

  return {
    scenarioId: scenario.id,
    episodeId: crypto.randomUUID(),
    startedAt,
    endedAt: null,
    datasetExportedAt: null,
    exportPaths: emptyEpisodeExportPaths(),
    world: cloneSeed(scenario.seeds.world),
    npcs: cloneSeed(scenario.seeds.npcs),
    events: cloneSeed(scenario.seeds.events),
    lastInspector: null,
    round: cloneSeed(scenario.seeds.round),
    judgements: cloneSeed(scenario.seeds.judgements),
    resolution: cloneSeed(scenario.seeds.resolution),
    autonomyRuntime: createAutonomyRuntimeState(scenario.autonomy.debugSeed),
  };
}

export function createSeedMemoryFile(): NpcMemoryFile {
  const scenario = getCurrentScenario();

  return {
    memories: cloneSeed(scenario.seeds.memories),
  };
}

export function createSeedInteractionLog(): InteractionLogFile {
  return {
    entries: [],
  };
}
