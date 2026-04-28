import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { buildPostgresConnectionConfig } from "@server/config/database";

function buildConnectionConfig() {
  return buildPostgresConnectionConfig();
}

declare global {
  // eslint-disable-next-line no-var
  var __npcSimulatorPgPool__: Pool | undefined;
}

function getPool() {
  if (!globalThis.__npcSimulatorPgPool__) {
    globalThis.__npcSimulatorPgPool__ = new Pool(buildConnectionConfig());
  }

  return globalThis.__npcSimulatorPgPool__;
}

export async function closeDbPool() {
  const pool = globalThis.__npcSimulatorPgPool__;

  if (!pool) {
    return;
  }

  globalThis.__npcSimulatorPgPool__ = undefined;
  await pool.end();
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
}

export async function withDbTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
