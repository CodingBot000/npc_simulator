import {
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";

const DEFAULT_SFT_INPUTS = [
  "data/train/sft/live/final_sft_train.jsonl",
  "data/train/sft/live/final_sft_dev.jsonl",
  "data/train/sft/supplemental/2026-04-14_curated_role_reply_sft_v1.jsonl",
].join(",");
const DEFAULT_PREFERENCE_INPUT = "data/train/preference/live/final_preference_pairs.jsonl";
const DEFAULT_OUTPUT = "data/evals/role_reply_harvest/cases.json";

function usage() {
  printUsage([
    "Usage: node scripts/build-role-replay-cases.mjs [options]",
    "",
    "Options:",
    `  --sft-inputs <paths>       comma-separated SFT JSONL inputs (default: ${DEFAULT_SFT_INPUTS})`,
    `  --preference-input <path>  preference JSONL input (default: ${DEFAULT_PREFERENCE_INPUT})`,
    "  --roles <list>             comma-separated roles (default: doctor,supervisor)",
    `  --output <path>            output case JSON (default: ${DEFAULT_OUTPUT})`,
    "  --help                     show this message",
  ]);
}

function parseList(value, fallback) {
  return String(value ?? fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildKey(prompt) {
  return [
    prompt.npcId ?? "unknown",
    prompt.targetNpcId ?? "none",
    prompt.playerText ?? "",
    prompt.normalizedInputSummary ?? "",
    prompt.promptContextSummary ?? "",
  ].join("||");
}

function coerceSftPrompt(row) {
  if (!row?.input || typeof row.input !== "object") {
    return null;
  }

  return {
    sourceKind: "sft",
    sourceId: row.rowId ?? null,
    npcId: row.input.npcId ?? null,
    targetNpcId: row.input.targetNpcId ?? null,
    playerText: row.input.playerText ?? "",
    normalizedInputSummary: row.input.normalizedInputSummary ?? row.input.playerText ?? "",
    promptContextSummary: row.input.promptContextSummary ?? "",
  };
}

function coercePreferencePrompt(pair) {
  if (!pair?.promptBundle || typeof pair.promptBundle !== "object") {
    return null;
  }

  return {
    sourceKind: "preference",
    sourceId: pair.pairId ?? null,
    npcId: pair.promptBundle.npcId ?? null,
    targetNpcId: pair.promptBundle.targetNpcId ?? null,
    playerText: pair.promptBundle.playerText ?? "",
    normalizedInputSummary:
      pair.promptBundle.normalizedInputSummary ?? pair.promptBundle.playerText ?? "",
    promptContextSummary: pair.promptBundle.promptContextSummary ?? "",
  };
}

function promptToCase(prompt, index) {
  return {
    id: `role_harvest_${String(index + 1).padStart(3, "0")}_${prompt.npcId}`,
    description: `${prompt.npcId} replay harvest from ${prompt.sourceKind}`,
    turns: [
      {
        npcId: prompt.npcId,
        targetNpcId: prompt.targetNpcId,
        inputMode: "free_text",
        action: null,
        text: prompt.playerText || prompt.normalizedInputSummary,
      },
    ],
    expectations: {
      minKnowledgeRetrieved: 1,
    },
    metadata: {
      sourceKind: prompt.sourceKind,
      sourceId: prompt.sourceId,
      normalizedInputSummary: prompt.normalizedInputSummary,
      promptContextSummary: prompt.promptContextSummary,
    },
    rubricHints: [
      "Prefer direct spoken Korean over report tone",
      "Preserve role-specific persona",
      "Avoid meta phrases and headings",
    ],
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const sftInputs = parseList(getStringOption(options, "sft-inputs", DEFAULT_SFT_INPUTS));
  const preferenceInput = getStringOption(options, "preference-input", DEFAULT_PREFERENCE_INPUT);
  const roles = new Set(parseList(getStringOption(options, "roles", "doctor,supervisor")));
  const outputPath = getStringOption(options, "output", DEFAULT_OUTPUT);

  const prompts = [];

  for (const inputPath of sftInputs) {
    const rows = await loadJsonOrJsonl(inputPath);
    for (const row of rows) {
      const prompt = coerceSftPrompt(row);
      if (prompt && roles.has(prompt.npcId)) {
        prompts.push(prompt);
      }
    }
  }

  const preferenceRows = await loadJsonOrJsonl(preferenceInput);
  for (const pair of preferenceRows) {
    const prompt = coercePreferencePrompt(pair);
    if (prompt && roles.has(prompt.npcId)) {
      prompts.push(prompt);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const prompt of prompts) {
    const key = buildKey(prompt);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(prompt);
  }

  const cases = deduped.map((prompt, index) => promptToCase(prompt, index));

  await writeJsonFile(outputPath, {
    version: "role-reply-harvest-v1",
    generatedAt: new Date().toISOString(),
    roles: [...roles],
    counts: {
      prompts: prompts.length,
      deduped: deduped.length,
      cases: cases.length,
    },
    cases,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        counts: {
          prompts: prompts.length,
          deduped: deduped.length,
          cases: cases.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
