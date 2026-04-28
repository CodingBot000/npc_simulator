import fs from "node:fs";
import { LOCAL_SERVER_ENV_FILE_PATH, serverRuntimeContext } from "./runtime-context";

let localEnvValues: Map<string, string> | null = null;

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEnvValue(raw: string) {
  const trimmed = raw.trim();
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

function readLocalEnvValues() {
  if (localEnvValues) {
    return localEnvValues;
  }

  const values = new Map<string, string>();

  if (!serverRuntimeContext.localEnvFallbackEnabled) {
    localEnvValues = values;
    return values;
  }

  if (!fs.existsSync(LOCAL_SERVER_ENV_FILE_PATH)) {
    localEnvValues = values;
    return values;
  }

  const raw = fs.readFileSync(LOCAL_SERVER_ENV_FILE_PATH, "utf8");
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

  localEnvValues = values;
  return values;
}

export function getProcessEnv(key: string) {
  return trimToNull(process.env[key]);
}

export function getServerEnv(key: string) {
  const directValue = getProcessEnv(key);
  if (directValue) {
    return directValue;
  }

  if (!serverRuntimeContext.localEnvFallbackEnabled) {
    return null;
  }

  const fallback = trimToNull(readLocalEnvValues().get(key));
  if (fallback) {
    process.env[key] = fallback;
  }
  return fallback;
}

export function hasServerEnv(key: string) {
  return getServerEnv(key) !== null;
}
