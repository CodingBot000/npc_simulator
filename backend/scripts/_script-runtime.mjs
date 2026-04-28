import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const localEnvCache = new Map();

function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEnvValue(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function filterDefinedEnv(overrides) {
  return Object.fromEntries(
    Object.entries(overrides).filter((entry) => entry[1] !== undefined),
  );
}

export function resolveScriptProjectRoot(scriptUrl, ...relativeSegments) {
  const segments = relativeSegments.length > 0 ? relativeSegments : ["..", ".."];
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), ...segments);
}

export function ensureScriptProjectRoot(scriptUrl, ...relativeSegments) {
  const projectRoot = resolveScriptProjectRoot(scriptUrl, ...relativeSegments);
  process.env.NPC_SIMULATOR_ROOT ??= projectRoot;
  return projectRoot;
}

function detectScriptDeploymentMode(projectRoot) {
  const explicitMode =
    trimToNull(process.env.NPC_SIMULATOR_DEPLOYMENT_MODE) ??
    trimToNull(process.env.NPC_SIMULATOR_SERVER_MODE);

  if (explicitMode === "local" || explicitMode === "cloud") {
    return explicitMode;
  }

  const springProfile = trimToNull(process.env.SPRING_PROFILES_ACTIVE);
  const nodeEnv = trimToNull(process.env.NODE_ENV);
  const explicitRoot = trimToNull(process.env.NPC_SIMULATOR_ROOT);

  if (
    springProfile === "prod" ||
    nodeEnv === "production" ||
    explicitRoot === "/workspace" ||
    projectRoot === "/workspace"
  ) {
    return "cloud";
  }

  return "local";
}

function readLocalEnvValues(projectRoot) {
  const cacheKey = projectRoot;
  if (localEnvCache.has(cacheKey)) {
    return localEnvCache.get(cacheKey);
  }

  const values = new Map();
  const deploymentMode = detectScriptDeploymentMode(projectRoot);
  const localEnvPath = path.join(projectRoot, ".env.local");

  if (deploymentMode !== "local" || !fs.existsSync(localEnvPath)) {
    localEnvCache.set(cacheKey, values);
    return values;
  }

  const raw = fs.readFileSync(localEnvPath, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    if (key) {
      values.set(key, value);
    }
  }

  localEnvCache.set(cacheKey, values);
  return values;
}

export function getScriptEnv(key, projectRoot = process.cwd()) {
  const directValue = trimToNull(process.env[key]);
  if (directValue) {
    return directValue;
  }

  const fallback = trimToNull(readLocalEnvValues(projectRoot).get(key));
  if (fallback) {
    process.env[key] = fallback;
  }
  return fallback;
}

export function buildScriptSpawnEnv(projectRoot, overrides = {}) {
  return {
    ...process.env,
    NPC_SIMULATOR_ROOT: projectRoot,
    ...filterDefinedEnv(overrides),
  };
}
