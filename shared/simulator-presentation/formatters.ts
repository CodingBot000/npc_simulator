import type { components } from "@contracts/openapi-types";
import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
  NPC_ACTION_LABELS,
  PRESSURE_DIMENSION_LABELS,
} from "@sim-shared/constants";
import {
  PLAYER_ACTION_LABELS,
  PLAYER_ACTION_TARGET_MODES,
} from "@sim-presentation/player-actions";
import type {
  AllowedActionType,
  JudgementDimensions,
  PlayerAction,
} from "@sim-shared/types";

type CandidateId = components["schemas"]["CandidateId"];
type ConsensusBoardEntry = components["schemas"]["ConsensusBoardEntry"];

export function actionLabel(
  action: PlayerAction | AllowedActionType | null | undefined,
) {
  if (!action) {
    return "대화";
  }

  if (action in PLAYER_ACTION_LABELS) {
    return PLAYER_ACTION_LABELS[action as PlayerAction];
  }

  return NPC_ACTION_LABELS[action as AllowedActionType];
}

export function formatPlayerConversationText(params: {
  text: string;
  action: PlayerAction | null | undefined;
  targetLabel: string | null;
}) {
  const spokenText = params.text.trim();
  if (spokenText) {
    return spokenText;
  }

  if (!params.action) {
    return "짧게 숨을 고르며 방 안의 시선을 읽었다.";
  }

  const label = actionLabel(params.action);
  const targetMode = PLAYER_ACTION_TARGET_MODES[params.action];

  if (params.targetLabel && (targetMode === "required" || targetMode === "optional")) {
    return `${label} - 공격타겟 : ${params.targetLabel}`;
  }

  return label;
}

export function formatDelta(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return `${value}`;
}

export function candidateLabel(
  candidateId: CandidateId,
  namesById: Record<string, string>,
) {
  if (candidateId === DEFAULT_PLAYER_ID) {
    return DEFAULT_PLAYER_LABEL;
  }

  return namesById[candidateId] ?? candidateId;
}

export function pressureSummary(entry: ConsensusBoardEntry) {
  if (entry.totalPressure >= 90) {
    return "즉시 희생 가능성 매우 높음";
  }

  if (entry.totalPressure >= 70) {
    return "방 안의 시선이 빠르게 몰리는 중";
  }

  if (entry.totalPressure >= 50) {
    return "위험권 진입";
  }

  return "아직 결정적 고립은 아님";
}

export function formatDimensionDelta(
  delta: Partial<JudgementDimensions>,
  options: { omitZero?: boolean } = {},
) {
  return (Object.keys(PRESSURE_DIMENSION_LABELS) as Array<keyof JudgementDimensions>)
    .filter((key) => {
      if (!options.omitZero) {
        return true;
      }

      return (delta[key] ?? 0) !== 0;
    })
    .map((key) => `${PRESSURE_DIMENSION_LABELS[key]} ${formatDelta(delta[key] ?? 0)}`)
    .join(" / ");
}
