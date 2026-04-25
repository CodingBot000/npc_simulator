import { getServerEnv } from "@server/config";

const DEFAULT_DATASOURCE_URL = "jdbc:postgresql://localhost:5432/npc_simulator";
const DEFAULT_DB_USER = "npc_simulator";
const DEFAULT_DB_PASSWORD = "npc_simulator";

export function stripJdbcPrefix(value: string) {
  return value.startsWith("jdbc:") ? value.slice("jdbc:".length) : value;
}

export function isPostgresDatasource(value: string | null | undefined) {
  if (!value) {
    return true;
  }

  return /^(?:jdbc:)?postgres(?:ql)?:/u.test(value);
}

export const databaseConfig = {
  datasourceUrl: getServerEnv("SPRING_DATASOURCE_URL") || DEFAULT_DATASOURCE_URL,
  datasourceUsername: getServerEnv("SPRING_DATASOURCE_USERNAME"),
  datasourcePassword: getServerEnv("SPRING_DATASOURCE_PASSWORD"),
  poolMax: Number(getServerEnv("NPC_SIMULATOR_DB_POOL_MAX") || "6"),
  idleTimeoutMillis: Number(getServerEnv("NPC_SIMULATOR_DB_IDLE_TIMEOUT_MS") || "30000"),
  connectTimeoutMillis: Number(getServerEnv("NPC_SIMULATOR_DB_CONNECT_TIMEOUT_MS") || "10000"),
  worldRepositoryMode: getServerEnv("NPC_SIMULATOR_WORLD_REPOSITORY_MODE"),
} as const;

export function buildPostgresConnectionConfig() {
  const parsedUrl = new URL(stripJdbcPrefix(databaseConfig.datasourceUrl));

  if (!/^postgres(?:ql)?:$/u.test(parsedUrl.protocol)) {
    throw new Error(`Unsupported datasource protocol: ${parsedUrl.protocol}`);
  }

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 5432,
    database: parsedUrl.pathname.replace(/^\/+/u, "") || "npc_simulator",
    user:
      databaseConfig.datasourceUsername ||
      decodeURIComponent(parsedUrl.username) ||
      DEFAULT_DB_USER,
    password:
      databaseConfig.datasourcePassword ||
      decodeURIComponent(parsedUrl.password) ||
      DEFAULT_DB_PASSWORD,
    max: databaseConfig.poolMax,
    idleTimeoutMillis: databaseConfig.idleTimeoutMillis,
    connectionTimeoutMillis: databaseConfig.connectTimeoutMillis,
  };
}
