import type {
  AutonomyStepResult,
  EventLogEntry,
} from "@backend-shared/api-contract-types";
import type { AutonomyMoveType } from "@sim-shared/types";

function buildSummary(params: {
  actorLabel: string;
  moveType: AutonomyMoveType;
  targetLabel: string | null;
  secondaryTargetLabel: string | null;
}) {
  const { actorLabel, moveType, targetLabel, secondaryTargetLabel } = params;

  if (moveType === "pile_on") {
    return `${actorLabel}이(가) 다시 ${targetLabel ?? "특정 인물"} 쪽 책임선을 밀었다.`;
  }

  if (moveType === "shield") {
    return `${actorLabel}이(가) ${targetLabel ?? "그 인물"}를 바로 희생양으로 몰지 않겠다는 태도를 보였다.`;
  }

  if (moveType === "redirect") {
    return `${actorLabel}이(가) ${secondaryTargetLabel ?? "한쪽"}에 몰리던 시선을 ${targetLabel ?? "다른 쪽"}으로 조금 돌리려 했다.`;
  }

  return `${actorLabel}이(가) 당장 결론을 밀지 않고 판세를 다시 재려는 태도를 보였다.`;
}

/**
 * Build a short, explainable sentence for one autonomy step.
 */
export function buildAutonomyStepSummary(params: {
  actorLabel: string;
  moveType: AutonomyMoveType;
  targetLabel: string | null;
  secondaryTargetLabel: string | null;
}) {
  return buildSummary(params);
}

/**
 * Convert an autonomy step into a compact event log entry.
 */
export function buildAutonomyEventLogEntry(step: AutonomyStepResult): EventLogEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    title: "방 안의 후속 반응",
    detail: step.summary,
    tags: [
      step.actorNpcId,
      step.moveType,
      ...(step.targetNpcId ? [step.targetNpcId] : []),
      ...(step.secondaryTargetNpcId ? [step.secondaryTargetNpcId] : []),
    ],
    npcId: step.actorNpcId,
    tone: step.tone,
  };
}
