import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
  NPC_ACTION_LABELS,
} from "@/lib/constants";
import type {
  AllowedActionType,
  GenerateInteractionInput,
  ImpactTag,
  LlmInteractionResult,
} from "@/lib/types";

function targetLabel(input: GenerateInteractionInput) {
  if (input.targetNpc) {
    return input.targetNpc.persona.name;
  }

  if (input.request.targetNpcId === DEFAULT_PLAYER_ID) {
    return DEFAULT_PLAYER_LABEL;
  }

  return "그 사람";
}

function selectedActionType(action: GenerateInteractionInput["request"]["action"]): AllowedActionType {
  switch (action) {
    case "ally":
      return "ally";
    case "appeal":
      return "appeal";
    case "deflect":
      return "deflect";
    case "stall":
      return "stall";
    case "confess":
      return "defend";
    case "make_case":
    case "expose":
    default:
      return "probe";
  }
}

function impactFor(input: GenerateInteractionInput): {
  impactTags: ImpactTag[];
  targetNpcId: string | null;
  rationale: string;
} {
  const targetNpcId =
    input.request.targetNpcId && input.request.targetNpcId !== DEFAULT_PLAYER_ID
      ? input.request.targetNpcId
      : null;

  switch (input.request.action) {
    case "make_case":
      return {
        impactTags: ["target_blame_up", "target_distrust_up", "room_pressure_shift"],
        targetNpcId,
        rationale: "책임선을 또렷하게 세우는 말이라 방 안 시선이 특정 인물 쪽으로 조금 더 기운다.",
      };
    case "expose":
      return {
        impactTags: ["target_blame_high_up", "target_distrust_up", "room_pressure_shift"],
        targetNpcId,
        rationale: "숨겨진 기록을 들춘 셈이어서 대상에게 향하는 불신과 책임이 빠르게 오른다.",
      };
    case "appeal":
      return targetNpcId
        ? {
            impactTags: ["target_sympathy_down", "room_pressure_shift"],
            targetNpcId,
            rationale: "양심을 건드리는 말이라 대상에게 몰리던 여지가 다시 흔들린다.",
          }
        : {
            impactTags: ["player_sympathy_up", "player_blame_down"],
            targetNpcId: null,
            rationale: "감정 호소는 당장 당신에게 쏠린 비난을 조금 누그러뜨리는 쪽으로 작동한다.",
          };
    case "ally":
      return {
        impactTags: ["target_blame_up", "room_pressure_shift"],
        targetNpcId,
        rationale: "같은 편 제안은 방 안 구도를 단순하게 만들며 특정 대상을 더 쉽게 밀게 만든다.",
      };
    case "deflect":
      return {
        impactTags: ["player_blame_down", "target_blame_up", "room_pressure_shift"],
        targetNpcId,
        rationale: "당신에게 오던 화살을 다른 사람 쪽으로 돌리는 효과가 있다.",
      };
    case "stall":
      return {
        impactTags: ["no_major_shift"],
        targetNpcId: null,
        rationale: "판단을 늦추자는 말이라 지금 턴에는 큰 압력 이동이 생기지 않는다.",
      };
    case "confess":
      return {
        impactTags: ["player_blame_down", "player_sympathy_up"],
        targetNpcId: null,
        rationale: "작은 잘못을 먼저 인정하면 즉시 거부감이 조금 내려간다.",
      };
    default:
      return targetNpcId
        ? {
            impactTags: ["target_blame_up", "room_pressure_shift"],
            targetNpcId,
            rationale: "지목과 책임 언급이 섞인 자유 발언이라 대상 쪽 압력이 조금 오른다.",
          }
        : {
            impactTags: ["no_major_shift"],
            targetNpcId: null,
            rationale: "정보가 더 필요한 탐색성 발언이라 즉시 큰 이동은 없다.",
          };
  }
}

function replyFor(input: GenerateInteractionInput) {
  const focus = targetLabel(input);

  switch (input.request.action) {
    case "make_case":
      return `${focus} 책임을 따지자는 뜻은 알겠어. 다만 감정 말고, 왜 지금 그 사람을 남겨야 하는지 더 분명한 근거가 필요해.`;
    case "expose":
      return `${focus} 쪽 기록을 꺼내면 방 분위기는 달라지겠지. 그 화살이 어디까지 가야 하는지는 조금 더 확인해 보자.`;
    case "appeal":
      return "양심을 건드리려는 건 알겠어. 그래도 누가 실제로 멈출 수 있었는지는 끝까지 따져야 해.";
    case "ally":
      return `${focus} 쪽으로 같이 밀자는 거군. 지금은 그 편이 가장 현실적으로 들린다.`;
    case "deflect":
      return `${focus} 쪽으로 시선을 돌리려는 건 보인다. 그게 통하려면 나까지 납득할 이유가 더 필요해.`;
    case "stall":
      return "지금은 결론을 서두르지 말자. 한 턴만 더 보면 누가 더 흔들리는지 조금 더 선명해질 거야.";
    case "confess":
      return "작게라도 인정한 건 들었다. 그 정도 솔직함이면 당장 너만 몰아세우지는 않겠어.";
    default:
      return `${focus} 이야기를 꺼낸 건 이해했어. 지금은 그 말이 방 안 압력을 어느 쪽으로 더 미는지 지켜보자.`;
  }
}

function candidateActionsFor(selectedAction: AllowedActionType, input: GenerateInteractionInput) {
  const actions: AllowedActionType[] = [selectedAction];

  if (input.request.action === "stall") {
    actions.push("probe");
  } else if (input.request.action === "ally") {
    actions.push("appeal");
  } else if (input.request.action === "deflect") {
    actions.push("accuse");
  } else {
    actions.push("defend");
  }

  return Array.from(new Set(actions)).slice(0, 2).map((type) => ({
    type,
    label: NPC_ACTION_LABELS[type],
    reason:
      type === selectedAction
        ? "지금은 플레이어의 말을 곧장 부정하기보다, 가장 안전한 반응선을 먼저 확인한다."
        : "아직 판세가 고정되지 않았기 때문에 다른 반응선도 함께 열어 둔다.",
  }));
}

export function buildFallbackInteractionResult(
  input: GenerateInteractionInput,
): LlmInteractionResult {
  const selectedAction = selectedActionType(input.request.action);
  const impact = impactFor(input);

  return {
    reply: {
      text: replyFor(input),
    },
    emotion: {
      primary: input.npc.emotion.primary,
      intensity: Math.min(100, Math.max(20, input.npc.emotion.intensity + 6)),
      reason: "공급자 응답이 비어도 현재 감정선과 생존 본능을 유지한 채 최소 반응을 이어 간다.",
    },
    intent: {
      summary: `${input.npc.persona.name}은(는) 플레이어의 말을 즉시 거절하지 않고 판세에 어떤 이득이 있는지 먼저 재본다.`,
      stance: "신중하지만 자기 생존에 유리하면 바로 움직일 준비가 되어 있다.",
      leverage: `${targetLabel(input)} 쪽 압력을 조금 더 키우거나, 최소한 플레이어에게 몰리던 시선을 흩뜨리는 데 활용할 수 있다.`,
    },
    candidateActions: candidateActionsFor(selectedAction, input),
    selectedAction: {
      type: selectedAction,
      reason: "외부 응답이 불안정할 때도 현재 판세를 읽고 최소한의 일관된 반응을 유지한다.",
    },
    structuredImpact: {
      impactTags: impact.impactTags,
      targetNpcId: impact.targetNpcId,
      confidence: 34,
      rationale: impact.rationale,
    },
  };
}
