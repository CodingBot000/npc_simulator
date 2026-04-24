import fs from "node:fs/promises";
import path from "node:path";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@backend-shared/types";
import { DATA_FILES } from "@backend-shared/constants";
import { DATA_DIR } from "@server/config";
import type {
  LockedStateMutationResult,
  WorldRepository,
} from "@server/store/repositories";
import { WorldRepositoryBusyError } from "@server/store/repositories";
import {
  createSeedStateBundle,
  normalizeBundle,
  type WorldStateBundle,
} from "@server/store/world-bundle";

const SNAPSHOT_FILE = "state.json";
const LOCK_DIRECTORY = ".lock";
const LOCK_METADATA_FILE = "lock.json";
const TEMP_DIRECTORY = ".tmp";
const SNAPSHOT_VERSION = 1;
const LOCK_TTL_MS = 15 * 60 * 1000;
const LOCK_HEARTBEAT_MS = 10 * 1000;
const TEMP_TTL_MS = 60 * 60 * 1000;
const READ_WAIT_TIMEOUT_MS = 5 * 1000;
const READ_WAIT_INTERVAL_MS = 100;

interface RepositoryStateSnapshot {
  version: number;
  savedAt: string;
  worldState: WorldStateBundle["worldState"];
  memoryFile: WorldStateBundle["memoryFile"];
  interactionLog: WorldStateBundle["interactionLog"];
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

function bundleToSnapshot(bundle: WorldStateBundle): RepositoryStateSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    worldState: bundle.worldState,
    memoryFile: bundle.memoryFile,
    interactionLog: bundle.interactionLog,
  };
}

async function cleanupExpiredEntries(directoryPath: string, maxAgeMs: number) {
  if (!(await pathExists(directoryPath))) {
    return;
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);

      try {
        const stats = await fs.stat(entryPath);

        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.rm(entryPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup races.
      }
    }),
  );
}

export class FileWorldRepository implements WorldRepository {
  private readonly statePath: string;

  private readonly worldStatePath: string;

  private readonly interactionLogPath: string;

  private readonly npcMemoryPath: string;

  private readonly lockDirectoryPath: string;

  private readonly lockMetadataPath: string;

  private readonly tempDirectoryPath: string;

  constructor(private readonly dataDir: string = DATA_DIR) {
    this.statePath = path.join(this.dataDir, SNAPSHOT_FILE);
    this.worldStatePath = path.join(this.dataDir, DATA_FILES.worldState);
    this.interactionLogPath = path.join(
      this.dataDir,
      DATA_FILES.interactionLog,
    );
    this.npcMemoryPath = path.join(this.dataDir, DATA_FILES.npcMemory);
    this.lockDirectoryPath = path.join(this.dataDir, LOCK_DIRECTORY);
    this.lockMetadataPath = path.join(
      this.lockDirectoryPath,
      LOCK_METADATA_FILE,
    );
    this.tempDirectoryPath = path.join(this.dataDir, TEMP_DIRECTORY);
  }

  async ensureSeedData() {
    await this.readStateBundle();
  }

  async readStateBundle() {
    await this.ensureBaseDirectories();
    await this.cleanupTemporaryFilesUnlocked();

    const directSnapshot = await this.tryReadSnapshotUnlocked();

    if (directSnapshot) {
      return directSnapshot;
    }

    try {
      return await this.withMutationLock(async () => {
        const snapshot = await this.tryReadSnapshotUnlocked();

        if (snapshot) {
          return snapshot;
        }

        return this.ensureInitialStateUnlocked();
      });
    } catch (error) {
      if (!(error instanceof WorldRepositoryBusyError)) {
        throw error;
      }

      const startedAt = Date.now();

      while (Date.now() - startedAt < READ_WAIT_TIMEOUT_MS) {
        await new Promise((resolve) => {
          setTimeout(resolve, READ_WAIT_INTERVAL_MS);
        });

        const snapshot = await this.tryReadSnapshotUnlocked();

        if (snapshot) {
          return snapshot;
        }
      }

      throw error;
    }
  }

  async withLockedState<T>(
    task: (
      bundle: WorldStateBundle,
    ) => Promise<LockedStateMutationResult<T>>,
  ) {
    return this.withMutationLock(async () => {
      const bundle = await this.ensureInitialStateUnlocked();
      const mutationResult = await task(bundle);

      if (mutationResult.nextBundle) {
        try {
          await this.writeSnapshotAtomically(mutationResult.nextBundle);
        } catch (error) {
          if (mutationResult.onSaveFailure) {
            try {
              await mutationResult.onSaveFailure();
            } catch {
              // Cleanup errors should not hide the primary failure.
            }
          }

          throw error;
        }
      }

      return mutationResult.result;
    });
  }

  async resetToSeed() {
    return this.withMutationLock(async () => {
      const seedBundle = createSeedStateBundle();
      await this.writeSnapshotAtomically(seedBundle);
      return seedBundle;
    });
  }

  private async ensureBaseDirectories() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.tempDirectoryPath, { recursive: true });
  }

  private async cleanupTemporaryFilesUnlocked() {
    await cleanupExpiredEntries(this.tempDirectoryPath, TEMP_TTL_MS);
  }

  private async cleanupStaleLockUnlocked() {
    if (!(await pathExists(this.lockDirectoryPath))) {
      return;
    }

    try {
      const targetPath = (await pathExists(this.lockMetadataPath))
        ? this.lockMetadataPath
        : this.lockDirectoryPath;
      const stats = await fs.stat(targetPath);

      if (Date.now() - stats.mtimeMs > LOCK_TTL_MS) {
        await fs.rm(this.lockDirectoryPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup races.
    }
  }

  private async withMutationLock<T>(task: () => Promise<T>) {
    await this.ensureBaseDirectories();
    await this.cleanupTemporaryFilesUnlocked();
    await this.cleanupStaleLockUnlocked();

    try {
      await fs.mkdir(this.lockDirectoryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new WorldRepositoryBusyError(
          `World instance at ${this.dataDir} is already being mutated.`,
        );
      }

      throw error;
    }

    const heartbeat = setInterval(() => {
      const payload = JSON.stringify(
        {
          pid: process.pid,
          dataDir: this.dataDir,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      );

      void fs.writeFile(this.lockMetadataPath, payload, "utf8").catch(() => {});
    }, LOCK_HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      await fs.writeFile(
        this.lockMetadataPath,
        JSON.stringify(
          {
            pid: process.pid,
            dataDir: this.dataDir,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      return await task();
    } finally {
      clearInterval(heartbeat);
      await fs.rm(this.lockDirectoryPath, { recursive: true, force: true });
    }
  }

  private async ensureInitialStateUnlocked() {
    const snapshot = await this.tryReadSnapshotUnlocked();

    if (snapshot) {
      return snapshot;
    }

    const legacyBundle = await this.tryReadLegacyBundleUnlocked();
    const nextBundle = legacyBundle ?? createSeedStateBundle();
    await this.writeSnapshotAtomically(nextBundle);
    return nextBundle;
  }

  private async tryReadSnapshotUnlocked() {
    if (!(await pathExists(this.statePath))) {
      return null;
    }

    try {
      const raw = await readJsonFile<RepositoryStateSnapshot>(this.statePath);

      if (
        !raw ||
        raw.version !== SNAPSHOT_VERSION ||
        !raw.worldState ||
        !raw.memoryFile ||
        !raw.interactionLog
      ) {
        return null;
      }

      return normalizeBundle({
        worldState: raw.worldState,
        memoryFile: raw.memoryFile,
        interactionLog: raw.interactionLog,
      });
    } catch {
      return null;
    }
  }

  private async tryReadLegacyBundleUnlocked() {
    const checks = await Promise.all([
      pathExists(this.worldStatePath),
      pathExists(this.npcMemoryPath),
      pathExists(this.interactionLogPath),
    ]);

    if (checks.some((value) => !value)) {
      return null;
    }

    try {
      return normalizeBundle({
        worldState: await readJsonFile<Partial<WorldStateFile>>(
          this.worldStatePath,
        ),
        memoryFile: await readJsonFile<NpcMemoryFile>(this.npcMemoryPath),
        interactionLog: await readJsonFile<InteractionLogFile>(
          this.interactionLogPath,
        ),
      });
    } catch {
      return null;
    }
  }

  private async writeSnapshotAtomically(bundle: WorldStateBundle) {
    const normalizedBundle = normalizeBundle(bundle);
    const tempFilePath = path.join(
      this.tempDirectoryPath,
      `${SNAPSHOT_FILE}.${crypto.randomUUID()}.tmp`,
    );

    await fs.writeFile(
      tempFilePath,
      `${JSON.stringify(bundleToSnapshot(normalizedBundle), null, 2)}\n`,
      "utf8",
    );

    try {
      await fs.rename(tempFilePath, this.statePath);
    } catch (error) {
      await fs.rm(tempFilePath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
