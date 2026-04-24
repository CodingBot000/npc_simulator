import { NPC_ACTION_LABELS } from "@backend-shared/constants";
import type {
  CandidateAction,
  ImpactTag,
  LlmInteractionResult,
  SelectedAction,
} from "@backend-shared/types";
import { impactTags } from "@backend-shared/types";
import { clamp } from "@backend-shared/utils";

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
      type: "probe",
      label: NPC_ACTION_LABELS.probe,
      reason: "아직 확신하지 못한 정보를 더 끌어내기 위해 반응을 탐색한다.",
    });
  }

  return deduped.slice(0, 3);
}

function normalizeImpactTags(values: ImpactTag[]) {
  const allowed = new Set<ImpactTag>(impactTags);
  const deduped = values.filter((value, index) => {
    return allowed.has(value) && values.indexOf(value) === index;
  });
  const withoutNoMajorShift = deduped.filter((tag) => tag !== "no_major_shift");

  if (withoutNoMajorShift.length > 0) {
    return withoutNoMajorShift.slice(0, 5);
  }

  return ["no_major_shift"] satisfies ImpactTag[];
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
    structuredImpact: {
      impactTags: normalizeImpactTags(result.structuredImpact.impactTags),
      targetNpcId: result.structuredImpact.targetNpcId?.trim() || null,
      confidence: clamp(Math.round(result.structuredImpact.confidence), 0, 100),
      rationale: result.structuredImpact.rationale.trim(),
    },
  };
}
