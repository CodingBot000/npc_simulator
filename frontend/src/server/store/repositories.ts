import path from "node:path";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@/lib/types";
import { DATA_DIR } from "@/server/config";
import { FileWorldRepository } from "@/server/store/file-store";

export interface WorldStateBundle {
  worldState: WorldStateFile;
  memoryFile: NpcMemoryFile;
  interactionLog: InteractionLogFile;
}

export interface LockedStateMutationResult<T> {
  result: T;
  nextBundle?: WorldStateBundle;
  onSaveFailure?: () => Promise<void>;
}

export class WorldRepositoryBusyError extends Error {
  constructor(message = "World state is busy for this instance.") {
    super(message);
    this.name = "WorldRepositoryBusyError";
  }
}

export interface WorldRepository {
  ensureSeedData(): Promise<void>;
  readStateBundle(): Promise<WorldStateBundle>;
  withLockedState<T>(
    task: (
      bundle: WorldStateBundle,
    ) => Promise<LockedStateMutationResult<T>>,
  ): Promise<T>;
  resetToSeed(): Promise<WorldStateBundle>;
}

export interface WorldRepositoryOptions {
  instanceId?: string | null;
}

export function resolveWorldDataDir(options: WorldRepositoryOptions = {}) {
  return options.instanceId
    ? path.join(DATA_DIR, "runs", options.instanceId)
    : DATA_DIR;
}

export function createWorldRepository(
  options: WorldRepositoryOptions = {},
): WorldRepository {
  return new FileWorldRepository(resolveWorldDataDir(options));
}
