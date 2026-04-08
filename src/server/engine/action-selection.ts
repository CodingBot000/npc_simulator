import { NPC_ACTION_LABELS } from "@/lib/constants";
import type {
  CandidateAction,
  LlmInteractionResult,
  SelectedAction,
} from "@/lib/types";
import { clamp } from "@/lib/utils";

function normalizeCandidateActions(
  candidateActions: CandidateAction[],
  selectedAction: SelectedAction,
) {
  const deduped = candidateActions.reduce<CandidateAction[]>((accumulator, action) => {
    if (!accumulator.some((item) => item.type === action.type)) {
      accumulator.push({
        type: action.type,
        label: action.label?.trim() || NPC_ACTION_LABELS[action.type],
        reason: action.reason.trim(),
      });
    }

    return accumulator;
  }, []);

  if (!deduped.some((action) => action.type === selectedAction.type)) {
    deduped.unshift({
      type: selectedAction.type,
      label: NPC_ACTION_LABELS[selectedAction.type],
      reason: selectedAction.reason,
    });
  }

  if (deduped.length === 1) {
    deduped.push({
      type: "ask_back",
      label: NPC_ACTION_LABELS.ask_back,
      reason: "정보를 더 캐내기 위해 되묻는 선택지를 유지한다.",
    });
  }

  return deduped.slice(0, 3);
}

export function normalizeLlmInteractionResult(result: LlmInteractionResult) {
  return {
    ...result,
    reply: {
      text: result.reply.text.trim(),
    },
    emotion: {
      ...result.emotion,
      intensity: clamp(Math.round(result.emotion.intensity), 0, 100),
      reason: result.emotion.reason.trim(),
    },
    intent: {
      summary: result.intent.summary.trim(),
      stance: result.intent.stance.trim(),
      leverage: result.intent.leverage.trim(),
    },
    selectedAction: {
      type: result.selectedAction.type,
      reason: result.selectedAction.reason.trim(),
    },
    candidateActions: normalizeCandidateActions(
      result.candidateActions,
      result.selectedAction,
    ),
  };
}
