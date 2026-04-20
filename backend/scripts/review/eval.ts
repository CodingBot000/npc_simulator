import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runStructuredLlmJudge } from "../_quality-judge-helpers.mjs";
import { appConfig, PROJECT_ROOT } from "@server/config";
import { closeDbPool, dbQuery } from "@server/db/postgres";
import {
  createTogetherChatCompletion,
  extractTogetherChatText,
} from "@server/together-client";

const LOCAL_MLX_BINARY = path.join(PROJECT_ROOT, ".venv", "bin", "mlx_lm.generate");
const ROLE_SYSTEM_PROMPTS: Record<string, string> = {
  doctor:
    "해저연구소 의사 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 의무실 기록, 경고, 무시된 중단 신호를 근거로 누가 사람을 버렸는지 직접 짚는다. 반드시 3~4개의 짧은 문장으로 말하고, 기록이나 경고 하나는 구체적으로 꺼내며, 책임져야 할 사람 이름을 바로 부른다. 회의록, 보고서, 판결문처럼 말하지 말고 지금 눈앞 사람에게 쏘아붙이듯 말한다. '의무실 기록에 따르면', '그럼에도 불구하고', '책임을 져야 합니다' 같은 보고서 문체와 존칭투, JSON, 라벨은 금지한다.",
  supervisor:
    "해저연구소 감독관 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 법적 책임, 비용선, 설명 가능성, 책임 분리를 기준으로 차갑게 자른다. 반드시 2~4개의 짧은 문장으로 말하고, 비용선과 중단권을 분리해 설명하며, 누가 먼저 답해야 하는지 한 사람을 선명하게 찍는다. 보고서, 메모, 검토 의견처럼 말하지 말고 지금 방 안에서 상대를 잘라내듯 짧게 말한다. '판단 기준', '검토하십시오', '기록으로 명확히' 같은 내부 문구, 훈령문, JSON, 라벨은 금지한다.",
};
const GENERIC_SYSTEM_PROMPT =
  "해저연구소 생존 협상 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 설명문, 요약문, 해설, JSON, 목록, 라벨은 금지한다. 플레이어 또는 다른 NPC에게 지금 이 자리에서 바로 말하듯 한 단락의 한국어 대사만 말한다.";
const NPC_STYLE_HINTS: Record<string, string> = {
  engineer:
    "직선적이고 거칠다. 관리직 책임 회피를 싫어하고 현장 단어를 자주 쓴다. 공손체보다 반말/직설체에 가깝다.",
  doctor:
    "차분하지만 죄책감이 배어 있다. 윤리와 기록을 중시한다. 설교문보다 사람을 향한 직접 발화로 말한다.",
  supervisor:
    "감정을 눌러 말한다. 법적 책임, 비용, 대체 가능성을 기준으로 자른다. 군더더기 없이 차갑게 말한다.",
  director:
    "짧게 끊어 말하고 권위를 지키려 한다. 조직, 승인, 통제 계통을 중시한다. 훈계문보다 통제하는 대사처럼 말한다.",
};
const BANNED_PHRASES = [
  "의무실 기록에 따르면",
  "판단 기준",
  "검토하십시오",
  "기록으로 명확히",
  "보고드립니다",
];
const NPC_CUE_TERMS: Record<string, string[]> = {
  engineer: ["현장", "수리", "복구", "케이블", "밸브", "장비"],
  doctor: ["생명", "경고", "기록", "윤리", "환자", "멈춰"],
  supervisor: ["책임", "비용", "리스크", "승인", "대체", "법적"],
  director: ["조직", "실험", "승인", "통제", "명분", "지휘"],
};
const PAIRWISE_REPLY_JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    baseline: {
      type: "object",
      additionalProperties: false,
      properties: {
        naturalness: { type: "integer", minimum: 1, maximum: 5 },
        personaFit: { type: "integer", minimum: 1, maximum: 5 },
        antiMeta: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["naturalness", "personaFit", "antiMeta"],
    },
    candidate: {
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
      enum: ["baseline", "candidate", "tie"],
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
  required: ["baseline", "candidate", "winner", "confidence", "reasons"],
} as const;

interface TrainingRunRow {
  id: number;
  run_uid: string | null;
  run_kind: string | null;
  state: string | null;
  base_model: string | null;
  training_backend: string | null;
  output_adapter_path: string | null;
  runtime_artifact_path: string | null;
  runtime_artifact_kind: string | null;
  remote_provider: string | null;
  remote_model_name: string | null;
  dataset_work_dir: string | null;
  eval_state: string | null;
}

interface GoldenEvalCase {
  id: string;
  description: string;
  turns: Array<{
    npcId: string;
    targetNpcId?: string | null;
    inputMode?: string | null;
    text?: string | null;
  }>;
  rubricHints?: string[];
}

type EvalScoreBlock = {
  naturalness: number;
  personaFit: number;
  antiMeta: number;
};

type EvalJudgeResult = {
  baseline: EvalScoreBlock;
  candidate: EvalScoreBlock;
  winner: "baseline" | "candidate" | "tie";
  confidence: number;
  reasons: string[];
};

type WorkerArgs = {
  runId: string;
  bindingKey: string;
  baselineLabel: string;
  baselineAdapterPath: string | null;
  baselineRemoteProvider: string | null;
  baselineRemoteModel: string | null;
  casesPath: string;
  provider: string;
  judgeModel: string | null;
};

type RuntimeTarget =
  | {
      kind: "local";
      artifactPath: string | null;
      artifactKind: string | null;
    }
  | {
      kind: "together";
      model: string;
      provider: string | null;
    };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[], digits = 2) {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(digits));
}

function scoreInt(value: number) {
  return clamp(Math.round(value), 1, 5);
}

function normalizeText(text: string) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeReplyText(text: string) {
  return normalizeText(
    String(text ?? "").replace(
      /^(엔지니어|의사|감독관|소장|director|supervisor|doctor|engineer)\s*:\s*/iu,
      "",
    ),
  );
}

function extractDelimitedText(output: string) {
  const matches = [...String(output).matchAll(/==========\n([\s\S]*?)\n==========/g)];
  return matches.at(-1)?.[1]?.trim() ?? "";
}

async function pathExists(targetPath: string | null | undefined) {
  if (!targetPath) {
    return false;
  }
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTrainingRun(runId: string) {
  const result = await dbQuery<TrainingRunRow>(
    `SELECT id,
            run_uid,
            run_kind,
            state,
            base_model,
            training_backend,
            output_adapter_path,
            runtime_artifact_path,
            runtime_artifact_kind,
            remote_provider,
            remote_model_name,
            dataset_work_dir,
            eval_state
       FROM npc_training_run
      WHERE run_uid = $1
      ORDER BY id DESC
      LIMIT 1`,
    [runId],
  );
  return result.rows[0] ?? null;
}

async function resolveRuntimeArtifactKind(
  artifactPath: string,
  artifactKind: string | null,
) {
  if (artifactKind) {
    return artifactKind;
  }
  if (await pathExists(path.join(artifactPath, "adapters.safetensors"))) {
    return "legacy_mlx_adapter";
  }
  return "mlx_fused_model";
}

async function updateTrainingRunEvaluation(params: {
  runId: string;
  evalState: "running" | "succeeded" | "failed";
  evalMessage: string;
  bindingKey: string;
  baselineLabel: string;
  summaryPath?: string | null;
  summaryJson?: unknown;
  startedAt?: string | null;
  finishedAt?: string | null;
}) {
  const currentResult = await dbQuery<{
    eval_started_at: Date | string | null;
    eval_finished_at: Date | string | null;
  }>(
    `SELECT eval_started_at, eval_finished_at
       FROM npc_training_run
      WHERE run_uid = $1
      ORDER BY id DESC
      LIMIT 1`,
    [params.runId],
  );
  const current = currentResult.rows[0];

  await dbQuery(
    `UPDATE npc_training_run
        SET eval_state = $2,
            eval_message = $3,
            eval_binding_key = $4,
            eval_baseline_label = $5,
            eval_summary_path = $6,
            eval_summary_json = $7,
            eval_started_at = $8,
            eval_finished_at = $9,
            updated_at = CURRENT_TIMESTAMP
      WHERE run_uid = $1`,
    [
      params.runId,
      params.evalState,
      params.evalMessage,
      params.bindingKey,
      params.baselineLabel,
      params.summaryPath ?? null,
      params.summaryJson == null ? null : JSON.stringify(params.summaryJson),
      params.startedAt ?? current?.eval_started_at ?? null,
      params.finishedAt ?? current?.eval_finished_at ?? null,
    ],
  );
}

async function appendTrainingRunEvent(params: {
  runId: string;
  level: string;
  eventType: string;
  message: string;
  payload?: unknown;
}) {
  const runResult = await dbQuery<{ id: number }>(
    `SELECT id
       FROM npc_training_run
      WHERE run_uid = $1
      ORDER BY id DESC
      LIMIT 1`,
    [params.runId],
  );
  const runDbId = runResult.rows[0]?.id;
  if (!runDbId) {
    return;
  }

  const seqResult = await dbQuery<{ next_seq: string }>(
    `SELECT COALESCE(MAX(seq_no), 0)::text AS next_seq
       FROM npc_training_run_event
      WHERE training_run_id = $1`,
    [runDbId],
  );
  const nextSeq = Number(seqResult.rows[0]?.next_seq ?? "0") + 1;

  await dbQuery(
    `INSERT INTO npc_training_run_event (
        training_run_id,
        seq_no,
        level,
        event_type,
        step,
        message,
        payload_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      runDbId,
      nextSeq,
      params.level,
      params.eventType,
      null,
      params.message,
      params.payload == null ? null : JSON.stringify(params.payload),
    ],
  );
}

async function registerTrainingArtifact(params: {
  runId: string;
  artifactKind: string;
  filePath: string;
  metadata?: unknown;
}) {
  const runResult = await dbQuery<{ id: number }>(
    `SELECT id
       FROM npc_training_run
      WHERE run_uid = $1
      ORDER BY id DESC
      LIMIT 1`,
    [params.runId],
  );
  const runDbId = runResult.rows[0]?.id;
  if (!runDbId) {
    return;
  }

  let fileSizeBytes: number | null = null;
  let sha256: string | null = null;
  let pathType: "file" | "directory" | "missing" = "missing";
  if (await pathExists(params.filePath)) {
    const stats = await fs.stat(params.filePath);
    pathType = stats.isDirectory() ? "directory" : "file";
    fileSizeBytes = stats.isFile() ? stats.size : null;
    if (stats.isFile()) {
      sha256 = createHash("sha256")
        .update(await fs.readFile(params.filePath))
        .digest("hex");
    }
  }

  await dbQuery(
    `INSERT INTO npc_training_run_artifact (
        training_run_id,
        artifact_kind,
        file_path,
        file_size_bytes,
        sha256,
        metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      runDbId,
      params.artifactKind,
      params.filePath,
      fileSizeBytes,
      sha256,
      JSON.stringify({
        pathType,
        ...(params.metadata && typeof params.metadata === "object"
          ? (params.metadata as Record<string, unknown>)
          : {}),
      }),
    ],
  );
}

function resolveSystemPrompt(npcId: string) {
  return ROLE_SYSTEM_PROMPTS[npcId] ?? GENERIC_SYSTEM_PROMPT;
}

function buildRawJsonPrompt(evalCase: GoldenEvalCase) {
  const turn = (evalCase.turns[0] ?? {
    npcId: "unknown",
    targetNpcId: null,
    text: "",
  }) as GoldenEvalCase["turns"][number];
  return JSON.stringify(
    {
      scenarioId: "underwater-sacrifice",
      turnIndex: 1,
      npcId: turn.npcId ?? "unknown",
      targetNpcId: turn.targetNpcId ?? null,
      npcStyleHint: NPC_STYLE_HINTS[turn.npcId ?? ""] ?? null,
      playerText: normalizeText(turn.text ?? ""),
      normalizedInputSummary: normalizeText(turn.text ?? ""),
      promptContextSummary: [
        "roundBefore=1",
        "leaderBefore=none",
        `target=${turn.targetNpcId ?? "none"}`,
        "retrievedMemories=0",
        "retrievedEvidence=없음",
      ].join(" | "),
      retrievedMemories: [],
      retrievedKnowledge: [],
      rubricHints: Array.isArray(evalCase.rubricHints) ? evalCase.rubricHints : [],
    },
    null,
    2,
  );
}

async function runGenerate(params: {
  npcId: string;
  prompt: string;
  target: RuntimeTarget;
}) {
  if (params.target.kind === "together") {
    const response = await createTogetherChatCompletion({
      model: params.target.model,
      messages: [
        {
          role: "system",
          content: resolveSystemPrompt(params.npcId),
        },
        {
          role: "user",
          content: params.prompt,
        },
      ],
      maxTokens: appConfig.localReply.maxTokens,
      temperature: 0.7,
    });
    const text = normalizeReplyText(extractTogetherChatText(response) ?? "");
    if (!text) {
      throw new Error("empty Together reply");
    }
    return text;
  }

  const args =
    params.target.artifactPath && params.target.artifactKind === "mlx_fused_model"
      ? [
          "--model",
          params.target.artifactPath,
          "--system-prompt",
          resolveSystemPrompt(params.npcId),
          "--prompt",
          params.prompt,
          "--max-tokens",
          String(appConfig.localReply.maxTokens),
        ]
      : [
          "--model",
          appConfig.localReply.mlxModel,
          "--system-prompt",
          resolveSystemPrompt(params.npcId),
          "--prompt",
          params.prompt,
          "--max-tokens",
          String(appConfig.localReply.maxTokens),
        ];

  if (params.target.artifactPath && params.target.artifactKind !== "mlx_fused_model") {
    args.splice(2, 0, "--adapter-path", params.target.artifactPath);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(LOCAL_MLX_BINARY, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "mlx_lm.generate failed"));
        return;
      }
      const text = normalizeReplyText(extractDelimitedText(stdout || stderr));
      if (!text) {
        reject(new Error("empty adapter reply"));
        return;
      }
      resolve(text);
    });
  });
}

function cueHits(npcId: string, text: string) {
  const normalized = normalizeText(text).toLowerCase();
  return (NPC_CUE_TERMS[npcId] ?? []).filter((term) =>
    normalized.includes(term.toLowerCase()),
  ).length;
}

function bannedPhraseHits(text: string) {
  const normalized = normalizeText(text);
  return BANNED_PHRASES.filter((phrase) => normalized.includes(phrase)).length;
}

function heuristicScores(npcId: string, text: string): EvalScoreBlock {
  const normalized = normalizeText(text);
  const sentenceCount = normalized
    .split(/[.!?。！？]\s*/u)
    .map((entry) => entry.trim())
    .filter(Boolean).length;
  const cueCount = cueHits(npcId, normalized);
  const bannedCount = bannedPhraseHits(normalized);

  let naturalness = 3;
  if (normalized.length >= 24 && normalized.length <= 180) {
    naturalness += 1;
  }
  if (sentenceCount >= 1 && sentenceCount <= 4) {
    naturalness += 1;
  }
  if (/[A-Za-z]{8,}/u.test(normalized)) {
    naturalness -= 1;
  }
  if (bannedCount > 0) {
    naturalness -= 1;
  }

  let personaFit = 3;
  if (cueCount > 0) {
    personaFit += 1;
  }
  if (cueCount > 1) {
    personaFit += 1;
  }
  if (normalized.length < 16) {
    personaFit -= 1;
  }

  let antiMeta = 4;
  antiMeta -= bannedCount;
  if (/보고|기준|검토/u.test(normalized)) {
    antiMeta -= 1;
  }

  return {
    naturalness: scoreInt(naturalness),
    personaFit: scoreInt(personaFit),
    antiMeta: scoreInt(antiMeta),
  };
}

function heuristicJudge(
  evalCase: GoldenEvalCase,
  baselineReply: string,
  candidateReply: string,
): EvalJudgeResult {
  const npcId = evalCase.turns[0]?.npcId ?? "unknown";
  const baseline = heuristicScores(npcId, baselineReply);
  const candidate = heuristicScores(npcId, candidateReply);
  const baselineTotal =
    baseline.naturalness + baseline.personaFit + baseline.antiMeta;
  const candidateTotal =
    candidate.naturalness + candidate.personaFit + candidate.antiMeta;

  let winner: EvalJudgeResult["winner"] = "tie";
  if (candidateTotal > baselineTotal) {
    winner = "candidate";
  } else if (baselineTotal > candidateTotal) {
    winner = "baseline";
  }

  const reasons = [
    winner === "candidate"
      ? "candidate reply scored higher on heuristic quality checks"
      : winner === "baseline"
        ? "baseline reply remained stronger on heuristic quality checks"
        : "both replies were similar on heuristic quality checks",
  ];

  return {
    baseline,
    candidate,
    winner,
    confidence: 3,
    reasons,
  };
}

async function llmJudge(
  evalCase: GoldenEvalCase,
  baselineReply: string,
  candidateReply: string,
  provider: string,
  judgeModel: string | null,
) {
  const raw = await runStructuredLlmJudge({
    provider,
    model: judgeModel,
    schemaName: "training_golden_pairwise_judge",
    jsonSchema: PAIRWISE_REPLY_JUDGE_JSON_SCHEMA,
    systemPrompt: [
      "You are comparing two Korean NPC negotiation replies for the same golden benchmark case.",
      "Prefer natural spoken Korean, clear NPC persona fit, and direct in-scene confrontation.",
      "Penalize meta or report-like wording such as '의무실 기록에 따르면', '판단 기준', '검토하십시오', '기록으로 명확히'.",
      "Return only the requested JSON object.",
    ].join(" "),
    userPrompt: JSON.stringify(
      {
        benchmarkCase: {
          id: evalCase.id,
          description: evalCase.description,
          rubricHints: Array.isArray(evalCase.rubricHints) ? evalCase.rubricHints : [],
          playerTurn: evalCase.turns[0] ?? null,
        },
        baseline: {
          reply: baselineReply,
        },
        candidate: {
          reply: candidateReply,
        },
      },
      null,
      2,
    ),
  });

  return {
    baseline: {
      naturalness: scoreInt(raw?.baseline?.naturalness ?? 3),
      personaFit: scoreInt(raw?.baseline?.personaFit ?? 3),
      antiMeta: scoreInt(raw?.baseline?.antiMeta ?? 3),
    },
    candidate: {
      naturalness: scoreInt(raw?.candidate?.naturalness ?? 3),
      personaFit: scoreInt(raw?.candidate?.personaFit ?? 3),
      antiMeta: scoreInt(raw?.candidate?.antiMeta ?? 3),
    },
    winner:
      raw?.winner === "baseline" ||
      raw?.winner === "candidate" ||
      raw?.winner === "tie"
        ? raw.winner
        : "tie",
    confidence: scoreInt(raw?.confidence ?? 3),
    reasons: Array.isArray(raw?.reasons)
      ? raw.reasons.map((reason: unknown) => String(reason)).slice(0, 6)
      : ["judge did not provide reasons"],
  } satisfies EvalJudgeResult;
}

async function loadCases(casesPath: string) {
  const raw = JSON.parse(await fs.readFile(casesPath, "utf8")) as {
    cases?: GoldenEvalCase[];
  };
  if (!Array.isArray(raw.cases)) {
    throw new Error(`golden eval cases must contain a cases array: ${casesPath}`);
  }
  return raw.cases.filter((entry) => Array.isArray(entry.turns) && entry.turns.length > 0);
}

function buildReport(summary: Record<string, unknown>) {
  const winnerCounts = summary.winnerCounts as Record<string, number>;
  const averages = summary.averages as Record<string, number>;
  const cases = Array.isArray(summary.cases)
    ? (summary.cases as Array<Record<string, unknown>>)
    : [];

  return [
    "# Golden Eval Report",
    "",
    `- Benchmark: ${summary.benchmarkId}`,
    `- Binding: ${summary.bindingKey}`,
    `- Baseline: ${summary.baselineLabel}`,
    `- Candidate: ${summary.candidateLabel}`,
    `- Recommendation: ${summary.recommendation}`,
    "",
    "| Winner | Count |",
    "| --- | ---: |",
    `| baseline | ${winnerCounts.baseline ?? 0} |`,
    `| candidate | ${winnerCounts.candidate ?? 0} |`,
    `| tie | ${winnerCounts.tie ?? 0} |`,
    "",
    "| Metric | Baseline | Candidate |",
    "| --- | ---: | ---: |",
    `| Naturalness | ${averages.baselineNaturalness ?? 0} | ${averages.candidateNaturalness ?? 0} |`,
    `| Persona Fit | ${averages.baselinePersonaFit ?? 0} | ${averages.candidatePersonaFit ?? 0} |`,
    `| Anti-Meta | ${averages.baselineAntiMeta ?? 0} | ${averages.candidateAntiMeta ?? 0} |`,
    `| Confidence | ${averages.confidence ?? 0} | ${averages.confidence ?? 0} |`,
    "",
    "| Case | Winner | Confidence |",
    "| --- | --- | ---: |",
    ...cases.map(
      (entry) =>
        `| ${entry.caseId ?? "unknown"} | ${entry.winner ?? "tie"} | ${entry.confidence ?? "-"} |`,
    ),
    "",
  ].join("\n");
}

export async function runTrainingGoldenEvalWorker(args: WorkerArgs) {
  const run = await readTrainingRun(args.runId);
  const candidateRuntimePath =
    run?.runtime_artifact_path ?? run?.output_adapter_path ?? null;
  if (!run?.run_uid) {
    throw new Error(`training run not found: ${args.runId}`);
  }

  let candidateTarget: RuntimeTarget;
  if (run.remote_model_name) {
    candidateTarget = {
      kind: "together",
      model: run.remote_model_name,
      provider: run.remote_provider,
    };
  } else if (candidateRuntimePath) {
    if (!(await pathExists(LOCAL_MLX_BINARY))) {
      throw new Error(`MLX binary not found: ${LOCAL_MLX_BINARY}`);
    }
    if (!(await pathExists(candidateRuntimePath))) {
      throw new Error(`candidate runtime artifact not found: ${candidateRuntimePath}`);
    }
    candidateTarget = {
      kind: "local",
      artifactPath: candidateRuntimePath,
      artifactKind: await resolveRuntimeArtifactKind(
        candidateRuntimePath,
        run.runtime_artifact_kind,
      ),
    };
  } else {
    throw new Error(`training run candidate target missing: ${args.runId}`);
  }

  const baselineAdapterPath =
    args.baselineAdapterPath && (await pathExists(args.baselineAdapterPath))
      ? args.baselineAdapterPath
      : null;
  let baselineTarget: RuntimeTarget;
  if (args.baselineRemoteModel) {
    baselineTarget = {
      kind: "together",
      model: args.baselineRemoteModel,
      provider: args.baselineRemoteProvider,
    };
  } else if (baselineAdapterPath) {
    if (!(await pathExists(LOCAL_MLX_BINARY))) {
      throw new Error(`MLX binary not found: ${LOCAL_MLX_BINARY}`);
    }
    baselineTarget = {
      kind: "local",
      artifactPath: baselineAdapterPath,
      artifactKind: await resolveRuntimeArtifactKind(baselineAdapterPath, null),
    };
  } else {
    baselineTarget = {
      kind: "local",
      artifactPath: null,
      artifactKind: null,
    };
  }

  const startedAt = new Date().toISOString();
  await updateTrainingRunEvaluation({
    runId: args.runId,
    evalState: "running",
    evalMessage: "Golden-set Evaluation 실행 중",
    bindingKey: args.bindingKey,
    baselineLabel: args.baselineLabel,
    startedAt,
  });

  const outputDir = path.resolve(
    run.dataset_work_dir ?? path.join(PROJECT_ROOT, "data", "train", "runs", args.runId, "dataset"),
    "..",
    "eval",
    args.bindingKey,
  );
  const summaryPath = path.join(outputDir, "compare-summary.json");
  const reportPath = path.join(outputDir, "compare-report.md");

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const cases = await loadCases(args.casesPath);
    const results: Array<Record<string, unknown>> = [];

    for (const evalCase of cases) {
      const prompt = buildRawJsonPrompt(evalCase);
      const npcId = evalCase.turns[0]?.npcId ?? "unknown";
      const [baselineReply, candidateReply] = await Promise.all([
        runGenerate({
          npcId,
          prompt,
          target: baselineTarget,
        }),
        runGenerate({
          npcId,
          prompt,
          target: candidateTarget,
        }),
      ]);

      let judge: EvalJudgeResult;
      let judgeMode = "llm";
      try {
        judge = await llmJudge(
          evalCase,
          baselineReply,
          candidateReply,
          args.provider,
          args.judgeModel,
        );
      } catch {
        judge = heuristicJudge(evalCase, baselineReply, candidateReply);
        judgeMode = "heuristic";
      }

      results.push({
        caseId: evalCase.id,
        description: evalCase.description,
        judgeMode,
        baselineReply,
        candidateReply,
        winner: judge.winner,
        confidence: judge.confidence,
        baseline: judge.baseline,
        candidate: judge.candidate,
        reasons: judge.reasons,
      });
    }

    const baselineWins = results.filter((entry) => entry.winner === "baseline").length;
    const candidateWins = results.filter((entry) => entry.winner === "candidate").length;
    const tieCount = results.filter((entry) => entry.winner === "tie").length;
    const averages = {
      baselineNaturalness: average(results.map((entry) => Number((entry.baseline as EvalScoreBlock).naturalness))),
      candidateNaturalness: average(results.map((entry) => Number((entry.candidate as EvalScoreBlock).naturalness))),
      baselinePersonaFit: average(results.map((entry) => Number((entry.baseline as EvalScoreBlock).personaFit))),
      candidatePersonaFit: average(results.map((entry) => Number((entry.candidate as EvalScoreBlock).personaFit))),
      baselineAntiMeta: average(results.map((entry) => Number((entry.baseline as EvalScoreBlock).antiMeta))),
      candidateAntiMeta: average(results.map((entry) => Number((entry.candidate as EvalScoreBlock).antiMeta))),
      confidence: average(results.map((entry) => Number(entry.confidence ?? 0))),
    };
    const recommendation =
      candidateWins > baselineWins &&
      averages.candidatePersonaFit >= averages.baselinePersonaFit &&
      averages.candidateAntiMeta >= averages.baselineAntiMeta
        ? "promote"
        : "hold";

    const summary = {
      generatedAt: new Date().toISOString(),
      benchmarkId: "reply-golden-v1",
      bindingKey: args.bindingKey,
      baselineLabel: args.baselineLabel,
      candidateLabel: args.runId,
      summaryPath,
      reportPath,
      recommendation,
      winnerCounts: {
        baseline: baselineWins,
        candidate: candidateWins,
        tie: tieCount,
      },
      averages,
      cases: results,
    };

    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await fs.writeFile(reportPath, `${buildReport(summary)}\n`, "utf8");

    await updateTrainingRunEvaluation({
      runId: args.runId,
      evalState: "succeeded",
      evalMessage: "Golden-set Evaluation 완료",
      bindingKey: args.bindingKey,
      baselineLabel: args.baselineLabel,
      summaryPath,
      summaryJson: summary,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    await appendTrainingRunEvent({
      runId: args.runId,
      level: "info",
      eventType: "golden_eval_finished",
      message: "Golden-set Evaluation 완료",
      payload: {
        bindingKey: args.bindingKey,
        baselineLabel: args.baselineLabel,
        recommendation,
      },
    });
    await registerTrainingArtifact({
      runId: args.runId,
      artifactKind: "golden_eval_summary",
      filePath: summaryPath,
      metadata: {
        bindingKey: args.bindingKey,
        baselineLabel: args.baselineLabel,
      },
    });
    await registerTrainingArtifact({
      runId: args.runId,
      artifactKind: "golden_eval_report",
      filePath: reportPath,
      metadata: {
        bindingKey: args.bindingKey,
        baselineLabel: args.baselineLabel,
      },
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTrainingRunEvaluation({
      runId: args.runId,
      evalState: "failed",
      evalMessage: message,
      bindingKey: args.bindingKey,
      baselineLabel: args.baselineLabel,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    await appendTrainingRunEvent({
      runId: args.runId,
      level: "error",
      eventType: "golden_eval_failed",
      message,
    });
    throw error;
  }
}

export async function closeTrainingEvalResources() {
  await closeDbPool().catch(() => {});
}
