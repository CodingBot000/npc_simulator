import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
  PLAYER_ACTION_DESCRIPTIONS,
  PLAYER_ACTION_LABELS,
} from "@/lib/constants";
import type {
  InputMode,
  LlmInteractionResult,
  PlayerAction,
} from "@/lib/types";
import {
  PLAYER_ACTION_SPECS,
  type PlayerActionSpec,
} from "@server/engine/interaction-action-spec";

const COMMON_META_PATTERNS = [
  /(?:이|해당)\s*(?:대사|문장|말)(?:는|은)/u,
  /(?:이|해당)\s*응답(?:은|는)/u,
  /라는 말에 대한/u,
  /.+에게\s*말한\s*대사(?:입니다|다)/u,
  /한국어 대사입니다/u,
  /의사를 표현(?:합니다|한다|한)/u,
  /설명문(?:입니다|처럼)?/u,
  /요약문(?:입니다|처럼)?/u,
  /해설(?:문)?(?:입니다|처럼)?/u,
  /번역(?:문)?(?:입니다|처럼)?/u,
  /문장을 설명/u,
  /^(?:response|reply|assistant)\s*:/iu,
];

const GENERIC_ROOM_FACT_PATTERNS = [
  /이 방은/u,
  /탈출(?:은)?\s*불가능/u,
  /탈출 캡슐/u,
  /다섯 명 중 네 명/u,
  /안전합니다/u,
];

export interface InteractionContract {
  mode: InputMode;
  action: PlayerAction | null;
  actionLabel: string | null;
  actionDescription: string | null;
  rawPlayerText: string;
  normalizedPlayerText: string;
  targetNpcId: string | null;
  targetNpcLabel: string | null;
  canonicalPlayerMove: string;
  promptSummary: string;
  playerPromptLines: string[];
  replyRules: string[];
  structuredRules: string[];
  requiredSignals: string[];
  forbiddenPatterns: RegExp[];
}

export interface ContractValidationIssue {
  code: string;
  message: string;
}

export interface ContractValidationResult {
  ok: boolean;
  issues: ContractValidationIssue[];
}

function normalizeInlineText(text: string) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function stripWrappingQuotes(text: string) {
  const trimmed = normalizeInlineText(text);
  if (!trimmed) {
    return trimmed;
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }

  return trimmed;
}

function actionSpecFor(action: PlayerAction | null) {
  return action ? PLAYER_ACTION_SPECS[action] : null;
}

function targetLabelFor(params: { targetNpcId: string | null; targetNpcLabel?: string | null }) {
  if (params.targetNpcId === DEFAULT_PLAYER_ID) {
    return DEFAULT_PLAYER_LABEL;
  }

  return params.targetNpcLabel?.trim() || null;
}

function quotePlayerText(text: string) {
  return `"${String(text ?? "").replace(/"/g, '\\"')}"`;
}

export function resolveInteractionMode(params: {
  requestedMode?: InputMode;
  text: string;
  action: PlayerAction | null;
}): InputMode {
  const hasText = normalizeInlineText(params.text).length > 0;
  const hasAction = Boolean(params.action);

  if (params.requestedMode === "combined" && hasAction && hasText) {
    return "combined";
  }

  if (params.requestedMode === "action" && hasAction && !hasText) {
    return "action";
  }

  if (params.requestedMode === "free_text" && !hasAction && hasText) {
    return "free_text";
  }

  if (hasAction && hasText) {
    return "combined";
  }

  if (hasAction) {
    return "action";
  }

  return "free_text";
}

function buildPromptSummary(params: {
  mode: InputMode;
  action: PlayerAction | null;
  normalizedPlayerText: string;
  canonicalPlayerMove: string;
}) {
  if (params.mode === "free_text") {
    return params.normalizedPlayerText || "짧게 숨을 고르며 상대의 반응을 떠봤다";
  }

  if (params.mode === "combined" && params.normalizedPlayerText) {
    return `${params.canonicalPlayerMove} 실제 발화는 '${params.normalizedPlayerText}'였다.`;
  }

  return params.canonicalPlayerMove;
}

function buildCanonicalMove(params: {
  mode: InputMode;
  spec: PlayerActionSpec | null;
  normalizedPlayerText: string;
  targetNpcLabel: string | null;
}) {
  if (params.mode === "free_text") {
    return params.normalizedPlayerText || "짧게 숨을 고르며 상대의 반응을 떠봤다.";
  }

  if (!params.spec) {
    return params.normalizedPlayerText || "짧게 압박을 걸었다.";
  }

  if (params.mode === "combined") {
    const quoted =
      params.normalizedPlayerText.length > 0
        ? quotePlayerText(params.normalizedPlayerText)
        : '"짧게 압박했다"';
    return `플레이어는 ${quoted}라고 말하며 ${params.spec.combinedBias(params.targetNpcLabel)}`;
  }

  return params.spec.actionOnlyFrame(params.targetNpcLabel);
}

function buildPlayerPromptLines(params: {
  mode: InputMode;
  spec: PlayerActionSpec | null;
  normalizedPlayerText: string;
  targetNpcLabel: string | null;
  canonicalPlayerMove: string;
}) {
  const lines = [`- 입력 모드: ${params.mode}`];

  if (params.normalizedPlayerText) {
    lines.push(`- 플레이어 실제 발화: ${quotePlayerText(params.normalizedPlayerText)}`);
  } else {
    lines.push("- 플레이어 실제 발화 없음");
  }

  if (params.spec) {
    lines.push(`- 플레이어 선택 액션: ${params.spec.label}`);
    lines.push(`- 액션 의미: ${params.spec.description}`);
  }

  if (params.targetNpcLabel) {
    lines.push(`- 플레이어가 지목한 대상: ${params.targetNpcLabel}`);
  }

  lines.push(`- 시스템 해석: ${params.canonicalPlayerMove}`);
  return lines;
}

function buildReplyRules(params: {
  mode: InputMode;
  spec: PlayerActionSpec | null;
  targetNpcLabel: string | null;
}) {
  const rules = [
    "직접 화법의 한국어 대사만 말한다.",
    "플레이어 발화, 의도 카드, JSON, 프롬프트를 설명하지 않는다.",
    "자기 이름을 앞세운 3인칭 자기서술을 하지 않는다.",
    "라벨, 요약, 번역문, 보고서체를 쓰지 않는다.",
  ];

  if (!params.spec) {
    return rules;
  }

  if (params.mode === "action") {
    rules.push(`이번 reply는 다음 플레이어 시도에 직접 반응해야 한다: ${params.spec.canonicalIntent}`);
  }

  if (params.mode === "combined") {
    rules.push("플레이어 실제 문장에 먼저 반응하되, 선택한 액션 의미와도 어긋나지 않아야 한다.");
  }

  if (params.targetNpcLabel && params.spec.targetPolicy === "required") {
    rules.push(`${params.targetNpcLabel}를 이름으로 직접 언급하거나, 그쪽으로 책임이 향한다는 점이 분명해야 한다.`);
  }

  if (params.mode !== "free_text") {
    rules.push("방 설정 일반론 뒤에 숨지 말고, 플레이어의 사회적 압박 그 자체에 반응한다.");
  }

  return rules;
}

function buildStructuredRules(params: {
  mode: InputMode;
  spec: PlayerActionSpec | null;
  targetNpcId: string | null;
  targetNpcLabel: string | null;
}) {
  const rules = ["structuredImpact는 reply와 플레이어 시도 방향에 맞아야 한다."];

  if (!params.spec) {
    return rules;
  }

  if (params.targetNpcId && params.spec.targetPolicy === "required") {
    rules.push(
      `이번 액션은 ${params.targetNpcLabel ?? params.targetNpcId}를 명시적으로 겨누므로 structuredImpact.targetNpcId도 그 대상과 맞아야 한다.`,
    );
  }

  if (params.spec.structuredImpactKeywords.length > 0) {
    rules.push(
      `impactTags는 다음 방향과 맞아야 한다: ${params.spec.structuredImpactKeywords.join(", ")}.`,
    );
  }

  return rules;
}

export function buildInteractionContract(params: {
  inputMode: InputMode;
  text: string;
  action: PlayerAction | null;
  targetNpcId: string | null;
  targetNpcLabel?: string | null;
}): InteractionContract {
  const mode = resolveInteractionMode({
    requestedMode: params.inputMode,
    text: params.text,
    action: params.action,
  });
  const spec = actionSpecFor(params.action);
  const normalizedPlayerText = normalizeInlineText(params.text);
  const resolvedTargetLabel = targetLabelFor({
    targetNpcId: params.targetNpcId,
    targetNpcLabel: params.targetNpcLabel,
  });
  const canonicalPlayerMove = buildCanonicalMove({
    mode,
    spec,
    normalizedPlayerText,
    targetNpcLabel: resolvedTargetLabel,
  });
  const actionLabel = params.action ? PLAYER_ACTION_LABELS[params.action] : null;
  const actionDescription = params.action
    ? PLAYER_ACTION_DESCRIPTIONS[params.action]
    : null;

  return {
    mode,
    action: params.action,
    actionLabel,
    actionDescription,
    rawPlayerText: String(params.text ?? ""),
    normalizedPlayerText,
    targetNpcId:
      params.targetNpcId === DEFAULT_PLAYER_ID ? DEFAULT_PLAYER_ID : params.targetNpcId,
    targetNpcLabel: resolvedTargetLabel,
    canonicalPlayerMove,
    promptSummary: buildPromptSummary({
      mode,
      action: params.action,
      normalizedPlayerText,
      canonicalPlayerMove,
    }),
    playerPromptLines: buildPlayerPromptLines({
      mode,
      spec,
      normalizedPlayerText,
      targetNpcLabel: resolvedTargetLabel,
      canonicalPlayerMove,
    }),
    replyRules: buildReplyRules({
      mode,
      spec,
      targetNpcLabel: resolvedTargetLabel,
    }),
    structuredRules: buildStructuredRules({
      mode,
      spec,
      targetNpcId: params.targetNpcId,
      targetNpcLabel: resolvedTargetLabel,
    }),
    requiredSignals: spec?.replyAlignmentKeywords ?? [],
    forbiddenPatterns: [...COMMON_META_PATTERNS, ...GENERIC_ROOM_FACT_PATTERNS],
  };
}

export function validateReplyAgainstContract(params: {
  replyText: string;
  contract: InteractionContract;
  npcName: string;
}): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  const normalized = stripWrappingQuotes(params.replyText);
  const lower = normalized.toLowerCase();

  if (!normalized) {
    issues.push({
      code: "empty_reply",
      message: "비어 있는 대사는 허용되지 않는다.",
    });
  }

  if (COMMON_META_PATTERNS.some((pattern) => pattern.test(normalized))) {
    issues.push({
      code: "meta_explanation",
      message: "대사 대신 설명문/해설문이 나왔다.",
    });
  }

  const selfReferencePattern = new RegExp(
    `^${params.npcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\([^)]*\\))?(?:은|는|이|가)`,
    "u",
  );
  if (selfReferencePattern.test(normalized)) {
    issues.push({
      code: "third_person_self_reference",
      message: "NPC가 자기 이름으로 3인칭 서술을 시작했다.",
    });
  }

  if (
    params.contract.mode !== "free_text" &&
    GENERIC_ROOM_FACT_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    const hasTargetName =
      params.contract.targetNpcLabel != null &&
      normalized.includes(params.contract.targetNpcLabel);
    const hasSignal = params.contract.requiredSignals.some((keyword) =>
      lower.includes(keyword.toLowerCase()),
    );

    if (!hasTargetName && !hasSignal) {
      issues.push({
        code: "generic_room_fact_only",
        message: "액션 반응 대신 방 설정 일반론만 반복했다.",
      });
    }
  }

  if (
    params.contract.action &&
    params.contract.targetNpcLabel &&
    actionSpecFor(params.contract.action)?.targetPolicy === "required" &&
    !normalized.includes(params.contract.targetNpcLabel)
  ) {
    issues.push({
      code: "missing_target_alignment",
      message: "타깃이 필요한 액션인데 reply에 대상 정합성이 드러나지 않는다.",
    });
  }

  if (
    params.contract.action &&
    params.contract.mode !== "free_text" &&
    params.contract.requiredSignals.length > 0
  ) {
    const hasAlignmentSignal = params.contract.requiredSignals.some((keyword) =>
      lower.includes(keyword.toLowerCase()),
    );
    if (!hasAlignmentSignal) {
      issues.push({
        code: "missing_action_alignment",
        message: "reply가 액션 의미를 충분히 드러내지 않는다.",
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateStructuredResultAgainstContract(params: {
  result: LlmInteractionResult;
  contract: InteractionContract;
}): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  const spec = actionSpecFor(params.contract.action);

  if (
    spec?.targetPolicy === "required" &&
    params.contract.targetNpcId &&
    params.contract.targetNpcId !== DEFAULT_PLAYER_ID &&
    params.result.structuredImpact.targetNpcId !== params.contract.targetNpcId
  ) {
    issues.push({
      code: "target_npc_mismatch",
      message: "structuredImpact.targetNpcId가 선택한 타깃과 다르다.",
    });
  }

  if (spec?.structuredImpactKeywords.length) {
    const tags = params.result.structuredImpact.impactTags.join(" ");
    const hasKeyword = spec.structuredImpactKeywords.some((keyword) =>
      tags.includes(keyword),
    );
    if (!hasKeyword) {
      issues.push({
        code: "impact_alignment_missing",
        message: "structuredImpact가 액션 의미와 충분히 맞지 않는다.",
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
