import type { EventLogEntry } from "@backend-contracts/api";
import type { PersistedNpcState } from "@backend-domain";
import type { AutonomyMoveType } from "@sim-shared/types";
import { playerLabelAwareNames } from "@server/engine/npc-autonomy/planner-common";
import type { AutonomyPlannerInput } from "@server/engine/npc-autonomy/types";

export function defaultTone(moveType: AutonomyMoveType): EventLogEntry["tone"] {
  return moveType === "pile_on" || moveType === "redirect" ? "warning" : "info";
}

export function stepRationale(params: {
  actor: PersistedNpcState;
  moveType: AutonomyMoveType;
  targetNpcId: string | null;
  secondaryTargetNpcId: string | null;
  input: AutonomyPlannerInput;
}) {
  const { actor, moveType, targetNpcId, secondaryTargetNpcId, input } = params;
  const namesById = playerLabelAwareNames(input.npcs);
  const targetLabel = targetNpcId ? namesById[targetNpcId] ?? targetNpcId : "판세";
  const secondaryLabel =
    secondaryTargetNpcId ? namesById[secondaryTargetNpcId] ?? secondaryTargetNpcId : "현재 선두";

  if (moveType === "pile_on") {
    return `${actor.persona.name}은(는) ${targetLabel} 쪽으로 이미 생긴 책임선을 조금 더 밀고 싶어 한다.`;
  }

  if (moveType === "shield") {
    return `${actor.persona.name}은(는) ${targetLabel}를 지금 바로 버리기엔 손해가 크다고 본다.`;
  }

  if (moveType === "redirect") {
    return `${actor.persona.name}은(는) ${secondaryLabel} 쪽에 몰리던 시선을 ${targetLabel} 쪽으로 조금 흩뜨리려 한다.`;
  }

  return `${actor.persona.name}은(는) 지금은 판을 더 세게 밀기보다 숨을 고르며 다음 책임선을 재고 있다.`;
}
