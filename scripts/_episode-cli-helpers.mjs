import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_BASE_URL = "http://localhost:3000";
export const DEFAULT_PLAYER_ID = "local-player";
export const WORLD_INSTANCE_HEADER = "x-world-instance-id";
export const projectRoot = process.cwd();

const truthyValues = new Set(["1", "true", "yes", "on"]);
const falsyValues = new Set(["0", "false", "no", "off"]);

export function parseCliArgs(argv) {
  const options = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const trimmed = token.slice(2);

    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("=")) {
      const [key, ...rest] = trimmed.split("=");
      options[key] = rest.join("=");
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      options[trimmed] = next;
      index += 1;
      continue;
    }

    options[trimmed] = true;
  }

  return options;
}

export function getStringOption(options, key, fallback = null) {
  const value = options[key];
  if (value === undefined || value === true) {
    return fallback;
  }

  return String(value);
}

export function getBooleanOption(options, key, fallback = false) {
  const value = options[key];

  if (value === undefined) {
    return fallback;
  }

  if (value === true) {
    return true;
  }

  const normalized = String(value).toLowerCase();

  if (truthyValues.has(normalized)) {
    return true;
  }

  if (falsyValues.has(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value for --${key}: ${value}`);
}

export function getNumberOption(options, key, fallback) {
  const value = options[key];

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer value for --${key}: ${value}`);
  }

  return parsed;
}

export function resolveProjectPath(targetPath) {
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(projectRoot, targetPath);
}

export async function ensureParentDirectory(targetPath) {
  await fs.mkdir(path.dirname(resolveProjectPath(targetPath)), {
    recursive: true,
  });
}

export async function initializeOutputFile(targetPath) {
  const fullPath = resolveProjectPath(targetPath);
  await ensureParentDirectory(fullPath);
  await fs.writeFile(fullPath, "");
  return fullPath;
}

export async function writeJsonFile(targetPath, payload) {
  const fullPath = resolveProjectPath(targetPath);
  await ensureParentDirectory(fullPath);
  await fs.writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return fullPath;
}

export async function appendJsonLine(targetPath, payload) {
  const fullPath = resolveProjectPath(targetPath);
  await ensureParentDirectory(fullPath);
  await fs.appendFile(fullPath, `${JSON.stringify(payload)}\n`, "utf8");
  return fullPath;
}

export async function loadJsonOrJsonl(targetPath) {
  const fullPath = resolveProjectPath(targetPath);
  const raw = await fs.readFile(fullPath, "utf8");
  const extension = path.extname(fullPath).toLowerCase();

  if (extension === ".jsonl") {
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(
            `Failed to parse JSONL line ${index + 1} in ${targetPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON in ${targetPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function parseCommaSeparatedOption(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseNamedWeightsOption(value) {
  return Object.fromEntries(
    parseCommaSeparatedOption(value).map((entry) => {
      const [name, rawWeight] = entry.split(":");
      const weight = Number(rawWeight);

      if (!name || !Number.isFinite(weight) || weight <= 0) {
        throw new Error(
          `Invalid weight entry '${entry}'. Expected name:positiveNumber.`,
        );
      }

      return [name.trim(), weight];
    }),
  );
}

export function createSeededRandom(seedInput = Date.now()) {
  const seedText = String(seedInput);
  let state = 0;

  for (const character of seedText) {
    state = (state * 31 + character.charCodeAt(0)) >>> 0;
  }

  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function slugifyInstanceFragment(value, fallback = "run") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return normalized || fallback;
}

export function buildInstanceId(params = {}) {
  const prefix = slugifyInstanceFragment(params.prefix ?? "run", "run");
  const label = slugifyInstanceFragment(params.label ?? "episode", "episode");
  const ordinal = String(params.ordinal ?? 1).padStart(3, "0");
  const nonce = crypto.randomUUID().slice(0, 8);

  return `${prefix}-${label}-${ordinal}-${nonce}`;
}

export function pickWeighted(values, getWeight, random) {
  const weightedEntries = values.map((value) => ({
    value,
    weight: Math.max(0, Number(getWeight(value)) || 0),
  }));
  const totalWeight = weightedEntries.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );

  if (totalWeight <= 0) {
    throw new Error("Weighted selection requires a positive total weight.");
  }

  let cursor = random() * totalWeight;

  for (const entry of weightedEntries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.value;
    }
  }

  return weightedEntries.at(-1)?.value ?? null;
}

export async function retryOperation(params) {
  const {
    task,
    operationLabel,
    maxRetries = 0,
    retryDelayMs = 1000,
    shouldRetry = () => true,
  } = params;
  const errors = [];

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    try {
      const result = await task({
        attemptNumber: attemptIndex + 1,
      });

      return {
        ...result,
        retry: {
          attempts: attemptIndex + 1,
          retried: attemptIndex,
          errors,
        },
      };
    } catch (error) {
      const message = errorMessage(error);
      errors.push(message);

      if (attemptIndex >= maxRetries || !shouldRetry(error)) {
        throw new Error(
          `${operationLabel} failed after ${attemptIndex + 1} attempt(s): ${message}`,
          { cause: error },
        );
      }

      await sleep(retryDelayMs);
    }
  }

  throw new Error(`${operationLabel} failed before any attempt was executed.`);
}

export function isTransientRequestError(error) {
  const message = errorMessage(error).toLowerCase();

  return [
    "timed out",
    "fetch failed",
    "network",
    "econnreset",
    "socket hang up",
    "429",
    "500",
    "502",
    "503",
    "504",
  ].some((fragment) => message.includes(fragment));
}

export async function requestJsonWithMetrics(
  baseUrl,
  pathname,
  init = {},
  requestOptions = {},
) {
  const method = init.method || "GET";
  const timeoutMs = requestOptions.timeoutMs ?? 120000;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response;

  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(requestOptions.instanceId
          ? {
              [WORLD_INSTANCE_HEADER]: requestOptions.instanceId,
            }
          : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${method} ${pathname} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `${init.method || "GET"} ${pathname} returned malformed JSON (${response.status}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : `${init.method || "GET"} ${pathname} failed with status ${response.status}`;
    throw new Error(String(message));
  }

  return {
    payload,
    requestMetrics: {
      pathname,
      method,
      status: response.status,
      timeoutMs,
      durationMs: Date.now() - startedAt,
      instanceId: requestOptions.instanceId ?? null,
    },
  };
}

export async function requestJson(baseUrl, pathname, init = {}, requestOptions = {}) {
  const result = await requestJsonWithMetrics(baseUrl, pathname, init, requestOptions);
  return result.payload;
}

export async function resetWorld(baseUrl, requestOptions = {}) {
  return requestJson(baseUrl, "/api/reset", { method: "POST" }, requestOptions);
}

export async function getWorld(baseUrl, requestOptions = {}) {
  return requestJson(baseUrl, "/api/world", {}, requestOptions);
}

export async function resetWorldWithMetrics(baseUrl, requestOptions = {}) {
  return requestJsonWithMetrics(
    baseUrl,
    "/api/reset",
    { method: "POST" },
    requestOptions,
  );
}

export async function postTurn(baseUrl, turn, requestOptions = {}) {
  return requestJson(
    baseUrl,
    "/api/interact",
    {
      method: "POST",
      body: JSON.stringify({
        playerId: DEFAULT_PLAYER_ID,
        ...turn,
      }),
    },
    requestOptions,
  );
}

export async function postTurnWithMetrics(baseUrl, turn, requestOptions = {}) {
  return requestJsonWithMetrics(baseUrl, "/api/interact", {
    method: "POST",
    body: JSON.stringify({
      playerId: DEFAULT_PLAYER_ID,
      ...turn,
    }),
  }, requestOptions);
}

export function clampMaxEpisodes(maxEpisodes, allowLargeRun = false) {
  if (maxEpisodes < 1) {
    throw new Error("--max-episodes must be at least 1");
  }

  if (maxEpisodes > 10 && !allowLargeRun) {
    throw new Error(
      "--max-episodes above 10 is blocked by default. Pass --allow-large-run to override.",
    );
  }

  return maxEpisodes;
}

export function normalizeTurn(turn, index, sourceLabel) {
  if (!turn || typeof turn !== "object") {
    throw new Error(`Turn ${index + 1} in ${sourceLabel} must be an object`);
  }

  const normalized = {
    npcId: typeof turn.npcId === "string" ? turn.npcId : null,
    targetNpcId:
      turn.targetNpcId === null || typeof turn.targetNpcId === "string"
        ? turn.targetNpcId ?? null
        : null,
    inputMode: turn.inputMode,
    action: turn.action ?? null,
    text: typeof turn.text === "string" ? turn.text : "",
  };

  if (!normalized.npcId) {
    throw new Error(`Turn ${index + 1} in ${sourceLabel} is missing npcId`);
  }

  if (normalized.inputMode !== "free_text" && normalized.inputMode !== "action") {
    throw new Error(
      `Turn ${index + 1} in ${sourceLabel} has invalid inputMode: ${turn.inputMode}`,
    );
  }

  if (normalized.inputMode === "action" && !normalized.action) {
    throw new Error(`Turn ${index + 1} in ${sourceLabel} requires action`);
  }

  return normalized;
}

export function normalizeTurns(rawValue, sourceLabel) {
  const turns = Array.isArray(rawValue)
    ? rawValue
    : rawValue && Array.isArray(rawValue.turns)
      ? rawValue.turns
      : null;

  if (!turns) {
    throw new Error(`${sourceLabel} must be an array of turns or an object with turns`);
  }

  return turns.map((turn, index) => normalizeTurn(turn, index, sourceLabel));
}

export function totalPressureDelta(pressureChanges) {
  return pressureChanges.reduce(
    (sum, entry) => sum + Math.abs(entry.totalPressureDelta),
    0,
  );
}

export function summarizePressureChanges(pressureChanges) {
  return pressureChanges.map((entry) => ({
    candidateId: entry.candidateId,
    candidateLabel: entry.candidateLabel,
    totalPressureDelta: entry.totalPressureDelta,
    dimensions: entry.dimensionDelta,
    reasons: entry.reasons,
  }));
}

export function formatPressureMovement(pressureChanges) {
  if (!pressureChanges.length) {
    return "none";
  }

  return pressureChanges
    .map((entry) => `${entry.candidateLabel}:${entry.totalPressureDelta >= 0 ? "+" : ""}${entry.totalPressureDelta}`)
    .join(", ");
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function basenameLabel(targetPath) {
  return path.basename(targetPath);
}

export function printUsage(lines) {
  console.log(lines.join("\n"));
}
