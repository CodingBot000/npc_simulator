import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

function stripJdbcPrefix(value: string) {
  return value.startsWith("jdbc:") ? value.slice("jdbc:".length) : value;
}

function buildConnectionConfig() {
  const jdbcUrl =
    process.env.SPRING_DATASOURCE_URL || "jdbc:postgresql://localhost:5432/npc_simulator";
  const parsedUrl = new URL(stripJdbcPrefix(jdbcUrl));

  if (!/^postgres(?:ql)?:$/u.test(parsedUrl.protocol)) {
    throw new Error(`Unsupported datasource protocol: ${parsedUrl.protocol}`);
  }

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 5432,
    database: parsedUrl.pathname.replace(/^\/+/u, "") || "npc_simulator",
    user:
      process.env.SPRING_DATASOURCE_USERNAME ||
      decodeURIComponent(parsedUrl.username) ||
      "npc_simulator",
    password:
      process.env.SPRING_DATASOURCE_PASSWORD ||
      decodeURIComponent(parsedUrl.password) ||
      "npc_simulator",
    max: Number(process.env.NPC_SIMULATOR_DB_POOL_MAX || "6"),
    idleTimeoutMillis: Number(process.env.NPC_SIMULATOR_DB_IDLE_TIMEOUT_MS || "30000"),
    connectionTimeoutMillis: Number(
      process.env.NPC_SIMULATOR_DB_CONNECT_TIMEOUT_MS || "10000",
    ),
  };
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
