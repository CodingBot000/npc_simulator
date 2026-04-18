import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@/lib/types";
import {
  createSeedInteractionLog,
  createSeedMemoryFile,
  createSeedWorldState,
  emptyEpisodeExportPaths,
} from "@server/seeds/world";
import { getCurrentScenario } from "@server/scenario";

export interface WorldStateBundle {
  worldState: WorldStateFile;
  memoryFile: NpcMemoryFile;
  interactionLog: InteractionLogFile;
}

function withEpisodeDefaults(state: Partial<WorldStateFile>) {
  const next = { ...state } as WorldStateFile;

  if (!next.episodeId) {
    next.episodeId = crypto.randomUUID();
  }

  if (!next.startedAt) {
    next.startedAt = new Date().toISOString();
  }

  if ((next as Partial<WorldStateFile>).endedAt === undefined) {
    next.endedAt = next.resolution?.resolved ? new Date().toISOString() : null;
  }

  if ((next as Partial<WorldStateFile>).datasetExportedAt === undefined) {
    next.datasetExportedAt = null;
  }

  if (!next.exportPaths) {
    next.exportPaths = emptyEpisodeExportPaths();
  }

  return next;
}

export function createSeedStateBundle(): WorldStateBundle {
  return {
    worldState: createSeedWorldState(),
    memoryFile: createSeedMemoryFile(),
    interactionLog: createSeedInteractionLog(),
  };
}

export function normalizeBundle(input: {
  worldState: Partial<WorldStateFile>;
  memoryFile?: Partial<NpcMemoryFile> | null;
  interactionLog?: Partial<InteractionLogFile> | null;
}): WorldStateBundle {
  const scenarioId = getCurrentScenario().id;
  const worldState = withEpisodeDefaults(input.worldState);

  if (
    worldState.scenarioId !== scenarioId ||
    !worldState.round ||
    !worldState.resolution ||
    !Array.isArray(worldState.judgements) ||
    !Array.isArray(worldState.npcs) ||
    !Array.isArray(worldState.events)
  ) {
    throw new Error("Stored world state does not match the active scenario.");
  }

  return {
    worldState,
    memoryFile: {
      memories:
        input.memoryFile && input.memoryFile.memories
          ? input.memoryFile.memories
          : {},
    },
    interactionLog: {
      entries:
        input.interactionLog && Array.isArray(input.interactionLog.entries)
          ? input.interactionLog.entries
          : [],
    },
  };
}
