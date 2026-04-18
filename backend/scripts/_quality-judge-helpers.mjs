import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  appendJsonLine,
  basenameLabel,
  errorMessage,
  initializeOutputFile,
  loadJsonOrJsonl,
  parseCommaSeparatedOption,
  resolveProjectPath,
  totalPressureDelta,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";

const VALID_ACTIONS = new Set([
  "accuse",
  "defend",
  "deflect",
  "appeal",
  "ally",
  "stall",
  "probe",
]);

const VALID_IMPACT_TAGS = new Set([
  "player_distrust_up",
  "player_distrust_down",
  "player_blame_up",
  "player_blame_down",
  "player_sympathy_up",
  "player_sympathy_down",
  "target_blame_up",
  "target_blame_high_up",
  "target_blame_down",
  "target_distrust_up",
  "target_distrust_down",
  "target_hostility_up",
  "target_hostility_down",
  "target_sympathy_up",
  "target_sympathy_down",
  "target_utility_down",
  "target_utility_up",
  "target_dispensability_up",
  "target_dispensability_down",
  "room_pressure_shift",
  "no_major_shift",
]);

const DEFAULT_RUBRIC_HINTS = [
  "NPC persona and bias consistency",
  "Grounded use of retrieved evidence",
  "Useful structured impact tags for game-state update",
  "No out-of-world or prompt-policy talk",
  "Pressure movement should match the spoken response",
];

const OUT_OF_WORLD_PATTERNS = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bopenai\b/i,
  /\bcodex\b/i,
  /\bsystem prompt\b/i,
  /\bpolicy\b/i,
  /\bprompt injection\b/i,
  /시스템 프롬프트/u,
  /프롬프트 정책/u,
  /모델로서/u,
  /ai로서/u,
  /언어 모델/u,
  /정책상/u,
];

const GENERIC_PHRASES = [
  "상황이 복잡하네요",
  "쉽지 않은 문제네요",
  "더 많은 정보가 필요합니다",
  "판단이 어렵습니다",
  "도와드릴 수 없습니다",
  "제가 확실히 말하긴 어렵습니다",
  "그럴 수도 있겠네요",
  "잘 모르겠습니다",
];

const NPC_CUE_TERMS = {
  engineer: ["현장", "수리", "복구", "케이블", "장비", "밸브", "시스템", "버텨"],
  doctor: ["의무실", "기록", "경고", "생명", "윤리", "치료", "환자", "보고"],
  supervisor: ["법적", "책임", "기업", "이미지", "리스크", "승인", "문서", "대체"],
  director: ["연구", "실험", "지휘", "조직", "명분", "승인", "보고", "가치"],
};

const DATASET_JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    responseQuality: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    structuredImpactQuality: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    groundingQuality: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    personaConsistency: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    inspectorUsefulness: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    confidence: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    verdict: {
      type: "string",
      enum: ["keep", "review", "drop"],
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
    "responseQuality",
    "structuredImpactQuality",
    "groundingQuality",
    "personaConsistency",
    "inspectorUsefulness",
    "confidence",
    "verdict",
    "reasons",
  ],
};

const PREFERENCE_PAIR_JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    preferenceStrength: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    confidence: {
      type: "integer",
      minimum: 1,
      maximum: 5,
    },
    decision: {
      type: "string",
      enum: ["include", "flip", "exclude", "review"],
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
    "preferenceStrength",
    "confidence",
    "decision",
    "reasons",
  ],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values, digits = 2) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(digits));
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

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashFragment(value) {
  return Array.from(String(value ?? "")).reduce(
    (hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0,
    5381,
  ).toString(16);
}

function scoreToInteger(value) {
  return clamp(Math.round(value), 1, 5);
}

function buildSourceLabel(source) {
  const base = basenameLabel(source.path);
  if (source.lineNumber) {
    return `${base}:${source.lineNumber}`;
  }

  if (source.turnIndex !== null && source.turnIndex !== undefined) {
    return `${base}:turn-${source.turnIndex}`;
  }

  return base;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRelationshipDelta(value) {
  if (!isObject(value)) {
    return {
      trust: 0,
      affinity: 0,
      tension: 0,
    };
  }

  return {
    trust: Number(value.trust) || 0,
    affinity: Number(value.affinity) || 0,
    tension: Number(value.tension) || 0,
  };
}

function normalizeStructuredImpact(value) {
  if (!isObject(value)) {
    return {
      impactTags: [],
      targetNpcId: null,
      confidence: 0,
      rationale: "",
    };
  }

  return {
    impactTags: Array.isArray(value.impactTags)
      ? value.impactTags.map((entry) => String(entry))
      : [],
    targetNpcId:
      value.targetNpcId === null || typeof value.targetNpcId === "string"
        ? value.targetNpcId ?? null
        : null,
    confidence: Number.isFinite(Number(value.confidence))
      ? Number(value.confidence)
      : 0,
    rationale: typeof value.rationale === "string" ? value.rationale : "",
  };
}

function normalizePromptBundle(value) {
  const promptBundle = isObject(value) ? value : {};

  return {
    episodeId:
      typeof promptBundle.episodeId === "string" ? promptBundle.episodeId : null,
    scenarioId:
      typeof promptBundle.scenarioId === "string"
        ? promptBundle.scenarioId
        : "unknown-scenario",
    turnIndex:
      Number.isInteger(promptBundle.turnIndex) ? promptBundle.turnIndex : null,
    npcId: typeof promptBundle.npcId === "string" ? promptBundle.npcId : "unknown",
    targetNpcId:
      promptBundle.targetNpcId === null || typeof promptBundle.targetNpcId === "string"
        ? promptBundle.targetNpcId ?? null
        : null,
    inputMode:
      promptBundle.inputMode === "action" ? "action" : "free_text",
    playerText:
      typeof promptBundle.playerText === "string" ? promptBundle.playerText : "",
    normalizedInputSummary:
      typeof promptBundle.normalizedInputSummary === "string"
        ? promptBundle.normalizedInputSummary
        : typeof promptBundle.playerText === "string"
          ? promptBundle.playerText
          : "",
    retrievedMemories: Array.isArray(promptBundle.retrievedMemories)
      ? promptBundle.retrievedMemories
      : [],
    retrievedKnowledge: Array.isArray(promptBundle.retrievedKnowledge)
      ? promptBundle.retrievedKnowledge
      : [],
    promptContextSummary:
      typeof promptBundle.promptContextSummary === "string"
        ? promptBundle.promptContextSummary
        : null,
  };
}

function normalizeCandidateOutput(value) {
  const output = isObject(value) ? value : {};
  const selectedAction = output.selectedAction;
  const actionType =
    typeof selectedAction === "string"
      ? selectedAction
      : isObject(selectedAction) && typeof selectedAction.type === "string"
        ? selectedAction.type
        : "";
  const actionReason =
    typeof output.selectedActionReason === "string"
      ? output.selectedActionReason
      : isObject(selectedAction) && typeof selectedAction.reason === "string"
        ? selectedAction.reason
        : "";

  return {
    replyText: typeof output.replyText === "string" ? output.replyText : "",
    selectedAction: actionType,
    selectedActionReason: actionReason,
    structuredImpact: normalizeStructuredImpact(output.structuredImpact),
  };
}

function buildBaseRecord(params) {
  const promptBundle = normalizePromptBundle(params.promptBundle);
  const source = {
    kind: params.source.kind,
    path: params.source.path,
    basename: basenameLabel(params.source.path),
    lineNumber: params.source.lineNumber ?? null,
    turnIndex:
      params.source.turnIndex ?? promptBundle.turnIndex ?? null,
  };
  const rowIdSeed = [
    source.kind,
    source.path,
    source.lineNumber ?? "line",
    promptBundle.episodeId ?? "episode",
    promptBundle.turnIndex ?? "turn",
    promptBundle.npcId,
    promptBundle.playerText,
  ].join("|");

  return {
    rowId:
      typeof params.rowId === "string" && params.rowId
        ? params.rowId
        : `${promptBundle.scenarioId}:${promptBundle.npcId}:${hashFragment(rowIdSeed)}`,
    source: {
      ...source,
      label: buildSourceLabel(source),
    },
    promptBundle,
    candidateOutput: normalizeCandidateOutput(params.candidateOutput),
    metadata: {
      relationshipDelta: normalizeRelationshipDelta(
        params.metadata?.relationshipDelta,
      ),
      pressureChanges: Array.isArray(params.metadata?.pressureChanges)
        ? params.metadata.pressureChanges
        : [],
      resolutionAfter: isObject(params.metadata?.resolutionAfter)
        ? params.metadata.resolutionAfter
        : null,
    },
    rubricHints:
      Array.isArray(params.rubricHints) && params.rubricHints.length
        ? params.rubricHints.map((entry) => String(entry))
        : [...DEFAULT_RUBRIC_HINTS],
    filter: isObject(params.filter) ? params.filter : null,
    judge: isObject(params.judge) ? params.judge : null,
  };
}

function normalizeExistingRecord(raw, source) {
  return buildBaseRecord({
    rowId: raw.rowId,
    source: {
      kind: typeof raw.source?.kind === "string" ? raw.source.kind : source.kind,
      path: typeof raw.source?.path === "string" ? raw.source.path : source.path,
      lineNumber:
        Number.isInteger(raw.source?.lineNumber) ? raw.source.lineNumber : source.lineNumber,
      turnIndex:
        Number.isInteger(raw.source?.turnIndex) ? raw.source.turnIndex : source.turnIndex,
    },
    promptBundle: raw.promptBundle,
    candidateOutput: raw.candidateOutput,
    metadata: raw.metadata,
    rubricHints: raw.rubricHints,
    filter: raw.filter,
    judge: raw.judge,
  });
}

function normalizeReviewRow(raw, source) {
  return buildBaseRecord({
    source,
    promptBundle: raw.promptBundle,
    candidateOutput: raw.currentChosenOutput,
    metadata: raw.metadata,
    rubricHints: raw.rubricHints,
  });
}

function normalizeSftRow(raw, source) {
  return buildBaseRecord({
    source,
    promptBundle: raw.input,
    candidateOutput: {
      replyText: raw.assistant?.replyText,
      selectedAction: raw.assistant?.selectedAction?.type,
      selectedActionReason: raw.assistant?.selectedAction?.reason,
      structuredImpact: raw.assistant?.structuredImpact,
    },
    metadata: raw.metadata,
  });
}

function normalizeEpisodeTurn(rawEpisode, turn, index, source) {
  return buildBaseRecord({
    source: {
      ...source,
      turnIndex: index,
    },
    promptBundle: {
      episodeId: rawEpisode.episode?.episodeId ?? null,
      scenarioId: rawEpisode.episode?.scenarioId ?? "unknown-scenario",
      turnIndex: turn.turnIndex ?? index,
      npcId: turn.npcId,
      targetNpcId: turn.targetNpcId ?? null,
      inputMode: turn.inputMode,
      playerText: turn.rawPlayerText ?? "",
      normalizedInputSummary: turn.normalizedInputSummary ?? turn.rawPlayerText ?? "",
      retrievedMemories: turn.retrievedMemories ?? [],
      retrievedKnowledge: turn.retrievedKnowledge ?? [],
      promptContextSummary: turn.llmPromptContextSummary ?? null,
    },
    candidateOutput: {
      replyText: turn.modelReplyText,
      selectedAction:
        typeof turn.selectedAction === "string"
          ? turn.selectedAction
          : turn.selectedAction?.type,
      selectedActionReason:
        typeof turn.selectedAction === "string"
          ? ""
          : turn.selectedAction?.reason ?? "",
      structuredImpact: turn.structuredImpact,
    },
    metadata: {
      relationshipDelta: turn.relationshipDelta,
      pressureChanges: turn.pressureChanges,
      resolutionAfter: turn.resolutionAfter,
    },
  });
}

function normalizeRawEntry(raw, source) {
  if (!isObject(raw)) {
    throw new Error(`${source.path} contains a non-object row`);
  }

  if (isObject(raw.promptBundle) && isObject(raw.candidateOutput)) {
    return normalizeExistingRecord(raw, source);
  }

  if (isObject(raw.promptBundle) && isObject(raw.currentChosenOutput)) {
    return normalizeReviewRow(raw, source);
  }

  if (isObject(raw.input) && isObject(raw.assistant)) {
    return normalizeSftRow(raw, source);
  }

  throw new Error(
    `${source.path} does not match a supported dataset row shape at ${buildSourceLabel(source)}`,
  );
}

function collectEvidenceTerms(record) {
  const rawTerms = [];

  for (const memory of record.promptBundle.retrievedMemories) {
    rawTerms.push(memory.summary);
    rawTerms.push(...(Array.isArray(memory.tags) ? memory.tags : []));
  }

  for (const evidence of record.promptBundle.retrievedKnowledge) {
    rawTerms.push(evidence.title);
    rawTerms.push(evidence.summary);
    rawTerms.push(...(Array.isArray(evidence.tags) ? evidence.tags : []));
  }

  return uniqueStrings(
    rawTerms
      .flatMap((entry) => String(entry ?? "").split(/[,\n]/u))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 2),
  );
}

function countSubstringHits(text, candidates) {
  const normalizedText = String(text ?? "").toLowerCase();

  return uniqueStrings(candidates)
    .filter((candidate) => candidate.length >= 2)
    .filter((candidate) => normalizedText.includes(candidate.toLowerCase()))
    .length;
}

function detectOutOfWorldLeakage(text) {
  const normalized = String(text ?? "");
  return OUT_OF_WORLD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function detectGenericResponse(text) {
  const normalized = String(text ?? "");
  if (normalized.trim().length < 35) {
    return true;
  }

  return GENERIC_PHRASES.some((phrase) => normalized.includes(phrase));
}

function getNpcCueTerms(npcId) {
  return NPC_CUE_TERMS[npcId] ?? [];
}

function isTargetImpactTag(tag) {
  return String(tag).startsWith("target_");
}

function findHardFailures(record) {
  const failures = [];
  const leakageText = [
    record.candidateOutput.replyText,
    record.candidateOutput.structuredImpact.rationale,
  ].join("\n");
  const structuredImpact = record.candidateOutput.structuredImpact;
  const retrievedEvidenceCount =
    record.promptBundle.retrievedMemories.length +
    record.promptBundle.retrievedKnowledge.length;
  const invalidImpactTags = structuredImpact.impactTags.filter(
    (tag) => !VALID_IMPACT_TAGS.has(tag),
  );

  if (!record.candidateOutput.replyText.trim()) {
    failures.push("reply text empty");
  }

  if (!record.candidateOutput.selectedAction) {
    failures.push("selectedAction missing");
  }

  if (
    record.candidateOutput.selectedAction &&
    !VALID_ACTIONS.has(record.candidateOutput.selectedAction)
  ) {
    failures.push("selectedAction invalid");
  }

  if (!structuredImpact || !isObject(structuredImpact)) {
    failures.push("structuredImpact missing");
  }

  if (!structuredImpact.impactTags.length) {
    failures.push("impactTags empty");
  }

  if (invalidImpactTags.length) {
    failures.push(`impactTags invalid (${invalidImpactTags.join(", ")})`);
  }

  if (
    structuredImpact.impactTags.some(isTargetImpactTag) &&
    !structuredImpact.targetNpcId
  ) {
    failures.push("target_* tag without targetNpcId");
  }

  if (detectOutOfWorldLeakage(leakageText)) {
    failures.push("obvious out-of-world leakage");
  }

  if (
    retrievedEvidenceCount > 0 &&
    (!structuredImpact.rationale.trim() ||
      !record.candidateOutput.selectedActionReason.trim())
  ) {
    failures.push("retrieved evidence exists but output fields are structurally broken");
  }

  return failures;
}

export function buildHeuristicQualityAnalysis(record) {
  const hardFailures = findHardFailures(record);
  const responseReasons = [];
  const structuredReasons = [];
  const groundingReasons = [];
  const personaReasons = [];
  const inspectorReasons = [];
  const structuredImpact = record.candidateOutput.structuredImpact;
  const responseText = record.candidateOutput.replyText.trim();
  const rationaleText = structuredImpact.rationale.trim();
  const combinedOutput = [responseText, rationaleText].join("\n");
  const pressureMagnitude = totalPressureDelta(record.metadata.pressureChanges);
  const evidenceTerms = collectEvidenceTerms(record);
  const evidenceHits = countSubstringHits(combinedOutput, evidenceTerms);
  const promptEchoHits = countSubstringHits(
    responseText,
    uniqueStrings([
      ...tokenize(record.promptBundle.playerText),
      ...tokenize(record.promptBundle.normalizedInputSummary),
    ]),
  );
  const personaCueHits = countSubstringHits(
    combinedOutput,
    getNpcCueTerms(record.promptBundle.npcId),
  );
  const retrievedEvidenceCount =
    record.promptBundle.retrievedMemories.length +
    record.promptBundle.retrievedKnowledge.length;
  const hasNoMajorShiftOnly =
    structuredImpact.impactTags.length === 1 &&
    structuredImpact.impactTags.includes("no_major_shift");

  let responseHeuristicScore = 3;
  if (responseText.length >= 60 && responseText.length <= 900) {
    responseHeuristicScore += 1;
    responseReasons.push("reply length is specific enough");
  } else if (responseText.length < 35) {
    responseHeuristicScore -= 2;
    responseReasons.push("reply is too short to carry scene pressure");
  } else if (responseText.length < 60) {
    responseHeuristicScore -= 1;
    responseReasons.push("reply is short");
  }
  if (promptEchoHits > 0) {
    responseHeuristicScore += 1;
    responseReasons.push("reply reacts directly to the player input");
  }
  if (detectGenericResponse(responseText)) {
    responseHeuristicScore -= 1;
    responseReasons.push("reply reads generic");
  }
  if (detectOutOfWorldLeakage(responseText)) {
    responseHeuristicScore -= 2;
    responseReasons.push("reply leaks meta/system language");
  }

  let structuredImpactHeuristicScore = 3;
  if (structuredImpact.impactTags.length >= 2 && structuredImpact.impactTags.length <= 5) {
    structuredImpactHeuristicScore += 1;
    structuredReasons.push("impact tags are populated with usable detail");
  }
  if (rationaleText.length >= 24) {
    structuredImpactHeuristicScore += 1;
    structuredReasons.push("impact rationale explains the choice");
  } else {
    structuredImpactHeuristicScore -= 1;
    structuredReasons.push("impact rationale is too thin");
  }
  if (record.candidateOutput.selectedActionReason.trim().length >= 16) {
    structuredImpactHeuristicScore += 1;
    structuredReasons.push("selectedActionReason explains the move");
  } else {
    structuredImpactHeuristicScore -= 1;
    structuredReasons.push("selectedActionReason is too short");
  }
  if (hasNoMajorShiftOnly && pressureMagnitude >= 24) {
    structuredImpactHeuristicScore -= 2;
    structuredReasons.push("no_major_shift conflicts with a large pressure delta");
  }
  if (
    structuredImpact.targetNpcId &&
    !structuredImpact.impactTags.some(isTargetImpactTag) &&
    !structuredImpact.impactTags.includes("room_pressure_shift")
  ) {
    structuredImpactHeuristicScore -= 1;
    structuredReasons.push("targetNpcId exists without target-oriented impact tags");
  }

  let groundingHeuristicScore = retrievedEvidenceCount > 0 ? 3 : 2;
  if (retrievedEvidenceCount > 0 && evidenceHits > 0) {
    groundingHeuristicScore += 1;
    groundingReasons.push("retrieved evidence appears in the reply or rationale");
  }
  if (retrievedEvidenceCount > 2 && evidenceHits > 1) {
    groundingHeuristicScore += 1;
    groundingReasons.push("multiple retrieved clues are reflected in the output");
  }
  if (retrievedEvidenceCount > 0 && evidenceHits === 0) {
    groundingHeuristicScore -= 1;
    groundingReasons.push("retrieved evidence is not visibly used");
  }
  if (
    record.promptBundle.promptContextSummary &&
    countSubstringHits(combinedOutput, [record.promptBundle.promptContextSummary]) > 0
  ) {
    groundingHeuristicScore += 1;
    groundingReasons.push("prompt context summary is reflected in the output");
  }

  let personaHeuristicScore = 3;
  if (personaCueHits > 0) {
    personaHeuristicScore += 1;
    personaReasons.push("reply uses NPC-specific role or bias cues");
  }
  if (personaCueHits > 1) {
    personaHeuristicScore += 1;
    personaReasons.push("multiple persona cues are present");
  }
  if (detectGenericResponse(responseText)) {
    personaHeuristicScore -= 1;
    personaReasons.push("generic phrasing weakens persona specificity");
  }
  if (detectOutOfWorldLeakage(combinedOutput)) {
    personaHeuristicScore -= 1;
    personaReasons.push("meta/system leakage breaks immersion");
  }

  let inspectorUsefulness = 3;
  if (record.candidateOutput.selectedActionReason.trim().length >= 20) {
    inspectorUsefulness += 1;
    inspectorReasons.push("selectedActionReason is audit-friendly");
  }
  if (rationaleText.length >= 28) {
    inspectorUsefulness += 1;
    inspectorReasons.push("impact rationale is usable for downstream review");
  }
  if (pressureMagnitude > 0 && structuredImpact.impactTags.includes("room_pressure_shift")) {
    inspectorUsefulness += 1;
    inspectorReasons.push("impact tags explain observed pressure movement");
  }
  if (!record.candidateOutput.selectedActionReason.trim()) {
    inspectorUsefulness -= 1;
    inspectorReasons.push("selectedActionReason is missing");
  }
  if (!rationaleText) {
    inspectorUsefulness -= 1;
    inspectorReasons.push("impact rationale is missing");
  }

  const heuristicScores = {
    responseHeuristicScore: scoreToInteger(responseHeuristicScore),
    structuredImpactHeuristicScore: scoreToInteger(structuredImpactHeuristicScore),
    groundingHeuristicScore: scoreToInteger(groundingHeuristicScore),
    personaHeuristicScore: scoreToInteger(personaHeuristicScore),
    inspectorUsefulness: scoreToInteger(inspectorUsefulness),
  };
  const aggregateScore =
    heuristicScores.responseHeuristicScore +
    heuristicScores.structuredImpactHeuristicScore +
    heuristicScores.groundingHeuristicScore +
    heuristicScores.personaHeuristicScore;
  const minAxisScore = Math.min(
    heuristicScores.responseHeuristicScore,
    heuristicScores.structuredImpactHeuristicScore,
    heuristicScores.groundingHeuristicScore,
    heuristicScores.personaHeuristicScore,
  );

  return {
    hardFailures,
    heuristicScores,
    aggregateScore,
    minAxisScore,
    evidenceStats: {
      retrievedEvidenceCount,
      evidenceHits,
      promptEchoHits,
      personaCueHits,
      pressureMagnitude,
    },
    reasonBuckets: {
      response: uniqueStrings(responseReasons),
      structuredImpact: uniqueStrings(structuredReasons),
      grounding: uniqueStrings(groundingReasons),
      persona: uniqueStrings(personaReasons),
      inspector: uniqueStrings(inspectorReasons),
    },
  };
}

export function classifyFilterDecision(analysis) {
  if (analysis.hardFailures.length) {
    return "drop";
  }

  if (analysis.aggregateScore >= 16 && analysis.minAxisScore >= 3) {
    return "keep";
  }

  if (analysis.aggregateScore <= 8 || analysis.minAxisScore <= 1) {
    return "drop";
  }

  return "review";
}

function pickJudgeReasons(analysis, verdict) {
  if (analysis.hardFailures.length) {
    return analysis.hardFailures.slice(0, 6);
  }

  const buckets = [
    ...analysis.reasonBuckets.structuredImpact,
    ...analysis.reasonBuckets.grounding,
    ...analysis.reasonBuckets.persona,
    ...analysis.reasonBuckets.response,
    ...analysis.reasonBuckets.inspector,
  ];

  if (verdict === "keep") {
    return uniqueStrings(
      buckets.filter((reason) =>
        [
          "usable",
          "specific",
          "explains",
          "present",
          "reflected",
          "audit-friendly",
        ].some((fragment) => reason.includes(fragment)),
      ),
    ).slice(0, 6);
  }

  return uniqueStrings(buckets).slice(0, 6);
}

export function buildHeuristicJudge(record) {
  const analysis = buildHeuristicQualityAnalysis(record);
  const responseQuality = analysis.heuristicScores.responseHeuristicScore;
  const structuredImpactQuality = analysis.heuristicScores.structuredImpactHeuristicScore;
  const groundingQuality = analysis.heuristicScores.groundingHeuristicScore;
  const personaConsistency = analysis.heuristicScores.personaHeuristicScore;
  const inspectorUsefulness = analysis.heuristicScores.inspectorUsefulness;
  const averageScore = average(
    [
      responseQuality,
      structuredImpactQuality,
      groundingQuality,
      personaConsistency,
    ],
    2,
  );
  let verdict = "review";

  if (analysis.hardFailures.length || averageScore <= 2.25 || analysis.minAxisScore <= 1) {
    verdict = "drop";
  } else if (
    averageScore >= 4 &&
    structuredImpactQuality >= 4 &&
    groundingQuality >= 3 &&
    personaConsistency >= 3
  ) {
    verdict = "keep";
  }

  let confidence = 3;
  if (analysis.hardFailures.length) {
    confidence = 5;
  } else if (verdict === "keep") {
    confidence =
      averageScore >= 4.5 &&
      structuredImpactQuality >= 4 &&
      groundingQuality >= 4 &&
      personaConsistency >= 4
        ? 5
        : 4;
  } else if (verdict === "drop") {
    confidence = averageScore <= 1.75 || analysis.minAxisScore <= 1 ? 5 : 4;
  } else if (Math.abs(averageScore - 3) >= 0.75) {
    confidence = 3;
  } else {
    confidence = 2;
  }

  return {
    responseQuality,
    structuredImpactQuality,
    groundingQuality,
    personaConsistency,
    inspectorUsefulness,
    confidence,
    verdict,
    reasons: pickJudgeReasons(analysis, verdict),
    analysis,
  };
}

function combineJudgeScores(heuristicJudge, llmJudge) {
  const responseQuality = scoreToInteger(
    (heuristicJudge.responseQuality + llmJudge.responseQuality) / 2,
  );
  const structuredImpactQuality = scoreToInteger(
    (heuristicJudge.structuredImpactQuality + llmJudge.structuredImpactQuality) / 2,
  );
  const groundingQuality = scoreToInteger(
    (heuristicJudge.groundingQuality + llmJudge.groundingQuality) / 2,
  );
  const personaConsistency = scoreToInteger(
    (heuristicJudge.personaConsistency + llmJudge.personaConsistency) / 2,
  );
  const inspectorUsefulness = scoreToInteger(
    (heuristicJudge.inspectorUsefulness + llmJudge.inspectorUsefulness) / 2,
  );
  const confidence = scoreToInteger(
    (heuristicJudge.confidence + llmJudge.confidence) / 2,
  );
  const averageScore = average(
    [
      responseQuality,
      structuredImpactQuality,
      groundingQuality,
      personaConsistency,
    ],
    2,
  );
  let verdict = "review";

  if (averageScore <= 2.25 || Math.min(
    responseQuality,
    structuredImpactQuality,
    groundingQuality,
    personaConsistency,
  ) <= 1) {
    verdict = "drop";
  } else if (
    averageScore >= 4 &&
    structuredImpactQuality >= 4 &&
    groundingQuality >= 3 &&
    personaConsistency >= 3
  ) {
    verdict = "keep";
  }

  return {
    responseQuality,
    structuredImpactQuality,
    groundingQuality,
    personaConsistency,
    inspectorUsefulness,
    confidence,
    verdict,
    reasons: uniqueStrings([
      ...(heuristicJudge.reasons ?? []),
      ...(llmJudge.reasons ?? []),
    ]).slice(0, 6),
  };
}

function stripCodeFence(text) {
  return String(text ?? "")
    .replace(/^```json\s*/iu, "")
    .replace(/```$/u, "")
    .trim();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getEvalModelCandidates(explicitModel) {
  if (explicitModel) {
    return [explicitModel];
  }

  return uniqueStrings([
    process.env.EVAL_MODEL,
    process.env.PREMIUM_MODEL,
    process.env.OPENAI_MODEL,
    "gpt-5.4",
    process.env.EVAL_FALLBACK_MODEL,
    process.env.PREMIUM_FALLBACK_MODEL,
    process.env.LOW_COST_FALLBACK_MODEL,
    "gpt-4.1-nano",
  ]);
}

function extractOpenAiOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textChunks =
    payload?.output
      ?.flatMap((entry) => entry.content ?? [])
      .filter((entry) => entry.type === "output_text" && typeof entry.text === "string")
      .map((entry) => entry.text.trim())
      .filter(Boolean) ?? [];

  return textChunks.join("\n").trim();
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timeoutMs = options.timeoutMs ?? 120000;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }

    child.stdin.end();
  });
}

async function runCodexStructuredPrompt(params) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "npc-sim-quality-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "output.json");

  try {
    await fs.writeFile(
      schemaPath,
      JSON.stringify(params.jsonSchema, null, 2),
      "utf8",
    );

    const result = await runCommand(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        process.cwd(),
        "-m",
        params.model,
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        "-",
      ],
      {
        stdin: `${params.systemPrompt}\n\n${params.userPrompt}`,
        timeoutMs: params.timeoutMs,
      },
    );

    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "codex exec returned a non-zero exit code");
    }

    const outputText = await fs.readFile(outputPath, "utf8");
    const parsed = safeJsonParse(stripCodeFence(outputText));

    if (!parsed) {
      throw new Error("Codex structured output was not valid JSON");
    }

    return parsed;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runOpenAiStructuredPrompt(params) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for provider=openai");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: params.model,
      input: [
        {
          role: "system",
          content: params.systemPrompt,
        },
        {
          role: "user",
          content: params.userPrompt,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: params.schemaName,
          schema: params.jsonSchema,
          strict: true,
        },
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "OpenAI structured prompt request failed",
    );
  }

  const outputText = extractOpenAiOutputText(payload);
  const parsed = safeJsonParse(stripCodeFence(outputText));

  if (!parsed) {
    throw new Error("OpenAI structured output was not valid JSON");
  }

  return parsed;
}

export async function runStructuredLlmJudge(params) {
  const provider = params.provider === "openai" ? "openai" : "codex";
  const models = getEvalModelCandidates(params.model);
  let lastError = null;

  for (const model of models) {
    try {
      if (provider === "openai") {
        return await runOpenAiStructuredPrompt({
          ...params,
          provider,
          model,
        });
      }

      return await runCodexStructuredPrompt({
        ...params,
        provider,
        model,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("LLM judge failed with an unknown error.");
    }
  }

  throw lastError ?? new Error("LLM judge failed without an error message.");
}

function buildDatasetJudgePrompts(record) {
  const promptBundle = record.promptBundle;
  const output = record.candidateOutput;
  const pressureSummary = record.metadata.pressureChanges.map((entry) => ({
    candidateId: entry.candidateId,
    totalPressureDelta: entry.totalPressureDelta,
    reasons: entry.reasons ?? [],
  }));
  const retrievedKnowledge = promptBundle.retrievedKnowledge.slice(0, 6).map((entry) => ({
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
  }));
  const retrievedMemories = promptBundle.retrievedMemories.slice(0, 4).map((entry) => ({
    summary: entry.summary,
    tags: entry.tags,
  }));

  return {
    systemPrompt: [
      "You are reviewing a Korean NPC negotiation dataset row for training quality.",
      "Score strictly on five axes from 1 to 5.",
      "Favor grounded, persona-consistent, game-state-useful outputs.",
      "Use verdict keep/review/drop.",
      "Return only the requested JSON object.",
    ].join(" "),
    userPrompt: JSON.stringify(
      {
        rubricHints: record.rubricHints,
        promptBundle: {
          scenarioId: promptBundle.scenarioId,
          episodeId: promptBundle.episodeId,
          turnIndex: promptBundle.turnIndex,
          npcId: promptBundle.npcId,
          targetNpcId: promptBundle.targetNpcId,
          inputMode: promptBundle.inputMode,
          playerText: promptBundle.playerText,
          normalizedInputSummary: promptBundle.normalizedInputSummary,
          promptContextSummary: promptBundle.promptContextSummary,
          retrievedKnowledge,
          retrievedMemories,
        },
        candidateOutput: output,
        pressureSummary,
      },
      null,
      2,
    ),
  };
}

function sanitizeDatasetJudgeResult(raw) {
  return {
    responseQuality: scoreToInteger(raw?.responseQuality ?? 0),
    structuredImpactQuality: scoreToInteger(raw?.structuredImpactQuality ?? 0),
    groundingQuality: scoreToInteger(raw?.groundingQuality ?? 0),
    personaConsistency: scoreToInteger(raw?.personaConsistency ?? 0),
    inspectorUsefulness: scoreToInteger(raw?.inspectorUsefulness ?? 0),
    confidence: scoreToInteger(raw?.confidence ?? 3),
    verdict:
      raw?.verdict === "keep" || raw?.verdict === "drop" ? raw.verdict : "review",
    reasons: Array.isArray(raw?.reasons)
      ? raw.reasons.map((entry) => String(entry)).slice(0, 6)
      : ["LLM judge did not provide reasons"],
  };
}

export async function runDatasetJudge(record, options = {}) {
  const mode = options.mode === "llm" || options.mode === "hybrid"
    ? options.mode
    : "heuristic";
  const provider = options.provider === "openai" ? "openai" : "codex";
  const heuristic = buildHeuristicJudge(record);

  if (mode === "heuristic") {
    return {
      heuristic,
      llm: null,
      final: {
        responseQuality: heuristic.responseQuality,
        structuredImpactQuality: heuristic.structuredImpactQuality,
        groundingQuality: heuristic.groundingQuality,
        personaConsistency: heuristic.personaConsistency,
        inspectorUsefulness: heuristic.inspectorUsefulness,
        confidence: heuristic.confidence,
        verdict: heuristic.verdict,
        reasons: heuristic.reasons,
      },
      llmSkipped: false,
      llmError: null,
    };
  }

  if (options.dryRun) {
    return {
      heuristic,
      llm: null,
      final: {
        responseQuality: heuristic.responseQuality,
        structuredImpactQuality: heuristic.structuredImpactQuality,
        groundingQuality: heuristic.groundingQuality,
        personaConsistency: heuristic.personaConsistency,
        inspectorUsefulness: heuristic.inspectorUsefulness,
        confidence: heuristic.confidence,
        verdict: heuristic.verdict,
        reasons: uniqueStrings([
          ...heuristic.reasons,
          "LLM judge skipped because --dry-run was enabled",
        ]).slice(0, 6),
      },
      llmSkipped: true,
      llmError: null,
    };
  }

  try {
    const prompts = buildDatasetJudgePrompts(record);
    const rawLlm = await runStructuredLlmJudge({
      provider,
      model: options.model,
      schemaName: "dataset_quality_judge",
      jsonSchema: DATASET_JUDGE_JSON_SCHEMA,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
    });
    const llm = sanitizeDatasetJudgeResult(rawLlm);
    const final = mode === "llm" ? llm : combineJudgeScores(heuristic, llm);

    return {
      heuristic,
      llm,
      final,
      llmSkipped: false,
      llmError: null,
    };
  } catch (error) {
    return {
      heuristic,
      llm: null,
      final: {
        responseQuality: heuristic.responseQuality,
        structuredImpactQuality: heuristic.structuredImpactQuality,
        groundingQuality: heuristic.groundingQuality,
        personaConsistency: heuristic.personaConsistency,
        inspectorUsefulness: heuristic.inspectorUsefulness,
        confidence: heuristic.confidence,
        verdict: heuristic.verdict,
        reasons: uniqueStrings([
          ...heuristic.reasons,
          `LLM judge failed: ${errorMessage(error)}`,
        ]).slice(0, 6),
      },
      llmSkipped: false,
      llmError: errorMessage(error),
    };
  }
}

export function buildHeuristicPreferencePairJudge(pair) {
  const chosenScore = Number(pair?.chosenCandidate?.scores?.weightedScore) || 0;
  const rejectedScore = Number(pair?.rejectedCandidate?.scores?.weightedScore) || 0;
  const weightedGap =
    typeof pair?.weightedGap === "number" && Number.isFinite(pair.weightedGap)
      ? pair.weightedGap
      : chosenScore - rejectedScore;
  const pairReason = Array.isArray(pair?.pairReason)
    ? pair.pairReason.map((entry) => String(entry))
    : [];
  const chosenText = String(pair?.chosenCandidate?.candidateOutput?.replyText ?? "").trim();
  const rejectedText = String(pair?.rejectedCandidate?.candidateOutput?.replyText ?? "").trim();
  let preferenceStrength = 2;
  let confidence = 2;
  let decision = "review";
  const reasons = [];

  if (!chosenText || !rejectedText) {
    return {
      preferenceStrength: 1,
      confidence: 5,
      decision: "exclude",
      reasons: ["pair has an empty candidate response"],
    };
  }

  if (chosenText === rejectedText) {
    return {
      preferenceStrength: 1,
      confidence: 5,
      decision: "exclude",
      reasons: ["chosen and rejected replies are identical"],
    };
  }

  if (weightedGap <= 0) {
    preferenceStrength = 1;
    confidence = 4;
    decision = "flip";
  } else if (weightedGap >= 6) {
    preferenceStrength = 5;
    confidence = 5;
    decision = "include";
  } else if (weightedGap >= 4) {
    preferenceStrength = 4;
    confidence = 4;
    decision = "include";
  } else if (weightedGap >= 2) {
    preferenceStrength = 3;
    confidence = 3;
    decision = "include";
  } else if (weightedGap >= 1) {
    preferenceStrength = 2;
    confidence = 2;
    decision = "review";
  }

  reasons.push(...pairReason.slice(0, 4));
  if (!reasons.length) {
    reasons.push(
      decision === "include"
        ? "chosen weighted score is higher"
        : decision === "flip"
          ? "rejected weighted score is higher"
          : "pair gap is too small for automatic approval",
    );
  }

  return {
    preferenceStrength,
    confidence,
    decision,
    reasons: uniqueStrings(reasons).slice(0, 6),
  };
}

function buildPreferencePairJudgePrompts(pair) {
  return {
    systemPrompt: [
      "You are reviewing a Korean DPO preference pair for an NPC negotiation dataset.",
      "Decide whether chosen should remain preferred, be flipped, be excluded, or be sent to review.",
      "Score preferenceStrength and confidence from 1 to 5.",
      "Favor natural Korean, grounding, persona consistency, and useful structured impact.",
      "Return only the requested JSON object.",
    ].join(" "),
    userPrompt: JSON.stringify(
      {
        grouping: pair.grouping ?? null,
        promptBundle: pair.promptBundle,
        pairReason: pair.pairReason ?? [],
        weightedGap: pair.weightedGap ?? null,
        chosenCandidate: {
          scores: pair.chosenCandidate?.scores ?? null,
          candidateOutput: pair.chosenCandidate?.candidateOutput ?? null,
        },
        rejectedCandidate: {
          scores: pair.rejectedCandidate?.scores ?? null,
          candidateOutput: pair.rejectedCandidate?.candidateOutput ?? null,
        },
      },
      null,
      2,
    ),
  };
}

function sanitizePreferencePairJudgeResult(raw) {
  return {
    preferenceStrength: scoreToInteger(raw?.preferenceStrength ?? 0),
    confidence: scoreToInteger(raw?.confidence ?? 3),
    decision:
      raw?.decision === "include" ||
      raw?.decision === "flip" ||
      raw?.decision === "exclude"
        ? raw.decision
        : "review",
    reasons: Array.isArray(raw?.reasons)
      ? raw.reasons.map((entry) => String(entry)).slice(0, 6)
      : ["LLM pair judge did not provide reasons"],
  };
}

function combinePreferencePairJudgeScores(heuristicJudge, llmJudge) {
  const preferenceStrength = scoreToInteger(
    (heuristicJudge.preferenceStrength + llmJudge.preferenceStrength) / 2,
  );
  const confidence = scoreToInteger(
    (heuristicJudge.confidence + llmJudge.confidence) / 2,
  );
  let decision = llmJudge.decision;

  if (llmJudge.decision !== heuristicJudge.decision && confidence <= 3) {
    decision = "review";
  } else if (llmJudge.decision === "review") {
    decision = heuristicJudge.decision;
  }

  return {
    preferenceStrength,
    confidence,
    decision,
    reasons: uniqueStrings([
      ...(heuristicJudge.reasons ?? []),
      ...(llmJudge.reasons ?? []),
    ]).slice(0, 6),
  };
}

export async function runPreferencePairJudge(pair, options = {}) {
  const mode = options.mode === "heuristic" ? "heuristic" : options.mode === "hybrid" ? "hybrid" : "llm";
  const provider = options.provider === "openai" ? "openai" : "codex";
  const heuristic = buildHeuristicPreferencePairJudge(pair);

  if (mode === "heuristic") {
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
          "LLM pair judge skipped because --dry-run was enabled",
        ]).slice(0, 6),
      },
      llmSkipped: true,
      llmError: null,
    };
  }

  try {
    const prompts = buildPreferencePairJudgePrompts(pair);
    const rawLlm = await runStructuredLlmJudge({
      provider,
      model: options.model,
      schemaName: "preference_pair_judge",
      jsonSchema: PREFERENCE_PAIR_JUDGE_JSON_SCHEMA,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
    });
    const llm = sanitizePreferencePairJudgeResult(rawLlm);
    const final = mode === "hybrid" ? combinePreferencePairJudgeScores(heuristic, llm) : llm;

    return {
      heuristic,
      llm,
      final,
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
          `LLM pair judge failed: ${errorMessage(error)}`,
        ]).slice(0, 6),
      },
      llmSkipped: false,
      llmError: errorMessage(error),
    };
  }
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

export async function loadNormalizedRows(params = {}) {
  const patterns = parseCommaSeparatedOption(params.input);
  const inputPatterns = patterns.length
    ? patterns
    : params.defaultPatterns ?? [];
  const files = uniqueStrings(
    (
      await Promise.all(
        inputPatterns.map((pattern) => expandPattern(pattern)),
      )
    ).flat(),
  );
  const rows = [];

  for (const filePath of files) {
    const payload = await loadJsonOrJsonl(filePath);
    const extension = path.extname(filePath).toLowerCase();

    if (extension === ".jsonl") {
      payload.forEach((entry, index) => {
        rows.push(
          normalizeRawEntry(entry, {
            kind: "jsonl-row",
            path: filePath,
            lineNumber: index + 1,
          }),
        );
      });
      continue;
    }

    if (isObject(payload) && isObject(payload.episode) && Array.isArray(payload.turns)) {
      payload.turns.forEach((turn, index) => {
        rows.push(
          normalizeEpisodeTurn(payload, turn, index, {
            kind: "episode-turn",
            path: filePath,
          }),
        );
      });
      continue;
    }

    if (Array.isArray(payload)) {
      payload.forEach((entry, index) => {
        rows.push(
          normalizeRawEntry(entry, {
            kind: "json-array-row",
            path: filePath,
            lineNumber: index + 1,
          }),
        );
      });
      continue;
    }

    throw new Error(`${filePath} is not a supported dataset input file`);
  }

  return {
    files,
    rows,
  };
}

export async function writeJsonLines(targetPath, rows) {
  await initializeOutputFile(targetPath);

  for (const row of rows) {
    await appendJsonLine(targetPath, row);
  }

  return resolveProjectPath(targetPath);
}

export async function writeSummaryJson(targetPath, payload) {
  return writeJsonFile(targetPath, payload);
}

export function summarizeFilterRun(params) {
  const decisions = {
    keep: 0,
    review: 0,
    drop: 0,
  };
  const axisTotals = {
    responseHeuristicScore: [],
    structuredImpactHeuristicScore: [],
    groundingHeuristicScore: [],
    personaHeuristicScore: [],
    inspectorUsefulness: [],
  };
  const hardFailureCounts = {};

  for (const result of params.results) {
    decisions[result.filter.decision] += 1;
    for (const [key, value] of Object.entries(result.filter.heuristicScores)) {
      axisTotals[key].push(value);
    }
    for (const failure of result.filter.hardFailures) {
      hardFailureCounts[failure] = (hardFailureCounts[failure] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    inputFiles: params.inputFiles.map((filePath) => path.relative(process.cwd(), filePath)),
    processedCount: params.results.length,
    decisions,
    averageHeuristicScores: Object.fromEntries(
      Object.entries(axisTotals).map(([key, values]) => [key, average(values)]),
    ),
    hardFailureCounts,
    outputFiles: params.outputFiles,
  };
}

export function summarizeJudgeRun(params) {
  const verdicts = {
    keep: 0,
    review: 0,
    drop: 0,
  };
  const finalScores = {
    responseQuality: [],
    structuredImpactQuality: [],
    groundingQuality: [],
    personaConsistency: [],
    inspectorUsefulness: [],
    confidence: [],
  };
  const heuristicScores = {
    responseQuality: [],
    structuredImpactQuality: [],
    groundingQuality: [],
    personaConsistency: [],
    inspectorUsefulness: [],
    confidence: [],
  };
  const llmScores = {
    responseQuality: [],
    structuredImpactQuality: [],
    groundingQuality: [],
    personaConsistency: [],
    inspectorUsefulness: [],
    confidence: [],
  };
  let llmFailureCount = 0;
  let llmSkippedCount = 0;

  for (const result of params.results) {
    verdicts[result.judge.final.verdict] += 1;
    for (const key of Object.keys(finalScores)) {
      finalScores[key].push(result.judge.final[key]);
      heuristicScores[key].push(result.judge.heuristic[key]);
      if (result.judge.llm) {
        llmScores[key].push(result.judge.llm[key]);
      }
    }
    if (result.judge.llmError) {
      llmFailureCount += 1;
    }
    if (result.judge.llmSkipped) {
      llmSkippedCount += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    inputFiles: params.inputFiles.map((filePath) => path.relative(process.cwd(), filePath)),
    processedCount: params.results.length,
    mode: params.mode,
    provider: params.provider,
    verdicts,
    llmFailureCount,
    llmSkippedCount,
    averageFinalScores: Object.fromEntries(
      Object.entries(finalScores).map(([key, values]) => [key, average(values)]),
    ),
    averageHeuristicScores: Object.fromEntries(
      Object.entries(heuristicScores).map(([key, values]) => [key, average(values)]),
    ),
    averageLlmScores: Object.fromEntries(
      Object.entries(llmScores).map(([key, values]) => [key, average(values)]),
    ),
    outputFiles: params.outputFiles,
  };
}

export function resolvePromptKeys(record) {
  const prompt = record.promptBundle;
  const normalizedText = prompt.normalizedInputSummary || prompt.playerText;
  return {
    exactPromptKey: [
      prompt.scenarioId,
      prompt.npcId,
      prompt.targetNpcId ?? "none",
      prompt.inputMode,
      normalizedText,
    ].join("|"),
    similarSituationKey: [
      prompt.scenarioId,
      prompt.npcId,
      prompt.targetNpcId ?? "none",
      prompt.inputMode,
    ].join("|"),
  };
}

export function rankJudgedRecord(record) {
  const fallbackJudge = buildHeuristicJudge(record);
  const rawFinalJudge = record.judge?.final ?? fallbackJudge;
  const finalJudge = {
    ...rawFinalJudge,
    confidence: scoreToInteger(rawFinalJudge.confidence ?? fallbackJudge.confidence ?? 3),
  };
  const weightedScore =
    finalJudge.structuredImpactQuality * 4 +
    finalJudge.personaConsistency * 3 +
    finalJudge.groundingQuality * 2 +
    finalJudge.responseQuality +
    finalJudge.inspectorUsefulness;

  return {
    finalJudge,
    weightedScore,
  };
}

export { DATASET_JUDGE_JSON_SCHEMA, PREFERENCE_PAIR_JUDGE_JSON_SCHEMA };
