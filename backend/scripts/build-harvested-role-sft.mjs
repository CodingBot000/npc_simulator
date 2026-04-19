import {
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import { writeJsonLines } from "./_quality-judge-helpers.mjs";

const DEFAULT_CASES = "data/evals/role_reply_harvest/cases.json";
const DEFAULT_REPLAY = "data/evals/role_reply_harvest/off-replay.jsonl";
const DEFAULT_OUTPUT =
  "data/train/sft/supplemental/2026-04-14_role_reply_harvest_off_v1.jsonl";

const REJECT_PATTERNS = [
  /의무실 기록에 따르면/u,
  /판단 기준/u,
  /검토하십시오/u,
  /기록으로 명확히/u,
  /그럼에도 불구하고/u,
  /최終答案/u,
  /最終答案/u,
  /json/u,
];

function usage() {
  printUsage([
    "Usage: node scripts/build-harvested-role-sft.mjs [options]",
    "",
    "Options:",
    `  --cases <path>   replay case JSON (default: ${DEFAULT_CASES})`,
    `  --replay <path>  replay result JSONL (default: ${DEFAULT_REPLAY})`,
    `  --output <path>  output SFT JSONL (default: ${DEFAULT_OUTPUT})`,
    "  --help           show this message",
  ]);
}

function normalizeReply(text) {
  return String(text ?? "")
    .replace(/^(?:\.\.\.|…)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function isAcceptableReply(text) {
  const normalized = normalizeReply(text);
  if (!normalized || normalized.length < 24) {
    return false;
  }
  if (!/[가-힣]/u.test(normalized)) {
    return false;
  }
  return !REJECT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildRow(caseEntry, replayEntry) {
  const turn = caseEntry.turns?.[0] ?? {};
  const normalizedInputSummary =
    caseEntry.metadata?.normalizedInputSummary ?? turn.text ?? "";
  const promptContextSummary = caseEntry.metadata?.promptContextSummary ?? "";
  const replyText = normalizeReply(replayEntry.actual?.replyTexts?.[0] ?? "");

  return {
    datasetVersion: "role-reply-harvest-off-2026-04-14",
    rowId: `harvested-role-reply:${turn.npcId}:${caseEntry.id}`,
    instruction:
      "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화를 생성한다.",
    input: {
      scenarioId: "underwater-sacrifice",
      turnIndex: 0,
      npcId: turn.npcId ?? null,
      targetNpcId: turn.targetNpcId ?? null,
      inputMode: turn.inputMode ?? "free_text",
      action: turn.action ?? null,
      playerText: turn.text ?? "",
      normalizedInputSummary,
      promptContextSummary,
    },
    assistant: {
      replyText,
    },
    metadata: {
      synthetic: true,
      harvestedFrom: "off-baseline-replay",
      sourceCaseId: caseEntry.id,
      sourceKind: caseEntry.metadata?.sourceKind ?? null,
      sourceId: caseEntry.metadata?.sourceId ?? null,
      createdAt: "2026-04-14",
      authoringMode: "harvested-from-off-baseline",
    },
    rubricHints: caseEntry.rubricHints ?? [],
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const casesPath = getStringOption(options, "cases", DEFAULT_CASES);
  const replayPath = getStringOption(options, "replay", DEFAULT_REPLAY);
  const outputPath = getStringOption(options, "output", DEFAULT_OUTPUT);

  const casesPayload = await loadJsonOrJsonl(casesPath);
  const replayRows = await loadJsonOrJsonl(replayPath);
  const cases = Array.isArray(casesPayload?.cases) ? casesPayload.cases : [];
  const casesById = new Map(cases.map((entry) => [entry.id, entry]));

  const accepted = [];
  const rejected = [];

  for (const replayEntry of replayRows) {
    const caseEntry = casesById.get(replayEntry.caseId);
    if (!caseEntry) {
      continue;
    }

    const replyText = replayEntry.actual?.replyTexts?.[0] ?? "";
    if (replayEntry.status !== "pass" || !isAcceptableReply(replyText)) {
      rejected.push({
        caseId: replayEntry.caseId,
        status: replayEntry.status,
        replyText: normalizeReply(replyText),
      });
      continue;
    }

    accepted.push(buildRow(caseEntry, replayEntry));
  }

  await writeJsonLines(outputPath, accepted);
  await writeJsonFile(`${outputPath}.manifest.json`, {
    ok: true,
    casesPath,
    replayPath,
    outputPath,
    counts: {
      replayRows: replayRows.length,
      accepted: accepted.length,
      rejected: rejected.length,
    },
    rejected,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        counts: {
          replayRows: replayRows.length,
          accepted: accepted.length,
          rejected: rejected.length,
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
