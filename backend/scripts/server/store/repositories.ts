import path from "node:path";
import { DATA_DIR } from "@server/config";
import { DbWorldRepository } from "@server/store/db-store";
import { FileWorldRepository } from "@server/store/file-store";
import type { WorldStateBundle } from "@server/store/world-bundle";

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

export const DEFAULT_WORLD_INSTANCE_ID = "default";

export function resolveWorldDataDir(options: WorldRepositoryOptions = {}) {
  return options.instanceId
    ? path.join(DATA_DIR, "runs", options.instanceId)
    : DATA_DIR;
}

export function resolveWorldInstanceKey(options: WorldRepositoryOptions = {}) {
  return options.instanceId ?? DEFAULT_WORLD_INSTANCE_ID;
}

function isPostgresDatasource(value: string | undefined) {
  if (!value) {
    return true;
  }

  return /^(?:jdbc:)?postgres(?:ql)?:/u.test(value);
}

export function createWorldRepository(
  options: WorldRepositoryOptions = {},
): WorldRepository {
  const legacyDataDir = resolveWorldDataDir(options);
  const repositoryMode = process.env.NPC_SIMULATOR_WORLD_REPOSITORY_MODE;

  if (
    repositoryMode === "file" ||
    !isPostgresDatasource(process.env.SPRING_DATASOURCE_URL)
  ) {
    return new FileWorldRepository(legacyDataDir);
  }

  return new DbWorldRepository({
    instanceId: resolveWorldInstanceKey(options),
    legacyDataDir,
  });
}
