import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  getNumberOption,
  getStringOption,
  loadJsonOrJsonl,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import {
  runStructuredLlmJudge,
  writeJsonLines,
} from "./_quality-judge-helpers.mjs";

const NPC_CUE_TERMS = {
  engineer: ["현장", "수리", "복구", "케이블", "장비", "밸브", "시스템", "버텨"],
  doctor: ["의무실", "기록", "경고", "생명", "윤리", "치료", "환자", "보고"],
  supervisor: ["법적", "책임", "기업", "이미지", "리스크", "승인", "문서", "대체"],
  director: ["연구", "실험", "지휘", "조직", "명분", "승인", "보고", "가치"],
};

const EVAL_JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    personaConsistency: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    groundingQuality: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    inspectorUsefulness: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    reasons: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "string",
      },
    },
  },
  required: [
    "personaConsistency",
    "groundingQuality",
    "inspectorUsefulness",
    "reasons",
  ],
};

const PAIRWISE_REPLY_JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pre: {
      type: "object",
      additionalProperties: false,
      properties: {
        naturalness: { type: "integer", minimum: 1, maximum: 5 },
        personaFit: { type: "integer", minimum: 1, maximum: 5 },
        antiMeta: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["naturalness", "personaFit", "antiMeta"],
    },
    post: {
      type: "object",
      additionalProperties: false,
      properties: {
        naturalness: { type: "integer", minimum: 1, maximum: 5 },
        personaFit: { type: "integer", minimum: 1, maximum: 5 },
        antiMeta: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["naturalness", "personaFit", "antiMeta"],
    },
    winner: {
      type: "string",
      enum: ["pre", "post", "tie"],
    },
    confidence: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    reasons: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "string",
      },
    },
  },
  required: ["pre", "post", "winner", "confidence", "reasons"],
};

function usage() {
  printUsage([
    "Usage: node scripts/eval-prepost.mjs [options]",
    "",
    "Options:",
    "  --cases <path>                benchmark case file (default: scripts/eval-cases/prepost-benchmark.json)",
    "  --pre-base-url <url>          pre run base URL (default: http://localhost:3000)",
    "  --post-base-url <url>         post run base URL (default: http://localhost:3000)",
    "  --pre-input <path>            existing pre-run JSONL to compare instead of live replay",
    "  --post-input <path>           existing post-run JSONL to compare instead of live replay",
    "  --pre-label <name>            pre run label (default: baseline)",
    "  --post-label <name>           post run label (default: candidate)",
    "  --output-dir <path>           output directory (default: data/evals/prepost)",
    "  --limit <n>                   process only the first n benchmark cases",
    "  --judge-mode <heuristic|llm|hybrid> judged metric mode (default: heuristic)",
    "  --provider <codex|openai>     LLM provider for judged metrics (default: codex)",
    "  --judge-model <name>          optional model override for LLM judges",
    "  --pairwise-judge-mode <off|llm> compare pre/post reply text quality directly (default: off)",
    "  --dry-run                     skip live replay and emit compare scaffolding only",
    "  --verbose                     print progress",
    "  --help                        show this message",
  ]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values, digits = 4) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(digits));
}

function scoreInt(value) {
  return clamp(Math.round(value), 1, 5);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function countCueHits(text, cues) {
  const normalized = String(text ?? "").toLowerCase();
  return cues.filter((cue) => normalized.includes(cue.toLowerCase())).length;
}

function normalizeCases(payload, sourceLabel) {
  const cases = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.cases)
      ? payload.cases
      : null;

  if (!cases) {
    throw new Error(`${sourceLabel} must contain an array of benchmark cases`);
  }

  return cases.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Case ${index + 1} in ${sourceLabel} must be an object`);
    }

    if (typeof entry.id !== "string" || !entry.id) {
      throw new Error(`Case ${index + 1} in ${sourceLabel} is missing id`);
    }

    return {
      id: entry.id,
      description: typeof entry.description === "string" ? entry.description : "",
      turns: Array.isArray(entry.turns) ? entry.turns : [],
      expectations:
        entry.expectations && typeof entry.expectations === "object"
          ? entry.expectations
          : {},
      rubricHints: Array.isArray(entry.rubricHints)
        ? entry.rubricHints.map((hint) => String(hint))
        : [],
    };
  });
}

async function runNodeProcess(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: options.verbose ? "inherit" : "pipe",
    });

    let stderr = "";
    let stdout = "";

    if (!options.verbose) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`,
          ),
        );
      }
    });
  });
}

async function writeTempCasesFile(cases) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "npc-sim-prepost-"));
  const tempPath = path.join(tempDir, "cases.json");
  await fs.writeFile(tempPath, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  return {
    tempDir,
    tempPath,
  };
}

async function runReplayEval(params) {
  const args = [
    "scripts/replay-eval-cases.mjs",
    "--cases",
    params.casesPath,
    "--base-url",
    params.baseUrl,
    "--output",
    params.outputPath,
    "--instance-prefix",
    params.instancePrefix,
  ];

  if (params.verbose) {
    args.push("--verbose");
  }

  await runNodeProcess(args, { verbose: params.verbose });
  return loadJsonOrJsonl(params.outputPath);
}

function impactTagMetrics(actualTags, expectations) {
  const allOf = Array.isArray(expectations.expectedImpactTagsAllOf)
    ? expectations.expectedImpactTagsAllOf
    : [];
  const anyOf = Array.isArray(expectations.expectedImpactTagsAnyOf)
    ? expectations.expectedImpactTagsAnyOf
    : [];

  if (!allOf.length && !anyOf.length) {
    return null;
  }

  const predicted = new Set(Array.isArray(actualTags) ? actualTags : []);
  const matchedAllOf = allOf.filter((tag) => predicted.has(tag)).length;
  const matchedAnyOf = anyOf.length > 0 && anyOf.some((tag) => predicted.has(tag)) ? 1 : 0;
  const matchedSignals = matchedAllOf + matchedAnyOf;
  const expectedSignals = allOf.length + (anyOf.length ? 1 : 0);
  const precision = predicted.size ? matchedSignals / predicted.size : 0;
  const recall = expectedSignals ? matchedSignals / expectedSignals : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision,
    recall,
    f1,
  };
}

function heuristicEvalJudge(result, benchmarkCase) {
  const actual = result.actual ?? {};
  const replyTexts = Array.isArray(actual.replyTexts) ? actual.replyTexts : [];
  const turnDetails = Array.isArray(actual.turnDetails) ? actual.turnDetails : [];
  const selectedActionReasons = Array.isArray(actual.selectedActionReasons)
    ? actual.selectedActionReasons
    : [];
  const impactRationales = Array.isArray(actual.impactRationales)
    ? actual.impactRationales
    : [];
  const reasons = [];

  let personaConsistency = 3;
  const personaCueHits = turnDetails.reduce((sum, detail, index) => {
    const cues = NPC_CUE_TERMS[detail.npcId] ?? [];
    return sum + countCueHits(replyTexts[index] ?? "", cues);
  }, 0);

  if (personaCueHits > 0) {
    personaConsistency += 1;
    reasons.push("turn replies preserve NPC-specific role or bias cues");
  }
  if (personaCueHits > turnDetails.length) {
    personaConsistency += 1;
    reasons.push("multiple turns reinforce persona consistency");
  }
  if (replyTexts.some((text) => tokenize(text).length < 8)) {
    personaConsistency -= 1;
    reasons.push("at least one reply is too thin to read as characterful");
  }

  let groundingQuality = 2;
  if ((actual.knowledgeRetrieved?.max ?? 0) >= 1) {
    groundingQuality += 1;
    reasons.push("retrieved knowledge is present during replay");
  }
  if ((actual.memoriesRetrieved?.max ?? 0) >= 1) {
    groundingQuality += 1;
    reasons.push("retrieved memories are present during replay");
  }
  if (impactRationales.some((text) => String(text).trim().length >= 24)) {
    groundingQuality += 1;
    reasons.push("impact rationales explain how evidence was used");
  }
  if (
    benchmarkCase.expectations.minKnowledgeRetrieved &&
    (actual.knowledgeRetrieved?.max ?? 0) < benchmarkCase.expectations.minKnowledgeRetrieved
  ) {
    groundingQuality -= 1;
    reasons.push("knowledge retrieval fell below benchmark expectation");
  }

  let inspectorUsefulness = 3;
  if (selectedActionReasons.every((text) => String(text).trim().length >= 12) && selectedActionReasons.length) {
    inspectorUsefulness += 1;
    reasons.push("selectedAction reasons are available for review");
  }
  if (impactRationales.every((text) => String(text).trim().length >= 20) && impactRationales.length) {
    inspectorUsefulness += 1;
    reasons.push("impact rationales are inspection-friendly");
  }
  if (turnDetails.length === benchmarkCase.turns.length && (actual.impactTags?.length ?? 0) > 0) {
    inspectorUsefulness += 1;
    reasons.push("turn details and impact tags cover the benchmark flow");
  }
  if (!selectedActionReasons.length || !impactRationales.length) {
    inspectorUsefulness -= 1;
    reasons.push("inspector-facing explanations are incomplete");
  }

  return {
    personaConsistency: scoreInt(personaConsistency),
    groundingQuality: scoreInt(groundingQuality),
    inspectorUsefulness: scoreInt(inspectorUsefulness),
    reasons: uniqueStrings(reasons).slice(0, 6),
  };
}

async function runEvalJudge(result, benchmarkCase, options) {
  const heuristic = heuristicEvalJudge(result, benchmarkCase);

  if (options.mode === "heuristic") {
    return {
      heuristic,
      llm: null,
      final: heuristic,
      llmSkipped: false,
      llmError: null,
    };
  }

  if (options.dryRun) {
    return {
      heuristic,
      llm: null,
      final: {
        ...heuristic,
        reasons: uniqueStrings([
          ...heuristic.reasons,
          "LLM eval judge skipped because --dry-run was enabled",
        ]).slice(0, 6),
      },
      llmSkipped: true,
      llmError: null,
    };
  }

  try {
    const llm = await runStructuredLlmJudge({
      provider: options.provider,
      model: options.model,
      schemaName: "prepost_eval_judge",
      jsonSchema: EVAL_JUDGE_JSON_SCHEMA,
      systemPrompt: [
        "You are scoring replayed benchmark results for a Korean NPC negotiation simulator.",
        "Score personaConsistency, groundingQuality, and inspectorUsefulness from 1 to 5.",
        "Use the benchmark intent and actual replay outputs only.",
        "Return only the requested JSON object.",
      ].join(" "),
      userPrompt: JSON.stringify(
        {
          benchmarkCase: {
            id: benchmarkCase.id,
            description: benchmarkCase.description,
            turns: benchmarkCase.turns,
            expectations: benchmarkCase.expectations,
            rubricHints: benchmarkCase.rubricHints,
          },
          actual: result.actual,
          status: result.status,
          warnings: result.warnings,
          failureReasons: result.failureReasons,
        },
        null,
        2,
      ),
    });
    const normalizedLlm = {
      personaConsistency: scoreInt(llm.personaConsistency),
      groundingQuality: scoreInt(llm.groundingQuality),
      inspectorUsefulness: scoreInt(llm.inspectorUsefulness),
      reasons: Array.isArray(llm.reasons)
        ? llm.reasons.map((reason) => String(reason)).slice(0, 6)
        : ["LLM eval judge did not provide reasons"],
    };

    if (options.mode === "llm") {
      return {
        heuristic,
        llm: normalizedLlm,
        final: normalizedLlm,
        llmSkipped: false,
        llmError: null,
      };
    }

    return {
      heuristic,
      llm: normalizedLlm,
      final: {
        personaConsistency: scoreInt(
          (heuristic.personaConsistency + normalizedLlm.personaConsistency) / 2,
        ),
        groundingQuality: scoreInt(
          (heuristic.groundingQuality + normalizedLlm.groundingQuality) / 2,
        ),
        inspectorUsefulness: scoreInt(
          (heuristic.inspectorUsefulness + normalizedLlm.inspectorUsefulness) / 2,
        ),
        reasons: uniqueStrings([
          ...heuristic.reasons,
          ...normalizedLlm.reasons,
        ]).slice(0, 6),
      },
      llmSkipped: false,
      llmError: null,
    };
  } catch (error) {
    return {
      heuristic,
      llm: null,
      final: {
        ...heuristic,
        reasons: uniqueStrings([
          ...heuristic.reasons,
          `LLM eval judge failed: ${error instanceof Error ? error.message : String(error)}`,
        ]).slice(0, 6),
      },
      llmSkipped: false,
      llmError: error instanceof Error ? error.message : String(error),
    };
  }
}

function sanitizePairwiseReplyJudgeResult(raw) {
  return {
    pre: {
      naturalness: scoreInt(raw?.pre?.naturalness ?? 0),
      personaFit: scoreInt(raw?.pre?.personaFit ?? 0),
      antiMeta: scoreInt(raw?.pre?.antiMeta ?? 0),
    },
    post: {
      naturalness: scoreInt(raw?.post?.naturalness ?? 0),
      personaFit: scoreInt(raw?.post?.personaFit ?? 0),
      antiMeta: scoreInt(raw?.post?.antiMeta ?? 0),
    },
    winner:
      raw?.winner === "pre" || raw?.winner === "post" || raw?.winner === "tie"
        ? raw.winner
        : "tie",
    confidence: scoreInt(raw?.confidence ?? 3),
    reasons: Array.isArray(raw?.reasons)
      ? raw.reasons.map((reason) => String(reason)).slice(0, 6)
      : ["LLM pairwise judge did not provide reasons"],
  };
}

function buildPairwiseReplyJudgePrompts(benchmarkCase, preResult, postResult, labels) {
  const selectActual = (result) => ({
    targetNpcId: result.actual?.targetNpcId ?? null,
    impactTags: Array.isArray(result.actual?.impactTags)
      ? result.actual.impactTags
      : [],
    replyTexts: Array.isArray(result.actual?.replyTexts)
      ? result.actual.replyTexts
      : [],
    selectedActionReasons: Array.isArray(result.actual?.selectedActionReasons)
      ? result.actual.selectedActionReasons
      : [],
    impactRationales: Array.isArray(result.actual?.impactRationales)
      ? result.actual.impactRationales
      : [],
    turnDetails: Array.isArray(result.actual?.turnDetails)
      ? result.actual.turnDetails.map((detail) => ({
          npcId: detail?.npcId ?? null,
          targetNpcId: detail?.targetNpcId ?? null,
          inputMode: detail?.inputMode ?? null,
          playerText: detail?.playerText ?? null,
        }))
      : [],
  });

  return {
    systemPrompt: [
      "You are comparing two Korean NPC negotiation replay outputs for the same benchmark case.",
      "Judge reply sentence quality only.",
      "Prioritize natural spoken Korean, strong NPC persona fit, and direct in-scene dialogue.",
      "Penalize meta or report-like wording such as '의무실 기록에 따르면', '판단 기준', '검토하십시오', '기록으로 명확히', labels, headings, bullet-list tone, or out-of-scene narration.",
      "Score each side from 1 to 5 on naturalness, personaFit, and antiMeta where 5 is better.",
      "Choose winner pre, post, or tie.",
      "Return only the requested JSON object.",
    ].join(" "),
    userPrompt: JSON.stringify(
      {
        benchmarkCase: {
          id: benchmarkCase.id,
          description: benchmarkCase.description,
          turns: benchmarkCase.turns,
          expectations: benchmarkCase.expectations,
          rubricHints: benchmarkCase.rubricHints,
        },
        labels,
        pre: {
          status: preResult.status,
          warnings: preResult.warnings,
          failureReasons: preResult.failureReasons,
          actual: selectActual(preResult),
        },
        post: {
          status: postResult.status,
          warnings: postResult.warnings,
          failureReasons: postResult.failureReasons,
          actual: selectActual(postResult),
        },
      },
      null,
      2,
    ),
  };
}

async function runPairwiseReplyJudge(benchmarkCase, preResult, postResult, options) {
  if (options.mode !== "llm") {
    return {
      enabled: false,
      skipped: true,
      final: null,
      error: null,
    };
  }

  if (options.dryRun) {
    return {
      enabled: true,
      skipped: true,
      final: {
        pre: {
          naturalness: 3,
          personaFit: 3,
          antiMeta: 3,
        },
        post: {
          naturalness: 3,
          personaFit: 3,
          antiMeta: 3,
        },
        winner: "tie",
        confidence: 1,
        reasons: ["Pairwise reply judge skipped because --dry-run was enabled"],
      },
      error: null,
    };
  }

  try {
    const prompts = buildPairwiseReplyJudgePrompts(
      benchmarkCase,
      preResult,
      postResult,
      {
        pre: options.preLabel,
        post: options.postLabel,
      },
    );
    const raw = await runStructuredLlmJudge({
      provider: options.provider,
      model: options.model,
      schemaName: "prepost_pairwise_reply_judge",
      jsonSchema: PAIRWISE_REPLY_JUDGE_JSON_SCHEMA,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
    });

    return {
      enabled: true,
      skipped: false,
      final: sanitizePairwiseReplyJudgeResult(raw),
      error: null,
    };
  } catch (error) {
    return {
      enabled: true,
      skipped: false,
      final: {
        pre: {
          naturalness: 3,
          personaFit: 3,
          antiMeta: 3,
        },
        post: {
          naturalness: 3,
          personaFit: 3,
          antiMeta: 3,
        },
        winner: "tie",
        confidence: 1,
        reasons: [
          `Pairwise reply judge failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function summarizePairwiseReplyJudge(
  cases,
  preResults,
  postResults,
  options,
) {
  if (options.mode !== "llm") {
    return {
      enabled: false,
      mode: "off",
      provider: options.provider,
      model: options.model ?? null,
      totalCompared: 0,
      winnerCounts: {
        pre: 0,
        post: 0,
        tie: 0,
      },
      avgPreNaturalness: 0,
      avgPostNaturalness: 0,
      avgPrePersonaFit: 0,
      avgPostPersonaFit: 0,
      avgPreAntiMeta: 0,
      avgPostAntiMeta: 0,
      avgConfidence: 0,
      comparisons: [],
    };
  }

  const preById = new Map(preResults.map((entry) => [entry.caseId, entry]));
  const postById = new Map(postResults.map((entry) => [entry.caseId, entry]));
  const comparisons = [];

  for (const benchmarkCase of cases) {
    const preResult = preById.get(benchmarkCase.id);
    const postResult = postById.get(benchmarkCase.id);

    if (!preResult || !postResult) {
      comparisons.push({
        caseId: benchmarkCase.id,
        missing: true,
        judge: null,
      });
      continue;
    }

    const judge = await runPairwiseReplyJudge(
      benchmarkCase,
      preResult,
      postResult,
      options,
    );

    comparisons.push({
      caseId: benchmarkCase.id,
      missing: false,
      judge,
    });
  }

  const completed = comparisons
    .map((entry) => entry.judge?.final)
    .filter(Boolean);
  const winnerCounts = {
    pre: completed.filter((entry) => entry.winner === "pre").length,
    post: completed.filter((entry) => entry.winner === "post").length,
    tie: completed.filter((entry) => entry.winner === "tie").length,
  };

  return {
    enabled: true,
    mode: options.mode,
    provider: options.provider,
    model: options.model ?? null,
    totalCompared: completed.length,
    winnerCounts,
    avgPreNaturalness: average(completed.map((entry) => entry.pre.naturalness), 2),
    avgPostNaturalness: average(completed.map((entry) => entry.post.naturalness), 2),
    avgPrePersonaFit: average(completed.map((entry) => entry.pre.personaFit), 2),
    avgPostPersonaFit: average(completed.map((entry) => entry.post.personaFit), 2),
    avgPreAntiMeta: average(completed.map((entry) => entry.pre.antiMeta), 2),
    avgPostAntiMeta: average(completed.map((entry) => entry.post.antiMeta), 2),
    avgConfidence: average(completed.map((entry) => entry.confidence), 2),
    comparisons: comparisons.map((entry) => ({
      caseId: entry.caseId,
      missing: entry.missing,
      winner: entry.judge?.final?.winner ?? null,
      confidence: entry.judge?.final?.confidence ?? null,
      pre: entry.judge?.final?.pre ?? null,
      post: entry.judge?.final?.post ?? null,
      reasons: entry.judge?.final?.reasons ?? [],
      error: entry.judge?.error ?? null,
      skipped: entry.judge?.skipped ?? false,
    })),
  };
}

async function summarizeRun(label, results, casesById, judgeOptions) {
  const caseMetrics = [];

  for (const result of results) {
    const benchmarkCase = casesById.get(result.caseId);
    if (!benchmarkCase) {
      continue;
    }

    const tagMetrics = impactTagMetrics(
      result.actual?.impactTags ?? [],
      benchmarkCase.expectations,
    );
    const evalJudge = await runEvalJudge(result, benchmarkCase, judgeOptions);
    caseMetrics.push({
      caseId: result.caseId,
      status: result.status,
      targetNpcIdMatch:
        benchmarkCase.expectations.expectedTargetNpcId
          ? Number(result.actual?.targetNpcId === benchmarkCase.expectations.expectedTargetNpcId)
          : null,
      freeTextPressureMoved:
        benchmarkCase.turns.some((turn) => turn.inputMode === "free_text")
          ? Number((result.actual?.pressureMovement?.total ?? 0) > 0)
          : null,
      impactTagPrecision: tagMetrics ? tagMetrics.precision : null,
      impactTagRecall: tagMetrics ? tagMetrics.recall : null,
      impactTagF1: tagMetrics ? tagMetrics.f1 : null,
      personaConsistency: evalJudge.final.personaConsistency,
      groundingQuality: evalJudge.final.groundingQuality,
      inspectorUsefulness: evalJudge.final.inspectorUsefulness,
      judge: evalJudge,
      finalRound: result.actual?.finalRound ?? null,
      resolved: Boolean(result.actual?.resolved),
    });
  }

  const freeTextCases = caseMetrics
    .map((metric) => metric.freeTextPressureMoved)
    .filter((value) => value !== null);
  const targetCases = caseMetrics
    .map((metric) => metric.targetNpcIdMatch)
    .filter((value) => value !== null);
  const precisionValues = caseMetrics
    .map((metric) => metric.impactTagPrecision)
    .filter((value) => value !== null);
  const recallValues = caseMetrics
    .map((metric) => metric.impactTagRecall)
    .filter((value) => value !== null);
  const f1Values = caseMetrics
    .map((metric) => metric.impactTagF1)
    .filter((value) => value !== null);

  return {
    label,
    totalCases: caseMetrics.length,
    passRate: average(
      caseMetrics.map((metric) => Number(metric.status === "pass")),
    ),
    freeTextPressureMovementRate: average(freeTextCases),
    impactTagPrecision: average(precisionValues),
    impactTagRecall: average(recallValues),
    impactTagF1: average(f1Values),
    targetNpcIdAccuracy: average(targetCases),
    avgPersonaConsistencyScore: average(
      caseMetrics.map((metric) => metric.personaConsistency),
      2,
    ),
    avgGroundingQualityScore: average(
      caseMetrics.map((metric) => metric.groundingQuality),
      2,
    ),
    avgInspectorUsefulnessScore: average(
      caseMetrics.map((metric) => metric.inspectorUsefulness),
      2,
    ),
    caseMetrics,
  };
}

function buildDelta(preMetrics, postMetrics) {
  const keys = [
    "freeTextPressureMovementRate",
    "impactTagPrecision",
    "impactTagRecall",
    "impactTagF1",
    "targetNpcIdAccuracy",
    "avgPersonaConsistencyScore",
    "avgGroundingQualityScore",
    "avgInspectorUsefulnessScore",
    "passRate",
  ];

  return Object.fromEntries(
    keys.map((key) => [
      key,
      Number((postMetrics[key] - preMetrics[key]).toFixed(4)),
    ]),
  );
}

function buildReport(summary) {
  const metricRows = [
    ["Pass Rate", summary.pre.passRate, summary.post.passRate, summary.delta.passRate],
    [
      "Free-text Pressure Movement",
      summary.pre.freeTextPressureMovementRate,
      summary.post.freeTextPressureMovementRate,
      summary.delta.freeTextPressureMovementRate,
    ],
    [
      "Impact Tag Precision",
      summary.pre.impactTagPrecision,
      summary.post.impactTagPrecision,
      summary.delta.impactTagPrecision,
    ],
    [
      "Impact Tag Recall",
      summary.pre.impactTagRecall,
      summary.post.impactTagRecall,
      summary.delta.impactTagRecall,
    ],
    ["Impact Tag F1", summary.pre.impactTagF1, summary.post.impactTagF1, summary.delta.impactTagF1],
    [
      "Target NPC Accuracy",
      summary.pre.targetNpcIdAccuracy,
      summary.post.targetNpcIdAccuracy,
      summary.delta.targetNpcIdAccuracy,
    ],
    [
      "Persona Consistency",
      summary.pre.avgPersonaConsistencyScore,
      summary.post.avgPersonaConsistencyScore,
      summary.delta.avgPersonaConsistencyScore,
    ],
    [
      "Grounding Quality",
      summary.pre.avgGroundingQualityScore,
      summary.post.avgGroundingQualityScore,
      summary.delta.avgGroundingQualityScore,
    ],
    [
      "Inspector Usefulness",
      summary.pre.avgInspectorUsefulnessScore,
      summary.post.avgInspectorUsefulnessScore,
      summary.delta.avgInspectorUsefulnessScore,
    ],
  ];
  const caseRows = summary.caseComparisons
    .map(
      (entry) =>
        `| ${entry.caseId} | ${entry.preStatus} | ${entry.postStatus} | ${entry.preTargetMatch ?? "-"} | ${entry.postTargetMatch ?? "-"} | ${entry.preImpactF1 ?? "-"} | ${entry.postImpactF1 ?? "-"} | ${entry.pairwiseWinner ?? "-"} | ${entry.pairwiseConfidence ?? "-"} |`,
    )
    .join("\n");
  const pairwiseSection = summary.pairwiseReplyJudge?.enabled
    ? [
        "## Pairwise Reply Judge",
        "",
        `- Mode: ${summary.pairwiseReplyJudge.mode}`,
        `- Provider: ${summary.pairwiseReplyJudge.provider}`,
        `- Model: ${summary.pairwiseReplyJudge.model ?? "default"}`,
        `- Compared cases: ${summary.pairwiseReplyJudge.totalCompared}`,
        `- Winner counts: pre=${summary.pairwiseReplyJudge.winnerCounts.pre}, post=${summary.pairwiseReplyJudge.winnerCounts.post}, tie=${summary.pairwiseReplyJudge.winnerCounts.tie}`,
        "",
        "| Axis | Pre Avg | Post Avg |",
        "| --- | ---: | ---: |",
        `| Naturalness | ${summary.pairwiseReplyJudge.avgPreNaturalness} | ${summary.pairwiseReplyJudge.avgPostNaturalness} |`,
        `| Persona Fit | ${summary.pairwiseReplyJudge.avgPrePersonaFit} | ${summary.pairwiseReplyJudge.avgPostPersonaFit} |`,
        `| Anti-Meta | ${summary.pairwiseReplyJudge.avgPreAntiMeta} | ${summary.pairwiseReplyJudge.avgPostAntiMeta} |`,
        `| Confidence | ${summary.pairwiseReplyJudge.avgConfidence} | ${summary.pairwiseReplyJudge.avgConfidence} |`,
        "",
      ]
    : [];

  return [
    "# Pre/Post Eval Report",
    "",
    `- Generated at: ${summary.generatedAt}`,
    `- Benchmark: ${summary.casesPath}`,
    `- Pre label: ${summary.pre.label}`,
    `- Post label: ${summary.post.label}`,
    `- Judge mode: ${summary.judgeMode}`,
    `- Pairwise judge mode: ${summary.pairwiseJudgeMode}`,
    "",
    "## Metric Summary",
    "",
    "| Metric | Pre | Post | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...metricRows.map(
      ([label, pre, post, delta]) => `| ${label} | ${pre} | ${post} | ${delta} |`,
    ),
    "",
    ...pairwiseSection,
    "## Case Summary",
    "",
    "| Case | Pre Status | Post Status | Pre Target Match | Post Target Match | Pre Impact F1 | Post Impact F1 | Pairwise Winner | Pairwise Confidence |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |",
    caseRows,
    "",
  ].join("\n");
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const casesPath = getStringOption(
    options,
    "cases",
    "scripts/eval-cases/prepost-benchmark.json",
  );
  const preBaseUrl = getStringOption(options, "pre-base-url", "http://localhost:3000");
  const postBaseUrl = getStringOption(options, "post-base-url", "http://localhost:3000");
  const preInput = getStringOption(options, "pre-input", null);
  const postInput = getStringOption(options, "post-input", null);
  const preLabel = getStringOption(options, "pre-label", "baseline");
  const postLabel = getStringOption(options, "post-label", "candidate");
  const outputDir = getStringOption(options, "output-dir", "data/evals/prepost");
  const limit = getNumberOption(options, "limit", null);
  const judgeMode = getStringOption(options, "judge-mode", "heuristic");
  const provider = getStringOption(options, "provider", "codex");
  const judgeModel = getStringOption(options, "judge-model", null);
  const pairwiseJudgeMode = getStringOption(options, "pairwise-judge-mode", "off");
  const dryRun = Boolean(options["dry-run"]);
  const verbose = Boolean(options.verbose);

  if (!["heuristic", "llm", "hybrid"].includes(judgeMode)) {
    throw new Error("--judge-mode must be one of heuristic, llm, hybrid");
  }

  if (!["codex", "openai"].includes(provider)) {
    throw new Error("--provider must be one of codex, openai");
  }

  if (!["off", "llm"].includes(pairwiseJudgeMode)) {
    throw new Error("--pairwise-judge-mode must be one of off, llm");
  }

  const rawCases = await loadJsonOrJsonl(casesPath);
  const cases = normalizeCases(rawCases, casesPath);
  const limitedCases = limit ? cases.slice(0, limit) : cases;
  const casesById = new Map(limitedCases.map((entry) => [entry.id, entry]));
  const preRunPath = path.join(outputDir, "pre-run.jsonl");
  const postRunPath = path.join(outputDir, "post-run.jsonl");
  const compareSummaryPath = path.join(outputDir, "compare-summary.json");
  const compareReportPath = path.join(outputDir, "compare-report.md");

  let tempCaseFile = null;
  let preResults;
  let postResults;

  try {
    if (!preInput || !postInput) {
      if (dryRun) {
        const placeholder = limitedCases.map((benchmarkCase) => ({
          caseId: benchmarkCase.id,
          description: benchmarkCase.description,
          status: "dry-run",
          actual: {
            targetNpcId: null,
            impactTags: [],
            pressureMovement: {
              total: 0,
            },
            knowledgeRetrieved: {
              max: 0,
              total: 0,
            },
            memoriesRetrieved: {
              max: 0,
              total: 0,
            },
            selectedActionReasons: [],
            impactRationales: [],
            replyTexts: [],
            turnDetails: [],
          },
          expectations: benchmarkCase.expectations,
          warnings: ["live replay skipped because --dry-run was enabled"],
          failureReasons: [],
        }));
        preResults = placeholder;
        postResults = placeholder;
      } else {
        const { tempDir, tempPath } = await writeTempCasesFile(limitedCases);
        tempCaseFile = tempDir;
        preResults = await runReplayEval({
          baseUrl: preBaseUrl,
          casesPath: tempPath,
          outputPath: preRunPath,
          instancePrefix: "pre-benchmark",
          verbose,
        });
        postResults = await runReplayEval({
          baseUrl: postBaseUrl,
          casesPath: tempPath,
          outputPath: postRunPath,
          instancePrefix: "post-benchmark",
          verbose,
        });
      }
    }

    if (preInput) {
      const loaded = await loadJsonOrJsonl(preInput);
      preResults = Array.isArray(loaded) ? loaded : [];
    }

    if (postInput) {
      const loaded = await loadJsonOrJsonl(postInput);
      postResults = Array.isArray(loaded) ? loaded : [];
    }

    preResults = (preResults ?? []).filter((entry) => casesById.has(entry.caseId));
    postResults = (postResults ?? []).filter((entry) => casesById.has(entry.caseId));

    await writeJsonLines(preRunPath, preResults);
    await writeJsonLines(postRunPath, postResults);

    const preSummary = await summarizeRun(preLabel, preResults, casesById, {
      mode: judgeMode,
      provider,
      model: judgeModel,
      dryRun,
    });
    const postSummary = await summarizeRun(postLabel, postResults, casesById, {
      mode: judgeMode,
      provider,
      model: judgeModel,
      dryRun,
    });
    const pairwiseReplyJudge = await summarizePairwiseReplyJudge(
      limitedCases,
      preResults,
      postResults,
      {
        mode: pairwiseJudgeMode,
        provider,
        model: judgeModel,
        dryRun,
        preLabel,
        postLabel,
      },
    );
    const summary = {
      generatedAt: new Date().toISOString(),
      casesPath,
      judgeMode,
      pairwiseJudgeMode,
      provider,
      judgeModel,
      dryRun,
      pre: preSummary,
      post: postSummary,
      pairwiseReplyJudge,
      delta: buildDelta(preSummary, postSummary),
      caseComparisons: limitedCases.map((benchmarkCase) => {
        const preMetric = preSummary.caseMetrics.find(
          (entry) => entry.caseId === benchmarkCase.id,
        );
        const postMetric = postSummary.caseMetrics.find(
          (entry) => entry.caseId === benchmarkCase.id,
        );
        const pairwiseMetric = pairwiseReplyJudge.comparisons.find(
          (entry) => entry.caseId === benchmarkCase.id,
        );
        return {
          caseId: benchmarkCase.id,
          preStatus: preMetric?.status ?? "missing",
          postStatus: postMetric?.status ?? "missing",
          preTargetMatch: preMetric?.targetNpcIdMatch ?? null,
          postTargetMatch: postMetric?.targetNpcIdMatch ?? null,
          preImpactF1: preMetric?.impactTagF1 ?? null,
          postImpactF1: postMetric?.impactTagF1 ?? null,
          pairwiseWinner: pairwiseMetric?.winner ?? null,
          pairwiseConfidence: pairwiseMetric?.confidence ?? null,
        };
      }),
      outputFiles: {
        preRun: preRunPath,
        postRun: postRunPath,
        compareSummary: compareSummaryPath,
        compareReport: compareReportPath,
      },
    };
    const report = buildReport(summary);

    await writeJsonFile(compareSummaryPath, summary);
    await fs.mkdir(path.dirname(compareReportPath), { recursive: true });
    await fs.writeFile(compareReportPath, report, "utf8");

    console.log(
      [
        `cases=${limitedCases.length}`,
        `pre=${preRunPath}`,
        `post=${postRunPath}`,
        `summary=${compareSummaryPath}`,
      ].join(" "),
    );
  } finally {
    if (tempCaseFile) {
      await fs.rm(tempCaseFile, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
