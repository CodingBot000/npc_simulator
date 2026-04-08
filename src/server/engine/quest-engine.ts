import type {
  NormalizedInteractionInput,
  Quest,
  QuestStatus,
  QuestUpdate,
  RelationshipState,
  SelectedAction,
} from "@/lib/types";
import { containsAny } from "@/lib/utils";

const merchantKeywords = ["상인", "merchant", "소문", "창고", "마차"];
const cargoKeywords = ["화물", "cargo", "짐", "창고"];
const guildKeywords = ["길드", "의뢰", "guild", "계약"];

function updateQuestStatus(
  quest: Quest | undefined,
  nextStatus: QuestStatus,
  note: string,
  updates: QuestUpdate[],
) {
  if (!quest || quest.status === nextStatus) {
    return;
  }

  updates.push({
    questId: quest.id,
    title: quest.title,
    from: quest.status,
    to: nextStatus,
    note,
  });
  quest.status = nextStatus;
}

export function applyQuestUpdates(params: {
  npcId: string;
  quests: Quest[];
  normalizedInput: NormalizedInteractionInput;
  selectedAction: SelectedAction;
  relationship: RelationshipState;
}) {
  const { npcId, quests, normalizedInput, selectedAction, relationship } = params;
  const updates: QuestUpdate[] = [];
  const text = `${normalizedInput.text} ${normalizedInput.actionLabel ?? ""}`.toLowerCase();
  const suspiciousQuest = quests.find((quest) => quest.id === "suspicious-merchant");
  const lostCargoQuest = quests.find((quest) => quest.id === "lost-cargo");
  const guildQuest = quests.find((quest) => quest.id === "guild-charter");

  if (
    npcId === "innkeeper" &&
    containsAny(text, merchantKeywords) &&
    selectedAction.type !== "refuse"
  ) {
    updateQuestStatus(
      suspiciousQuest,
      "available",
      "여관 주인이 수상한 상인 이야기를 실제 단서로 취급하기 시작했다.",
      updates,
    );
  }

  if (
    npcId === "guard" &&
    suspiciousQuest?.status === "available" &&
    (containsAny(text, merchantKeywords) || normalizedInput.action === "question")
  ) {
    updateQuestStatus(
      suspiciousQuest,
      "active",
      "경비병이 소문을 보고 가능한 사건으로 받아들였다.",
      updates,
    );
  }

  if (
    npcId === "guild_clerk" &&
    guildQuest?.status === "locked" &&
    relationship.playerTrust >= 58
  ) {
    updateQuestStatus(
      guildQuest,
      "available",
      "길드 담당자가 플레이어를 잠재적인 협력자로 보기 시작했다.",
      updates,
    );
  }

  if (
    npcId === "guild_clerk" &&
    guildQuest?.status === "available" &&
    relationship.playerTrust >= 62 &&
    (normalizedInput.action === "request" ||
      normalizedInput.action === "persuade" ||
      containsAny(text, guildKeywords))
  ) {
    updateQuestStatus(
      guildQuest,
      "active",
      "길드 담당자가 실무형 시험 과제를 검토하기 시작했다.",
      updates,
    );
  }

  if (
    npcId === "guild_clerk" &&
    lostCargoQuest?.status === "available" &&
    (normalizedInput.action === "request" ||
      containsAny(text, cargoKeywords) ||
      selectedAction.type === "accept_request")
  ) {
    updateQuestStatus(
      lostCargoQuest,
      "active",
      "잃어버린 화물 조사 의뢰가 실제 작업으로 넘어갔다.",
      updates,
    );
  }

  if (
    npcId === "guild_clerk" &&
    suspiciousQuest?.status === "active" &&
    relationship.playerTrust >= 60 &&
    (containsAny(text, merchantKeywords) || selectedAction.type === "hint")
  ) {
    updateQuestStatus(
      suspiciousQuest,
      "completed",
      "수상한 상인에 대한 진술이 길드 차원의 단서로 정리됐다.",
      updates,
    );
  }

  if (
    npcId === "guild_clerk" &&
    guildQuest?.status === "active" &&
    lostCargoQuest?.status === "active" &&
    relationship.playerTrust >= 66
  ) {
    updateQuestStatus(
      guildQuest,
      "completed",
      "길드 담당자가 플레이어를 정식 협력자로 인정했다.",
      updates,
    );
  }

  return updates;
}
