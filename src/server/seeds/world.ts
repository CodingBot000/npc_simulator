import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@/lib/types";
import { getCurrentScenario } from "@/server/scenario";

function cloneSeed<T>(value: T): T {
  return structuredClone(value);
}

export function createSeedWorldState(): WorldStateFile {
  const scenario = getCurrentScenario();

  return {
    scenarioId: scenario.id,
    world: cloneSeed(scenario.seeds.world),
    npcs: cloneSeed(scenario.seeds.npcs),
    events: cloneSeed(scenario.seeds.events),
    lastInspector: null,
    round: cloneSeed(scenario.seeds.round),
    judgements: cloneSeed(scenario.seeds.judgements),
    resolution: cloneSeed(scenario.seeds.resolution),
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
