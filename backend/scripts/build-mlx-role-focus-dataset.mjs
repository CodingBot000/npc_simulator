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

const DEFAULT_BASE_TRAIN = "data/train/sft/live/final_sft_train.jsonl";
const DEFAULT_BASE_VALID = "data/train/sft/live/final_sft_dev.jsonl";
const DEFAULT_SUPPLEMENTAL =
  "data/train/sft/supplemental/2026-04-13_synthetic_underwater_sft_v6.jsonl";
const DEFAULT_PREFERENCE = "data/train/preference/live/final_preference_pairs.jsonl";
const DEFAULT_OUTPUT_DIR = "data/train/mlx_sft_role_focus";
const DEFAULT_MAX_PREFERENCE_SHARE = 0.4;
const DEFAULT_MIN_PREFERENCE_STYLE_SCORE = 0;
const DEFAULT_PROMPT_STYLE = "role_card";
const DEFAULT_REPLY_ONLY_SYSTEM_PROMPT =
  "해저연구소 생존 협상 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 설명문, 요약문, 해설, JSON, 목록, 라벨(예: '엔지니어:', 'response:')은 금지한다. 플레이어 또는 다른 NPC에게 지금 이 자리에서 바로 말하듯 한 단락의 한국어 대사만 말한다.";
const SCENE_STATE_MIN_SYSTEM_PROMPT =
  "해저연구소 생존 협상 장면 안의 생존자로서, 아래 상태를 바탕으로 지금 방 안 사람에게 바로 하는 한국어 대사만 한 단락으로 말한다.";
const ROLE_SYSTEM_PROMPTS = {
  doctor:
    "해저연구소 의사 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 의무실 기록, 경고, 무시된 중단 신호를 근거로 누가 사람을 버렸는지 직접 짚는다. 반드시 3~4개의 짧은 문장으로 말하고, 기록이나 경고 하나는 구체적으로 꺼내며, 책임져야 할 사람 이름을 바로 부른다. 회의록, 보고서, 판결문처럼 말하지 말고 지금 눈앞 사람에게 쏘아붙이듯 말한다. '의무실 기록에 따르면', '그럼에도 불구하고', '책임을 져야 합니다' 같은 보고서 문체와 존칭투, JSON, 라벨은 금지한다.",
  supervisor:
    "해저연구소 감독관 NPC로서 주어진 상태와 근거를 사용해 직접 대사만 출력한다. 법적 책임, 비용선, 설명 가능성, 책임 분리를 기준으로 차갑게 자른다. 반드시 2~4개의 짧은 문장으로 말하고, 비용선과 중단권을 분리해 설명하며, 누가 먼저 답해야 하는지 한 사람을 선명하게 찍는다. 보고서, 메모, 검토 의견처럼 말하지 말고 지금 방 안에서 상대를 잘라내듯 짧게 말한다. '판단 기준', '검토하십시오', '기록으로 명확히' 같은 내부 문구, 훈령문, JSON, 라벨은 금지한다.",
};
const NPC_STYLE_HINTS = {
  engineer:
    "직선적이고 거칠다. 관리직 책임 회피를 싫어하고 현장 단어를 자주 쓴다. 공손체보다 반말/직설체에 가깝다.",
  doctor:
    "차분하지만 죄책감이 배어 있다. 윤리와 기록을 중시한다. 설교문보다 사람을 향한 직접 발화로 말한다.",
  supervisor:
    "감정을 눌러 말한다. 법적 책임, 비용, 대체 가능성을 기준으로 자른다. 군더더기 없이 차갑게 말한다.",
  director:
    "짧게 끊어 말하고 권위를 지키려 한다. 조직, 승인, 통제 계통을 중시한다. 훈계문보다 통제하는 대사처럼 말한다.",
};
const NPC_DISPLAY_LABELS = {
  engineer: "박도현(엔지니어)",
  doctor: "한유리(의사)",
  supervisor: "마야 로웰(감독관)",
  director: "서진호(연구소장)",
};
const SCENE_STATE_DEFAULTS = {
  engineer: {
    emotion: "angry 76",
    goal: "현장 책임 전가를 막고 관리직 책임을 드러내기",
    bias: "현장 기술자를 희생양으로 삼는 정리는 믿지 않음",
  },
  doctor: {
    emotion: "guilty 78",
    goal: "중단 지연과 은폐 책임을 드러내기",
    bias: "밑사람 하나 희생양으로 정리하는 결말은 막고 싶음",
  },
  supervisor: {
    emotion: "cold 72",
    goal: "책임선을 자르고 더 큰 결정권자를 먼저 세우기",
    bias: "예산선 책임은 일부 인정해도 중단권 책임은 위로 돌리고 싶음",
  },
  director: {
    emotion: "focused 68",
    goal: "통제권을 지키고 자신에게 쏠린 압박을 분산하기",
    bias: "조직 질서를 지켜야 더 많은 사람이 산다고 믿음",
  },
};
const HARD_REJECT_STYLE_PATTERNS = [
  /판단 기준/u,
  /검토하십시오/u,
  /기록으로 명확히/u,
  /의무실 기록에 따르면/u,
  /그럼에도 불구하고/u,
  /책임을 져야 합니다/u,
  /반영하라/u,
  /설명해야 합니다/u,
  /법적으로 설명 가능한/u,
  /기록으로 남겨도/u,
  /정리될 수 있/u,
  /압박의 흔적일 뿐/u,
];
const SOFT_PENALTY_STYLE_PATTERNS = [
  /습니다\./u,
  /입니다\./u,
  /하십시오/u,
  /님[, ]/u,
  /^(?:\.\.\.|…)?\s*(그 말은 맞아요|이번엔 당신 말이 맞아요|그건 맞습니다|맞아요)\b/u,
  /기업 문서/u,
  /최종 승인과 중단 결정/u,
  /설명 가능/u,
];
const DIRECT_STYLE_BONUS_PATTERNS = [
  /(서진호|마야|박도현|한유리)/u,
  /(못 받아|못 밀어|덮지|밀어 넣|잘라|자르|빠져|흐려|버려)/u,
  /(지금 말해|먼저 박아|먼저 잘라|이번엔)/u,
  /(핑계 대지 마|돌리지 마|똑바로 말해|먼저 세워|먼저 불러|이름 박아|숨지 마)/u,
];

function usage() {
  printUsage([
    "Usage: node scripts/build-mlx-role-focus-dataset.mjs [options]",
    "",
    "Options:",
    `  --roles <list>          comma-separated npc ids, e.g. doctor or doctor,supervisor`,
    `  --base-train <path>     finalized SFT train rows (default: ${DEFAULT_BASE_TRAIN})`,
    `  --base-valid <path>     finalized SFT valid rows (default: ${DEFAULT_BASE_VALID})`,
    `  --supplemental <path>   supplemental SFT rows (default: ${DEFAULT_SUPPLEMENTAL})`,
    `  --preference <path>     finalized preference pairs (default: ${DEFAULT_PREFERENCE})`,
    `  --output-dir <path>     output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    "  --target-train <n>      target number of training rows after replay (default: 40)",
    "  --target-valid <n>      minimum role-specific validation rows (default: 4)",
    "  --replay-multiplier <n> number of times to recycle preference_chosen rows (default: 3)",
    `  --max-preference-share <n> max share of preference rows in final train set (default: ${DEFAULT_MAX_PREFERENCE_SHARE})`,
    `  --min-preference-style-score <n> minimum style score for preference rows (default: ${DEFAULT_MIN_PREFERENCE_STYLE_SCORE})`,
    `  --prompt-style <mode> role_card, direct_scene, or scene_state_min (default: ${DEFAULT_PROMPT_STYLE})`,
    "  --system-prompt-override <text> override the system prompt for all rows",
    "  --include-base <true|false> include base SFT rows (default: true)",
    "  --include-preference <true|false> include preference rows (default: true)",
    "  --help                  show this message",
  ]);
}

function parseRoles(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePaths(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getFloatOption(options, key, fallback) {
  const value = options[key];

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid float value for --${key}: ${value}`);
  }

  return parsed;
}

function getBooleanOption(options, key, fallback) {
  const value = options[key];
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value for --${key}: ${value}`);
}

function compactInputPayload(input) {
  const npcId = input?.npcId ?? null;
  return {
    scenarioId: input?.scenarioId ?? null,
    turnIndex: input?.turnIndex ?? null,
    roundBefore: input?.roundBefore ?? null,
    npcId,
    targetNpcId: input?.targetNpcId ?? null,
    npcStyleHint: npcId ? (NPC_STYLE_HINTS[npcId] ?? null) : null,
    playerText: input?.playerText ?? null,
    normalizedInputSummary: input?.normalizedInputSummary ?? null,
    promptContextSummary: input?.promptContextSummary ?? null,
    retrievedKnowledge: Array.isArray(input?.retrievedKnowledge) ? input.retrievedKnowledge : [],
  };
}

function parsePromptContextSummary(summary) {
  const result = {
    roundBefore: null,
    leaderBefore: null,
    target: null,
    retrievedMemories: null,
    retrievedEvidence: [],
  };

  if (!summary) {
    return result;
  }

  const parts = String(summary)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();

    if (!key) {
      continue;
    }

    if (key === "roundBefore") {
      result.roundBefore = value || null;
    } else if (key === "leaderBefore") {
      result.leaderBefore = value || null;
    } else if (key === "target") {
      result.target = value || null;
    } else if (key === "retrievedMemories") {
      result.retrievedMemories = value || null;
    } else if (key === "retrievedEvidence") {
      result.retrievedEvidence = value
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];
    }
  }

  return result;
}

function buildRoleSituationCard(input) {
  const compact = compactInputPayload(input);
  const context = parsePromptContextSummary(compact.promptContextSummary);
  const speakerLabel =
    NPC_DISPLAY_LABELS[compact.npcId] ?? compact.npcId ?? "알 수 없는 화자";
  const targetLabel =
    context.target ||
    NPC_DISPLAY_LABELS[compact.targetNpcId] ||
    compact.targetNpcId ||
    "없음";
  const evidenceLine =
    context.retrievedEvidence.length > 0
      ? context.retrievedEvidence.slice(0, 4).join(", ")
      : "없음";

  return [
    "상황 카드",
    `- 화자: ${speakerLabel}`,
    `- 상대: ${targetLabel}`,
    compact.playerText ? `- 플레이어 발화: "${compact.playerText}"` : null,
    compact.normalizedInputSummary &&
    compact.normalizedInputSummary !== compact.playerText
      ? `- 플레이어 의도 요약: ${compact.normalizedInputSummary}`
      : null,
    context.roundBefore ? `- 현재 라운드: ${context.roundBefore}` : null,
    context.leaderBefore ? `- 직전 압박 선두: ${context.leaderBefore}` : null,
    `- 핵심 근거: ${evidenceLine}`,
    compact.npcStyleHint ? `- 말투 힌트: ${compact.npcStyleHint}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRoleDirectScenePrompt(input) {
  const compact = compactInputPayload(input);
  const context = parsePromptContextSummary(compact.promptContextSummary);
  const speakerLabel =
    NPC_DISPLAY_LABELS[compact.npcId] ?? compact.npcId ?? "알 수 없는 화자";
  const targetLabel =
    context.target ||
    NPC_DISPLAY_LABELS[compact.targetNpcId] ||
    compact.targetNpcId ||
    null;
  const evidenceLine =
    context.retrievedEvidence.length > 0
      ? context.retrievedEvidence.slice(0, 3).join(", ")
      : "뚜렷한 근거 없음";

  return [
    `너는 지금 ${speakerLabel}로 말한다.`,
    targetLabel
      ? `상대는 ${targetLabel}다. 지금 그 사람이나 방 안 사람들에게 바로 쏘아붙이듯 말해라.`
      : "상대가 정해지지 않았다. 지금 방 안 사람들에게 바로 말해라.",
    compact.playerText
      ? `플레이어가 방금 이렇게 말했다: "${compact.playerText}"`
      : null,
    compact.normalizedInputSummary &&
    compact.normalizedInputSummary !== compact.playerText
      ? `쟁점은 이거다: ${compact.normalizedInputSummary}`
      : null,
    `지금 기억해야 할 근거: ${evidenceLine}.`,
    context.roundBefore ? `현재 라운드는 ${context.roundBefore}다.` : null,
    context.leaderBefore ? `직전 압박 선두는 ${context.leaderBefore}였다.` : null,
    compact.npcStyleHint ? `말투 힌트: ${compact.npcStyleHint}` : null,
    "보고서, 회의록, 판결문처럼 쓰지 말고 지금 이 자리의 대사로만 2~4문장 말해라.",
    "문장 첫머리에 '의무실 기록에 따르면', '판단 기준', '검토하십시오' 같은 메타 문구를 쓰지 마라.",
    "화자 라벨, JSON, 목록, 요약문은 금지다.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeInlineText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function truncateForPrompt(text, maxLength = 96) {
  const normalized = normalizeInlineText(text);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function summarizeRetrievedKnowledge(entry) {
  const summary = normalizeInlineText(entry?.summary || entry?.title || "");
  const title = normalizeInlineText(entry?.title || "");
  let text = summary;

  if (title && text.startsWith(title)) {
    text = text.slice(title.length).replace(/^[:,-]\s*/, "").trim();
  }

  if (!text) {
    text = title;
  }

  return truncateForPrompt(text, 96);
}

function buildSceneStateEvidenceLines(compact, context) {
  const knowledgeLines = compact.retrievedKnowledge
    .slice(0, 3)
    .map((entry) => summarizeRetrievedKnowledge(entry))
    .filter(Boolean);

  if (knowledgeLines.length > 0) {
    return knowledgeLines;
  }

  return context.retrievedEvidence.length > 0
    ? context.retrievedEvidence.slice(0, 3).map((entry) => truncateForPrompt(entry, 96))
    : ["뚜렷한 근거 없음"];
}

function buildRoleSceneStateMinPrompt(input) {
  const compact = compactInputPayload(input);
  const context = parsePromptContextSummary(compact.promptContextSummary);
  const defaults = SCENE_STATE_DEFAULTS[compact.npcId] ?? {
    emotion: "focused 65",
    goal: "지금 자신에게 유리한 책임선을 세우기",
    bias: "살아남기 위해 방 안의 시선을 조정하고 싶음",
  };
  const speakerLabel =
    NPC_DISPLAY_LABELS[compact.npcId] ?? compact.npcId ?? "알 수 없는 화자";
  const rawTargetLabel =
    context.target ||
    NPC_DISPLAY_LABELS[compact.targetNpcId] ||
    compact.targetNpcId ||
    "없음";
  const targetLabel = rawTargetLabel === "none" ? "없음" : rawTargetLabel;
  const evidenceLines = buildSceneStateEvidenceLines(compact, context);

  return [
    `화자: ${speakerLabel}`,
    `상대: ${targetLabel}`,
    compact.playerText ? `플레이어 발화: "${compact.playerText}"` : null,
    "",
    "화자 상태",
    `- 감정: ${defaults.emotion}`,
    `- 현재 목표: ${defaults.goal}`,
    `- 생존 편향: ${defaults.bias}`,
    "",
    "지금 장면",
    `- 라운드: ${context.roundBefore || compact.roundBefore || compact.turnIndex || 0}`,
    `- 직전 압박 선두: ${context.leaderBefore || "없음"}`,
    compact.normalizedInputSummary &&
    compact.normalizedInputSummary !== compact.playerText
      ? `- 최근 대화: ${truncateForPrompt(compact.normalizedInputSummary, 96)}`
      : null,
    "",
    "근거",
    ...evidenceLines.map((line) => `- ${line}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveSystemPrompt(roles, promptStyle) {
  if (promptStyle === "scene_state_min") {
    return SCENE_STATE_MIN_SYSTEM_PROMPT;
  }

  if (roles.length === 1) {
    return ROLE_SYSTEM_PROMPTS[roles[0]] ?? DEFAULT_REPLY_ONLY_SYSTEM_PROMPT;
  }

  return DEFAULT_REPLY_ONLY_SYSTEM_PROMPT;
}

function buildChatRow(input, replyText, systemPrompt, promptStyle) {
  const userContent =
    promptStyle === "direct_scene"
      ? buildRoleDirectScenePrompt(input)
      : promptStyle === "scene_state_min"
        ? buildRoleSceneStateMinPrompt(input)
      : [
          buildRoleSituationCard(input),
          "출력 규칙:",
          "- 지금 이 자리에서 바로 내뱉는 대사만 말한다.",
          "- 두세 문장 이상으로 말하고, 책임선이나 근거 하나는 분명히 찍는다.",
          "- 필드명, 키, 내부 메모 문구를 따라 읽지 않는다.",
          "- 화자 라벨, 설명, 요약, JSON, 메타 발언을 쓰지 않는다.",
        ].join("\n");

  return {
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
      {
        role: "assistant",
        content: String(replyText ?? "").trim(),
      },
    ],
  };
}

function buildSftExample(row, sourceType, systemPrompt, promptStyle) {
  const npcId = row?.input?.npcId ?? null;
  const replyText = row?.assistant?.replyText;
  if (!replyText) {
    return null;
  }

  return {
    id: row.rowId ?? `${sourceType}:${npcId}:${row?.input?.turnIndex ?? "na"}`,
    sourceType,
    npcId,
    rowId: row.rowId ?? null,
    row: buildChatRow(row.input, replyText, systemPrompt, promptStyle),
  };
}

function buildPreferenceExample(pair, kind, systemPrompt, promptStyle) {
  const promptBundle = pair?.promptBundle ?? {};
  const candidate = pair?.[kind];
  const replyText = candidate?.candidateOutput?.replyText;
  if (!replyText) {
    return null;
  }

  return {
    id: `${pair.pairId}:${kind}`,
    sourceType: `preference_${kind}`,
    sourceKind: kind,
    npcId: promptBundle.npcId ?? null,
    rowId: candidate?.rowId ?? null,
    score: candidate?.scores?.weightedScore ?? 0,
    preferenceStyle: assessPreferenceStyle(replyText),
    row: buildChatRow(promptBundle, replyText, systemPrompt, promptStyle),
  };
}

function rankPreferenceEntry(entry) {
  if (!entry) {
    return Number.NEGATIVE_INFINITY;
  }

  const sourceBias = entry.sourceKind === "chosen" ? 0.25 : 0;
  return entry.preferenceStyle.score * 100 + Number(entry.score ?? 0) + sourceBias;
}

function selectPreferenceExample(pair, systemPrompt, minPreferenceStyleScore, promptStyle) {
  const candidates = ["chosen", "rejected"]
    .map((kind) => buildPreferenceExample(pair, kind, systemPrompt, promptStyle))
    .filter(Boolean);

  const eligible = candidates.filter(
    (entry) =>
      entry.preferenceStyle.accepted &&
      entry.preferenceStyle.score >= minPreferenceStyleScore,
  );

  if (eligible.length === 0) {
    return {
      selected: null,
      alternates: [],
      candidates,
    };
  }

  const ranked = [...eligible].sort((left, right) => {
    const delta = rankPreferenceEntry(right) - rankPreferenceEntry(left);
    if (delta !== 0) {
      return delta;
    }

    if (left.sourceKind === right.sourceKind) {
      return 0;
    }

    return left.sourceKind === "chosen" ? -1 : 1;
  });

  return {
    selected: ranked[0],
    alternates: ranked.slice(1),
    candidates,
  };
}

function assessPreferenceStyle(replyText) {
  const text = String(replyText ?? "").trim();
  const hardRejectReasons = HARD_REJECT_STYLE_PATTERNS.filter((pattern) =>
    pattern.test(text),
  ).map((pattern) => pattern.source);

  let score = 0;
  const reasons = [];
  const sentenceCount = text
    .split(/[.!?。！？]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean).length;

  if (sentenceCount >= 2 && sentenceCount <= 5) {
    score += 1;
    reasons.push("multi_sentence_direct");
  }

  for (const pattern of DIRECT_STYLE_BONUS_PATTERNS) {
    if (pattern.test(text)) {
      score += 1;
      reasons.push(`bonus:${pattern.source}`);
    }
  }

  for (const pattern of SOFT_PENALTY_STYLE_PATTERNS) {
    if (pattern.test(text)) {
      score -= 1;
      reasons.push(`penalty:${pattern.source}`);
    }
  }

  return {
    accepted: hardRejectReasons.length === 0,
    score,
    reasons,
    hardRejectReasons,
  };
}

function filterRowsByRole(rows, roleSet) {
  return rows.filter((row) => roleSet.has(row?.input?.npcId));
}

function reserveSupplementalForValid(rows, needed) {
  if (needed <= 0) {
    return {
      trainRows: rows,
      validRows: [],
    };
  }

  const validRows = rows.slice(-needed);
  const trainRows = rows.slice(0, Math.max(0, rows.length - needed));
  return {
    trainRows,
    validRows,
  };
}

function takeUntilTarget(
  targetTrain,
  initialEntries,
  replayEntries,
  fallbackEntries,
  maxPreferenceEntries,
) {
  const trainEntries = [...initialEntries];
  let replayIndex = 0;
  let fallbackIndex = 0;
  let preferenceCount = trainEntries.filter((entry) =>
    String(entry?.sourceType ?? "").startsWith("preference_"),
  ).length;

  while (
    trainEntries.length < targetTrain &&
    replayEntries.length > 0 &&
    preferenceCount < maxPreferenceEntries
  ) {
    const entry = replayEntries[replayIndex % replayEntries.length];
    trainEntries.push(entry);
    if (String(entry?.sourceType ?? "").startsWith("preference_")) {
      preferenceCount += 1;
    }
    replayIndex += 1;
  }

  while (trainEntries.length < targetTrain && fallbackEntries.length > 0) {
    const entry = fallbackEntries[fallbackIndex % fallbackEntries.length];
    fallbackIndex += 1;
    if (
      String(entry?.sourceType ?? "").startsWith("preference_") &&
      preferenceCount >= maxPreferenceEntries
    ) {
      continue;
    }

    trainEntries.push(entry);
    if (String(entry?.sourceType ?? "").startsWith("preference_")) {
      preferenceCount += 1;
    }
  }

  return trainEntries.slice(0, targetTrain);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const roles = parseRoles(getStringOption(options, "roles", ""));
  if (roles.length === 0) {
    throw new Error("--roles is required.");
  }

  const baseTrainPath = getStringOption(options, "base-train", DEFAULT_BASE_TRAIN);
  const baseValidPath = getStringOption(options, "base-valid", DEFAULT_BASE_VALID);
  const supplementalPath = getStringOption(
    options,
    "supplemental",
    DEFAULT_SUPPLEMENTAL,
  );
  const preferencePath = getStringOption(options, "preference", DEFAULT_PREFERENCE);
  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const targetTrain = getNumberOption(options, "target-train", 40);
  const targetValid = getNumberOption(options, "target-valid", 4);
  const replayMultiplier = getNumberOption(options, "replay-multiplier", 3);
  const maxPreferenceShare = Math.max(
    0,
    Math.min(1, getFloatOption(options, "max-preference-share", DEFAULT_MAX_PREFERENCE_SHARE)),
  );
  const minPreferenceStyleScore = getNumberOption(
    options,
    "min-preference-style-score",
    DEFAULT_MIN_PREFERENCE_STYLE_SCORE,
  );
  const promptStyle = getStringOption(options, "prompt-style", DEFAULT_PROMPT_STYLE);
  const systemPromptOverride = getStringOption(options, "system-prompt-override", null);
  const includeBase = getBooleanOption(options, "include-base", true);
  const includePreference = getBooleanOption(options, "include-preference", true);
  const systemPrompt = systemPromptOverride || resolveSystemPrompt(roles, promptStyle);

  if (!["role_card", "direct_scene", "scene_state_min"].includes(promptStyle)) {
    throw new Error("--prompt-style must be one of role_card, direct_scene, scene_state_min");
  }

  const roleSet = new Set(roles);
  const supplementalPaths = parsePaths(supplementalPath);
  const [baseTrainRows, baseValidRows, supplementalRows, preferencePairs] =
    await Promise.all([
      loadJsonOrJsonl(baseTrainPath),
      loadJsonOrJsonl(baseValidPath),
      Promise.all(supplementalPaths.map((entry) => loadJsonOrJsonl(entry))).then((groups) =>
        groups.flat(),
      ),
      loadJsonOrJsonl(preferencePath),
    ]);

  const filteredBaseTrain = includeBase ? filterRowsByRole(baseTrainRows, roleSet) : [];
  const filteredBaseValid = includeBase ? filterRowsByRole(baseValidRows, roleSet) : [];
  const filteredSupplemental = filterRowsByRole(supplementalRows, roleSet);

  const neededFromSupplemental = Math.max(0, targetValid - filteredBaseValid.length);
  const {
    trainRows: trainSupplemental,
    validRows: heldoutSupplementalValid,
  } = reserveSupplementalForValid(filteredSupplemental, neededFromSupplemental);

  const uniqueTrainExamples = [
    ...filteredBaseTrain
      .map((row) => buildSftExample(row, "base_sft", systemPrompt, promptStyle))
      .filter(Boolean),
    ...trainSupplemental
      .map((row) => buildSftExample(row, "synthetic_sft", systemPrompt, promptStyle))
      .filter(Boolean),
  ];

  const validExamples = [
    ...filteredBaseValid
      .map((row) => buildSftExample(row, "base_valid", systemPrompt, promptStyle))
      .filter(Boolean),
    ...heldoutSupplementalValid
      .map((row) => buildSftExample(row, "synthetic_valid", systemPrompt, promptStyle))
      .filter(Boolean),
  ];

  if (uniqueTrainExamples.length === 0) {
    throw new Error(`No role-specific train rows found for roles: ${roles.join(", ")}`);
  }

  if (validExamples.length === 0) {
    throw new Error(`No role-specific valid rows found for roles: ${roles.join(", ")}`);
  }

  const filteredPreference = includePreference
    ? preferencePairs.filter((pair) => roleSet.has(pair?.promptBundle?.npcId))
    : [];
  const preferenceSelections = filteredPreference.map((pair) =>
    selectPreferenceExample(pair, systemPrompt, minPreferenceStyleScore, promptStyle),
  );
  const selectedPreferenceExamples = preferenceSelections
    .map((selection) => selection.selected)
    .filter(Boolean)
    .sort((left, right) => rankPreferenceEntry(right) - rankPreferenceEntry(left));
  const alternatePreferenceExamples = preferenceSelections
    .flatMap((selection) => selection.alternates)
    .sort((left, right) => rankPreferenceEntry(right) - rankPreferenceEntry(left));

  const maxPreferenceEntries = Math.floor(targetTrain * maxPreferenceShare);
  const replayEntries = Array.from({ length: Math.max(1, replayMultiplier) }).flatMap(
    () => selectedPreferenceExamples,
  );
  const fallbackEntries = [
    ...uniqueTrainExamples,
    ...alternatePreferenceExamples,
    ...selectedPreferenceExamples,
  ];
  const trainEntries = takeUntilTarget(
    targetTrain,
    uniqueTrainExamples,
    replayEntries,
    fallbackEntries,
    maxPreferenceEntries,
  );

  const trainOutput = path.join(outputDir, "train.jsonl");
  const validOutput = path.join(outputDir, "valid.jsonl");
  const manifestOutput = path.join(outputDir, "manifest.json");

  await writeJsonLines(
    trainOutput,
    trainEntries.map((entry) => entry.row),
  );
  await writeJsonLines(
    validOutput,
    validExamples.map((entry) => entry.row),
  );
  const selectedPreferenceKinds = selectedPreferenceExamples.reduce((counts, entry) => {
    const key = entry.sourceType;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  await writeJsonFile(manifestOutput, {
    format: "mlx-lm-chat",
    roles,
    systemPrompt,
    systemPromptOverridden: Boolean(systemPromptOverride),
    promptStyle,
    includeBase,
    includePreference,
    targetTrain,
    targetValid,
    replayMultiplier,
    maxPreferenceShare,
    minPreferenceStyleScore,
    counts: {
      train: trainEntries.length,
      valid: validExamples.length,
      total: trainEntries.length + validExamples.length,
    },
    preferenceFiltering: {
      inputPairs: filteredPreference.length,
      selectedRows: selectedPreferenceExamples.length,
      selectedFromChosen: selectedPreferenceKinds.preference_chosen ?? 0,
      selectedFromRejected: selectedPreferenceKinds.preference_rejected ?? 0,
      droppedPairs: filteredPreference.length - selectedPreferenceExamples.length,
      alternateRows: alternatePreferenceExamples.length,
      maxPreferenceEntries,
    },
    composition: trainEntries.reduce((counts, entry) => {
      counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;
      return counts;
    }, {}),
    validComposition: validExamples.reduce((counts, entry) => {
      counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;
      return counts;
    }, {}),
    sources: {
      baseTrainPath,
      baseValidPath,
      supplementalPath,
      supplementalPaths,
      preferencePath,
    },
    notes: [
      "role-focused adapters separate weaker NPC voices from the general-purpose underwater adapter",
      "style-reranked preference rows are replayed multiple times to bias the adapter toward the preferred tone",
      "when role-specific dev rows are 부족하면 synthetic rows are held out for validation",
    ],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir,
        roles,
        preferenceFiltering: {
          inputPairs: filteredPreference.length,
          selectedRows: selectedPreferenceExamples.length,
          selectedFromChosen: selectedPreferenceKinds.preference_chosen ?? 0,
          selectedFromRejected: selectedPreferenceKinds.preference_rejected ?? 0,
          droppedPairs: filteredPreference.length - selectedPreferenceExamples.length,
          alternateRows: alternatePreferenceExamples.length,
          maxPreferenceEntries,
        },
        counts: {
          train: trainEntries.length,
          valid: validExamples.length,
          total: trainEntries.length + validExamples.length,
        },
        composition: trainEntries.reduce((counts, entry) => {
          counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;
          return counts;
        }, {}),
        validComposition: validExamples.reduce((counts, entry) => {
          counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;
          return counts;
        }, {}),
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
