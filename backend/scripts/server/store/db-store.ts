import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@backend-shared/persistence-types";
import { DATA_FILES } from "@backend-shared/constants";
import { dbQuery, withDbTransaction } from "@server/db/postgres";
import { getCurrentScenario } from "@server/scenario";
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
const READ_WAIT_TIMEOUT_MS = 5 * 1000;
const READ_WAIT_INTERVAL_MS = 100;

interface PersistedWorldInstanceRow {
  id: number;
  instance_id: string;
  scenario_id: string | null;
  storage_path: string | null;
  state_version: number | string | null;
  episode_uid: string | null;
  world_state_json: unknown;
  memory_file_json: unknown;
  interaction_log_json: unknown;
}

interface PersistedWorldInstanceState {
  rowId: number;
  stateVersion: number;
  bundle: WorldStateBundle;
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

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseJsonColumn<T>(value: unknown): T | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
}

function jsonParam(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

export class DbWorldRepository implements WorldRepository {
  constructor(
    private readonly params: {
      instanceId: string;
      legacyDataDir: string;
    },
  ) {}

  async ensureSeedData() {
    await this.readStateBundle();
  }

  async readStateBundle() {
    const persisted = await this.tryReadPersistedState();

    if (persisted) {
      return persisted.bundle;
    }

    try {
      const initialized = await this.withMutationLock((client) =>
        this.ensurePersistedStateLocked(client),
      );

      return initialized.bundle;
    } catch (error) {
      if (!(error instanceof WorldRepositoryBusyError)) {
        throw error;
      }

      const startedAt = Date.now();

      while (Date.now() - startedAt < READ_WAIT_TIMEOUT_MS) {
        await new Promise((resolve) => {
          setTimeout(resolve, READ_WAIT_INTERVAL_MS);
        });

        const retry = await this.tryReadPersistedState();

        if (retry) {
          return retry.bundle;
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
    let onSaveFailure: (() => Promise<void>) | undefined;

    try {
      return await this.withMutationLock(async (client) => {
        const persisted = await this.ensurePersistedStateLocked(client);
        const mutationResult = await task(persisted.bundle);
        onSaveFailure = mutationResult.onSaveFailure;

        if (mutationResult.nextBundle) {
          await this.persistBundle(
            client,
            mutationResult.nextBundle,
            persisted.rowId,
            persisted.stateVersion,
          );
        }

        return mutationResult.result;
      });
    } catch (error) {
      if (onSaveFailure) {
        try {
          await onSaveFailure();
        } catch {
          // Cleanup errors should not hide the primary failure.
        }
      }

      throw error;
    }
  }

  async resetToSeed() {
    return this.withMutationLock(async (client) => {
      const existing = await this.findLatestRow(client);
      const seedBundle = createSeedStateBundle();
      await this.persistBundle(
        client,
        seedBundle,
        existing?.id ?? null,
        asNumber(existing?.state_version) ?? 0,
      );
      return seedBundle;
    });
  }

  private async withMutationLock<T>(task: (client: PoolClient) => Promise<T>) {
    return withDbTransaction(async (client) => {
      const lockResult = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(
            hashtext('npc_world_repository'),
            hashtext($1)
         ) AS acquired`,
        [this.params.instanceId],
      );

      if (!lockResult.rows[0]?.acquired) {
        throw new WorldRepositoryBusyError(
          `World instance '${this.params.instanceId}' is already being mutated.`,
        );
      }

      return task(client);
    });
  }

  private async tryReadPersistedState() {
    const row = await this.findLatestRow();

    if (!row) {
      return null;
    }

    return this.hydrateRow(row);
  }

  private async ensurePersistedStateLocked(
    client: PoolClient,
  ): Promise<PersistedWorldInstanceState> {
    const existingRow = await this.findLatestRow(client);
    const persisted = existingRow ? this.hydrateRow(existingRow) : null;

    if (persisted) {
      return persisted;
    }

    const nextBundle =
      (await this.tryReadLegacyBundle()) ?? createSeedStateBundle();
    const nextState = await this.persistBundle(
      client,
      nextBundle,
      existingRow?.id ?? null,
      asNumber(existingRow?.state_version) ?? 0,
    );

    return {
      ...nextState,
      bundle: nextBundle,
    };
  }

  private async findLatestRow(client?: PoolClient) {
    const result = client
      ? await client.query<PersistedWorldInstanceRow>(
          `SELECT
              id,
              instance_id,
              scenario_id,
              storage_path,
              state_version,
              episode_uid,
              world_state_json,
              memory_file_json,
              interaction_log_json
            FROM npc_world_instances
            WHERE instance_id = $1
            ORDER BY id DESC
            LIMIT 1`,
          [this.params.instanceId],
        )
      : await dbQuery<PersistedWorldInstanceRow>(
      `SELECT
          id,
          instance_id,
          scenario_id,
          storage_path,
          state_version,
          episode_uid,
          world_state_json,
          memory_file_json,
          interaction_log_json
        FROM npc_world_instances
        WHERE instance_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [this.params.instanceId],
    );

    return result.rows[0] ?? null;
  }

  private hydrateRow(row: PersistedWorldInstanceRow): PersistedWorldInstanceState | null {
    try {
      const worldState = parseJsonColumn<Partial<WorldStateFile>>(row.world_state_json);
      const memoryFile = parseJsonColumn<Partial<NpcMemoryFile>>(row.memory_file_json);
      const interactionLog = parseJsonColumn<Partial<InteractionLogFile>>(
        row.interaction_log_json,
      );

      if (!worldState || !memoryFile || !interactionLog) {
        return null;
      }

      return {
        rowId: row.id,
        stateVersion: asNumber(row.state_version) ?? 1,
        bundle: normalizeBundle({
          worldState,
          memoryFile,
          interactionLog,
        }),
      };
    } catch {
      return null;
    }
  }

  private async tryReadLegacyBundle() {
    const snapshotPath = path.join(this.params.legacyDataDir, SNAPSHOT_FILE);
    const worldStatePath = path.join(this.params.legacyDataDir, DATA_FILES.worldState);
    const npcMemoryPath = path.join(this.params.legacyDataDir, DATA_FILES.npcMemory);
    const interactionLogPath = path.join(
      this.params.legacyDataDir,
      DATA_FILES.interactionLog,
    );

    if (await pathExists(snapshotPath)) {
      try {
        const snapshot = await readJsonFile<{
          version?: number;
          worldState?: Partial<WorldStateFile>;
          memoryFile?: Partial<NpcMemoryFile>;
          interactionLog?: Partial<InteractionLogFile>;
        }>(snapshotPath);

        if (snapshot.worldState && snapshot.memoryFile && snapshot.interactionLog) {
          return normalizeBundle({
            worldState: snapshot.worldState,
            memoryFile: snapshot.memoryFile,
            interactionLog: snapshot.interactionLog,
          });
        }
      } catch {
        // Ignore broken legacy snapshots and continue to seed fallback.
      }
    }

    const checks = await Promise.all([
      pathExists(worldStatePath),
      pathExists(npcMemoryPath),
      pathExists(interactionLogPath),
    ]);

    if (checks.some((value) => !value)) {
      return null;
    }

    try {
      return normalizeBundle({
        worldState: await readJsonFile<Partial<WorldStateFile>>(worldStatePath),
        memoryFile: await readJsonFile<NpcMemoryFile>(npcMemoryPath),
        interactionLog: await readJsonFile<InteractionLogFile>(interactionLogPath),
      });
    } catch {
      return null;
    }
  }

  private async persistBundle(
    client: PoolClient,
    bundle: WorldStateBundle,
    rowId: number | null,
    currentStateVersion: number,
  ) {
    const normalizedBundle = normalizeBundle(bundle);
    const nextStateVersion = Math.max(currentStateVersion, 0) + 1;
    const scenarioId = getCurrentScenario().id;

    if (rowId) {
      await client.query(
        `UPDATE npc_world_instances
            SET scenario_id = $2,
                storage_path = $3,
                state_version = $4,
                episode_uid = $5,
                world_state_json = $6,
                memory_file_json = $7,
                interaction_log_json = $8,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
          rowId,
          scenarioId,
          this.params.legacyDataDir,
          nextStateVersion,
          normalizedBundle.worldState.episodeId,
          jsonParam(normalizedBundle.worldState),
          jsonParam(normalizedBundle.memoryFile),
          jsonParam(normalizedBundle.interactionLog),
        ],
      );

      return {
        rowId,
        stateVersion: nextStateVersion,
      };
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO npc_world_instances (
          instance_id,
          scenario_id,
          storage_path,
          state_version,
          episode_uid,
          world_state_json,
          memory_file_json,
          interaction_log_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
      [
        this.params.instanceId,
        scenarioId,
        this.params.legacyDataDir,
        nextStateVersion,
        normalizedBundle.worldState.episodeId,
        jsonParam(normalizedBundle.worldState),
        jsonParam(normalizedBundle.memoryFile),
        jsonParam(normalizedBundle.interactionLog),
      ],
    );

    return {
      rowId: inserted.rows[0].id,
      stateVersion: nextStateVersion,
    };
  }
}
