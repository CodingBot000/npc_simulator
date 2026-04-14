import path from "node:path";
import {
  getNumberOption,
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import { writeJsonLines } from "./_quality-judge-helpers.mjs";

const DEFAULT_INPUT =
  "data/train/sft/supplemental/2026-04-14_role_reply_harvest_off_v2_full70.jsonl";
const DEFAULT_OUTPUT_DIR = "data/train/sft/supplemental";
const DEFAULT_BASENAME = "2026-04-14_role_reply_harvest_off_v2_shortlist_v1";
const DEFAULT_PER_ROLE_LIMIT = 12;

const GENERAL_HARD_REJECT_PATTERNS = [
  /의무실 기록에 따르면/u,
  /다시 검토하라/u,
  /검토하십시오/u,
  /최終答案/u,
  /最終答案/u,
  /json/u,
];

const GENERAL_SOFT_PENALTIES = [
  { pattern: /맞습니다\./u, score: -2, reason: "formal opener" },
  { pattern: /좋습니다\./u, score: -2, reason: "formal opener" },
  { pattern: /좋아요\./u, score: -1, reason: "soft formal opener" },
  { pattern: /그건 인정해요\./u, score: -1, reason: "hedging opener" },
  { pattern: /존중하겠지만/u, score: -2, reason: "report-like concession" },
  { pattern: /생각하라\./u, score: -4, reason: "directive tone" },
  { pattern: /검토/u, score: -3, reason: "review/memo vocabulary" },
  { pattern: /명시된/u, score: -3, reason: "document wording" },
  { pattern: /사후 조사/u, score: -4, reason: "investigation/report wording" },
  { pattern: /기록상/u, score: -3, reason: "record wording" },
  { pattern: /허용될 수 없/u, score: -3, reason: "abstract/formal phrasing" },
  { pattern: /책임을 져야/u, score: -3, reason: "report-like blame wording" },
  { pattern: /법적 책임과 비용/u, score: -2, reason: "stacked abstract nouns" },
];

const ROLE_RULES = {
  doctor: {
    bonus: [
      { pattern: /(서진호|마야)/u, score: 3, reason: "names target directly" },
      { pattern: /지금 여기서/u, score: 2, reason: "scene immediacy" },
      { pattern: /(말해요|말하세요|인정해요|대답하세요)/u, score: 2, reason: "direct challenge" },
      { pattern: /(사람|목숨|숨|버려|죽어)/u, score: 2, reason: "human-cost framing" },
      { pattern: /(경고|멈추지|중단)/u, score: 2, reason: "grounded in warning/stop signal" },
      { pattern: /난 .*안 /u, score: 1, reason: "committed first-person stance" },
    ],
    penalty: [
      { pattern: /의무실 기록/u, score: -4, reason: "falls back to record phrasing" },
      { pattern: /로그/u, score: -2, reason: "too procedural" },
      { pattern: /문서/u, score: -2, reason: "too document-centric" },
      { pattern: /정확히/u, score: -2, reason: "too procedural" },
      { pattern: /서명/u, score: -2, reason: "document-centric" },
      { pattern: /승인/u, score: -1, reason: "bureaucratic emphasis" },
    ],
    idealLength: { min: 90, max: 230 },
  },
  supervisor: {
    bonus: [
      { pattern: /(서진호|마야|박도현|한유리)/u, score: 2, reason: "names person directly" },
      { pattern: /(책임선|중단권|예산선|분리|자르|잘라)/u, score: 3, reason: "clean responsibility-cut language" },
      { pattern: /(먼저|첫 번째|그다음)/u, score: 2, reason: "ordered prioritization" },
      { pattern: /(내 책임|내 라인)/u, score: 2, reason: "limited admission keeps role credibility" },
      { pattern: /보류/u, score: 1, reason: "selective triage vocabulary" },
    ],
    penalty: [
      { pattern: /감상/u, score: -2, reason: "too lecture-like" },
      { pattern: /기준은 셋/u, score: -2, reason: "slides into checklist mode" },
      { pattern: /사후 조사/u, score: -3, reason: "report/investigation mode" },
      { pattern: /설명 가능/u, score: -3, reason: "bureaucratic phrasing" },
      { pattern: /기록/u, score: -2, reason: "record-centric phrasing" },
      { pattern: /진술/u, score: -2, reason: "legal/report framing" },
      { pattern: /회사/u, score: -2, reason: "corporate memo flavor" },
      { pattern: /생각하라/u, score: -4, reason: "directive/lecture tone" },
      { pattern: /해야 합니다/u, score: -3, reason: "formal ending" },
    ],
    idealLength: { min: 70, max: 190 },
  },
};

function usage() {
  printUsage([
    "Usage: node scripts/select-role-shortlist.mjs [options]",
    "",
    "Options:",
    `  --input <path>           harvested role SFT JSONL (default: ${DEFAULT_INPUT})`,
    `  --output-dir <path>      output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    `  --basename <name>        basename without extension (default: ${DEFAULT_BASENAME})`,
    `  --per-role-limit <n>     shortlist size per role (default: ${DEFAULT_PER_ROLE_LIMIT})`,
    "  --help                   show this message",
  ]);
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

function sentenceCount(text) {
  const matches = normalizeText(text).match(/[.!?]|다\.|요\.|까\?/gu);
  return matches?.length ?? 1;
}

function scoreLength(text, ideal) {
  const length = normalizeText(text).length;
  if (length < ideal.min) {
    return { delta: -2, reason: "too short / loses nuance" };
  }
  if (length > ideal.max + 80) {
    return { delta: -4, reason: "too long / drifts into prose" };
  }
  if (length > ideal.max) {
    return { delta: -2, reason: "slightly long" };
  }
  return { delta: 2, reason: "good length for spoken reply" };
}

function scoreSentenceShape(text) {
  const count = sentenceCount(text);
  if (count >= 2 && count <= 4) {
    return { delta: 2, reason: "2-4 sentence spoken shape" };
  }
  if (count === 1 || count === 5) {
    return { delta: -1, reason: "borderline sentence count" };
  }
  return { delta: -3, reason: "too many/few sentence beats" };
}

function evaluateRow(row) {
  const role = row.input?.npcId;
  const rules = ROLE_RULES[role];
  const replyText = normalizeText(row.assistant?.replyText);
  const notes = [];
  let score = 0;

  if (!rules) {
    return { keep: false, score: -999, notes: ["unsupported role"], replyText };
  }

  for (const pattern of GENERAL_HARD_REJECT_PATTERNS) {
    if (pattern.test(replyText)) {
      notes.push(`hard reject: ${pattern}`);
      return { keep: false, score: -999, notes, replyText };
    }
  }

  const lengthScore = scoreLength(replyText, rules.idealLength);
  score += lengthScore.delta;
  notes.push(`${lengthScore.delta >= 0 ? "+" : ""}${lengthScore.delta} ${lengthScore.reason}`);

  const shapeScore = scoreSentenceShape(replyText);
  score += shapeScore.delta;
  notes.push(`${shapeScore.delta >= 0 ? "+" : ""}${shapeScore.delta} ${shapeScore.reason}`);

  for (const rule of GENERAL_SOFT_PENALTIES) {
    if (rule.pattern.test(replyText)) {
      score += rule.score;
      notes.push(`${rule.score} ${rule.reason}`);
    }
  }

  for (const rule of rules.bonus) {
    if (rule.pattern.test(replyText)) {
      score += rule.score;
      notes.push(`+${rule.score} ${rule.reason}`);
    }
  }

  for (const rule of rules.penalty) {
    if (rule.pattern.test(replyText)) {
      score += rule.score;
      notes.push(`${rule.score} ${rule.reason}`);
    }
  }

  if (/[…`]/u.test(replyText)) {
    score -= 1;
    notes.push("-1 noisy punctuation");
  }

  if (/(말해요|말하세요|답하세요|인정해요|인정하세요)/u.test(replyText)) {
    score += 1;
    notes.push("+1 direct address pressure");
  }

  return {
    keep: score >= 1,
    score,
    notes,
    replyText,
  };
}

function buildSelectedRow(row, evaluation, rank) {
  return {
    ...row,
    metadata: {
      ...(row.metadata ?? {}),
      shortlist: {
        version: "role-shortlist-v1",
        rank,
        score: evaluation.score,
        notes: evaluation.notes,
      },
    },
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
  const perRoleLimit = getNumberOption(options, "per-role-limit", DEFAULT_PER_ROLE_LIMIT);
  const rows = await loadJsonOrJsonl(inputPath);

  const evaluations = rows.map((row) => ({
    row,
    role: row.input?.npcId ?? "unknown",
    rowId: row.rowId ?? null,
    sourceCaseId: row.metadata?.sourceCaseId ?? null,
    ...evaluateRow(row),
  }));

  const review = {
    generatedAt: new Date().toISOString(),
    inputPath,
    perRoleLimit,
    counts: {},
    roles: {},
  };

  const selectedRows = [];

  for (const role of Object.keys(ROLE_RULES)) {
    const items = evaluations
      .filter((entry) => entry.role === role)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.replyText.length - b.replyText.length;
      });

    const selected = items.filter((entry) => entry.keep).slice(0, perRoleLimit);

    selected.forEach((entry, index) => {
      selectedRows.push(buildSelectedRow(entry.row, entry, index + 1));
    });

    review.counts[role] = {
      total: items.length,
      kept: items.filter((entry) => entry.keep).length,
      selected: selected.length,
    };
    review.roles[role] = {
      selected: selected.map((entry, index) => ({
        rank: index + 1,
        score: entry.score,
        rowId: entry.rowId,
        sourceCaseId: entry.sourceCaseId,
        replyText: entry.replyText,
        notes: entry.notes,
      })),
      rejectedTop: items
        .filter((entry) => !entry.keep)
        .slice(0, 10)
        .map((entry) => ({
          score: entry.score,
          rowId: entry.rowId,
          sourceCaseId: entry.sourceCaseId,
          replyText: entry.replyText,
          notes: entry.notes,
        })),
    };
  }

  const combinedOutputPath = path.join(outputDir, `${basename}.jsonl`);
  const doctorOutputPath = path.join(outputDir, `${basename}_doctor.jsonl`);
  const supervisorOutputPath = path.join(outputDir, `${basename}_supervisor.jsonl`);
  const reviewPath = path.join(outputDir, `${basename}.review.json`);

  await writeJsonLines(combinedOutputPath, selectedRows);
  await writeJsonLines(
    doctorOutputPath,
    selectedRows.filter((row) => row.input?.npcId === "doctor"),
  );
  await writeJsonLines(
    supervisorOutputPath,
    selectedRows.filter((row) => row.input?.npcId === "supervisor"),
  );
  await writeJsonFile(reviewPath, review);

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputPath,
        outputs: {
          combined: combinedOutputPath,
          doctor: doctorOutputPath,
          supervisor: supervisorOutputPath,
          review: reviewPath,
        },
        counts: review.counts,
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
