import path from "node:path";
import {
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import { writeJsonLines } from "./_quality-judge-helpers.mjs";

const DEFAULT_INPUT =
  "data/train/sft/supplemental/2026-04-14_role_reply_harvest_off_v2_shortlist_v1.jsonl";
const DEFAULT_OUTPUT_DIR = "data/train/sft/supplemental";
const DEFAULT_BASENAME = "2026-04-14_curated_role_reply_sft_v2";
const DEFAULT_INSTRUCTION =
  "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화를 생성한다.";

function usage() {
  printUsage([
    "Usage: node scripts/build-curated-from-shortlist.mjs [options]",
    "",
    "Options:",
    `  --input <path>        shortlist JSONL input (default: ${DEFAULT_INPUT})`,
    `  --output-dir <path>   output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    `  --basename <name>     basename without extension (default: ${DEFAULT_BASENAME})`,
    "  --help                show this message",
  ]);
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/^(?:\.\.\.|…)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function polishReply(role, text) {
  let reply = normalizeText(text);
  reply = reply.replace(/\.{3,}/gu, ". ");
  reply = reply.replace(/…+/gu, " ");
  reply = normalizeText(reply);

  if (role === "doctor") {
    reply = reply.replace(/서진호 씨/gu, "서진호");
    reply = reply.replace(/소장님/gu, "소장");
  }

  if (role === "supervisor") {
    reply = reply.replace(/\b좋습니다\.\s*/u, "");
    reply = reply.replace(/\b좋아요\.\s*/u, "");
    reply = reply.replace(/\b그건 맞아요\.\s*/u, "");
  }

  return reply.trim();
}

function buildRow(row, indexByRole) {
  const role = row.input?.npcId ?? "unknown";
  const polishedReply = polishReply(role, row.assistant?.replyText ?? "");
  const rank = row.metadata?.shortlist?.rank ?? null;
  const score = row.metadata?.shortlist?.score ?? null;

  return {
    datasetVersion: "curated-role-sft-2026-04-14-v2",
    rowId: `curated-role-reply-v2:${role}:${String(indexByRole + 1).padStart(2, "0")}`,
    instruction: DEFAULT_INSTRUCTION,
    input: {
      scenarioId: row.input?.scenarioId ?? "underwater-sacrifice",
      turnIndex: row.input?.turnIndex ?? 0,
      npcId: role,
      targetNpcId: row.input?.targetNpcId ?? null,
      inputMode: row.input?.inputMode ?? "free_text",
      action: row.input?.action ?? null,
      playerText: row.input?.playerText ?? "",
      normalizedInputSummary:
        row.input?.normalizedInputSummary ?? row.input?.playerText ?? "",
      promptContextSummary: row.input?.promptContextSummary ?? "",
    },
    assistant: {
      replyText: polishedReply,
    },
    metadata: {
      synthetic: true,
      curatedFrom: "off-baseline-shortlist-v1",
      sourceCaseId: row.metadata?.sourceCaseId ?? null,
      sourceKind: row.metadata?.sourceKind ?? null,
      sourceId: row.metadata?.sourceId ?? null,
      shortlistRank: rank,
      shortlistScore: score,
      createdAt: "2026-04-14",
      authoringMode: "curated-from-shortlist-pass-1",
    },
    rubricHints: Array.isArray(row.rubricHints)
      ? row.rubricHints
      : [
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

  const inputPath = getStringOption(options, "input", DEFAULT_INPUT);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const basename = getStringOption(options, "basename", DEFAULT_BASENAME);

  const rows = await loadJsonOrJsonl(inputPath);
  const countsByRole = new Map();
  const curatedRows = rows.map((row) => {
    const role = row.input?.npcId ?? "unknown";
    const nextIndex = countsByRole.get(role) ?? 0;
    countsByRole.set(role, nextIndex + 1);
    return buildRow(row, nextIndex);
  });

  const outputPath = path.join(outputDir, `${basename}.jsonl`);
  const manifestPath = path.join(outputDir, `${basename}.manifest.json`);

  await writeJsonLines(outputPath, curatedRows);
  await writeJsonFile(manifestPath, {
    ok: true,
    inputPath,
    outputPath,
    counts: {
      total: curatedRows.length,
      doctor: curatedRows.filter((row) => row.input.npcId === "doctor").length,
      supervisor: curatedRows.filter((row) => row.input.npcId === "supervisor").length,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        counts: {
          total: curatedRows.length,
          doctor: curatedRows.filter((row) => row.input.npcId === "doctor").length,
          supervisor: curatedRows.filter((row) => row.input.npcId === "supervisor").length,
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
