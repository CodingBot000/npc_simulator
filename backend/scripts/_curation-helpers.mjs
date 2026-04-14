import fs from "node:fs/promises";
import path from "node:path";
import {
  loadJsonOrJsonl,
  parseCommaSeparatedOption,
  resolveProjectPath,
} from "./_episode-cli-helpers.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listDirectoryJsonFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((entry) => [".json", ".jsonl"].includes(path.extname(entry).toLowerCase()))
    .sort();
}

async function expandPattern(pattern) {
  const resolvedPattern = resolveProjectPath(pattern);
  const wildcardMatch = /[*?]/u.test(pattern) || /[*?]/u.test(resolvedPattern);

  if (wildcardMatch) {
    const directoryPath = path.dirname(resolvedPattern);
    const filePattern = path.basename(resolvedPattern);
    const matcher = new RegExp(
      `^${escapeRegex(filePattern).replace(/\\\*/gu, ".*").replace(/\\\?/gu, ".")}$`,
      "u",
    );
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && matcher.test(entry.name))
      .map((entry) => path.join(directoryPath, entry.name))
      .sort();
  }

  const stats = await fs.stat(resolvedPattern);

  if (stats.isDirectory()) {
    return listDirectoryJsonFiles(resolvedPattern);
  }

  return [resolvedPattern];
}

export async function expandInputPatterns(input, defaultPatterns = []) {
  const patterns = parseCommaSeparatedOption(input);
  const inputPatterns = patterns.length ? patterns : defaultPatterns;

  return uniqueStrings(
    (
      await Promise.all(inputPatterns.map((pattern) => expandPattern(pattern)))
    ).flat(),
  );
}

export async function loadPlainRecords(input, defaultPatterns = []) {
  const files = await expandInputPatterns(input, defaultPatterns);
  const records = [];

  for (const filePath of files) {
    const payload = await loadJsonOrJsonl(filePath);

    if (Array.isArray(payload)) {
      for (const entry of payload) {
        records.push(entry);
      }
      continue;
    }

    if (isObject(payload)) {
      records.push(payload);
      continue;
    }

    throw new Error(`${filePath} is not a supported JSON or JSONL payload`);
  }

  return { files, records };
}

export async function loadSourceEntry(source, cache = new Map()) {
  if (!source?.path) {
    return null;
  }

  const fullPath = resolveProjectPath(source.path);
  let payload = cache.get(fullPath);

  if (payload === undefined) {
    payload = await loadJsonOrJsonl(fullPath);
    cache.set(fullPath, payload);
  }

  if (Number.isInteger(source.lineNumber) && Array.isArray(payload)) {
    return payload[source.lineNumber - 1] ?? null;
  }

  if (Number.isInteger(source.turnIndex) && isObject(payload) && Array.isArray(payload.turns)) {
    return payload.turns[source.turnIndex] ?? null;
  }

  return payload;
}

export function buildStableNumber(value) {
  return Array.from(String(value ?? "")).reduce(
    (hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0,
    5381,
  );
}

export function assignSplit(key, devRatioPercent, seed) {
  const ratio = Math.max(0, Math.min(100, Number(devRatioPercent) || 0));
  const bucket = buildStableNumber(`${seed}|${key}`) % 100;
  return bucket < ratio ? "dev" : "train";
}

export async function buildStrategyLookup(input) {
  const overridePath = "data/curation/strategy-label-overrides.json";
  const mergedInput = input ? `${input},${overridePath}` : null;
  const { files, records } = await loadPlainRecords(mergedInput, [
    "data/evals/collector-extended-summary.jsonl",
    "data/evals/collector-test-summary.jsonl",
    "data/evals/parallel-collector-a.jsonl",
    "data/evals/parallel-collector-b.jsonl",
    overridePath,
  ]);
  const byExportPath = new Map();
  const byEpisodeId = new Map();

  for (const record of records) {
    if (!isObject(record)) {
      continue;
    }

    const strategyLabel =
      typeof record.strategyLabel === "string" && record.strategyLabel
        ? record.strategyLabel
        : typeof record.strategy === "string" && record.strategy
        ? record.strategy
        : typeof record.sourceLabel === "string" && record.sourceLabel
          ? record.sourceLabel
          : null;

    if (!strategyLabel) {
      continue;
    }

    if (typeof record.episodeId === "string" && record.episodeId) {
      byEpisodeId.set(record.episodeId, strategyLabel);
    }

    if (isObject(record.exportPaths)) {
      for (const exportPath of Object.values(record.exportPaths)) {
        if (typeof exportPath === "string" && exportPath) {
          byExportPath.set(resolveProjectPath(exportPath), strategyLabel);
        }
      }
    }
  }

  return {
    files,
    byExportPath,
    byEpisodeId,
  };
}

export function inferStrategyLabel(record, strategyLookup) {
  if (!strategyLookup) {
    return null;
  }

  const sourcePath = record?.source?.path
    ? resolveProjectPath(record.source.path)
    : null;

  if (sourcePath && strategyLookup.byExportPath.has(sourcePath)) {
    return strategyLookup.byExportPath.get(sourcePath);
  }

  const episodeId = record?.promptBundle?.episodeId;
  if (episodeId && strategyLookup.byEpisodeId.has(episodeId)) {
    return strategyLookup.byEpisodeId.get(episodeId);
  }

  return null;
}

export function buildAssistantPayload(record, rawEntry) {
  if (isObject(rawEntry?.assistant)) {
    return rawEntry.assistant;
  }

  if (isObject(rawEntry?.currentChosenOutput)) {
    return {
      replyText: rawEntry.currentChosenOutput.replyText ?? "",
      selectedAction: {
        type: rawEntry.currentChosenOutput.selectedAction ?? "",
        reason: rawEntry.currentChosenOutput.selectedActionReason ?? "",
      },
      structuredImpact: rawEntry.currentChosenOutput.structuredImpact ?? null,
    };
  }

  return {
    replyText: record.candidateOutput.replyText,
    selectedAction: {
      type: record.candidateOutput.selectedAction,
      reason: record.candidateOutput.selectedActionReason,
    },
    structuredImpact: record.candidateOutput.structuredImpact,
  };
}

export function buildInputPayload(record, rawEntry) {
  if (isObject(rawEntry?.input)) {
    return rawEntry.input;
  }

  if (isObject(rawEntry?.promptBundle)) {
    return rawEntry.promptBundle;
  }

  return record.promptBundle;
}

export function normalizeHumanDecision(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (["include", "approve", "approved", "accept", "accepted"].includes(normalized)) {
    return "include";
  }

  if (
    [
      "exclude",
      "reject",
      "rejected",
      "drop",
      "dropped",
      "remove",
      "removed",
    ].includes(normalized)
  ) {
    return "exclude";
  }

  if (["flip", "swap", "reverse"].includes(normalized)) {
    return "flip";
  }

  if (
    ["escalate", "needs_revision", "needs-review", "review"].includes(
      normalized,
    )
  ) {
    return "escalate";
  }

  return null;
}

export function buildCanonicalRowKey(record) {
  const prompt = record?.promptBundle ?? {};
  const episodeId =
    typeof prompt.episodeId === "string" && prompt.episodeId
      ? prompt.episodeId
      : prompt.scenarioId ?? "unknown-scenario";

  if (Number.isInteger(prompt.turnIndex)) {
    return [
      episodeId,
      prompt.turnIndex,
      prompt.npcId ?? "unknown-npc",
      prompt.targetNpcId ?? "none",
      prompt.inputMode ?? "free_text",
    ].join("|");
  }

  return [
    episodeId,
    prompt.npcId ?? "unknown-npc",
    prompt.targetNpcId ?? "none",
    prompt.inputMode ?? "free_text",
    prompt.normalizedInputSummary ?? prompt.playerText ?? "",
  ].join("|");
}

export function buildSourceExportPath(record) {
  if (!record?.source?.path) {
    return null;
  }

  const fullPath = resolveProjectPath(record.source.path);
  return path.relative(process.cwd(), fullPath);
}

export function average(values, digits = 2) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(digits));
}
