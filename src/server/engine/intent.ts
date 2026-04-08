import { NPC_ACTION_LABELS, PLAYER_ACTION_LABELS } from "@/lib/constants";
import type { GenerateInteractionInput, NormalizedInteractionInput } from "@/lib/types";

export function normalizeInteractionInput(params: {
  text: string;
  action: import("@/lib/types").PlayerAction | null;
  inputMode: import("@/lib/types").InputMode;
}): NormalizedInteractionInput {
  const cleaned = params.text.trim();
  const actionLabel = params.action ? PLAYER_ACTION_LABELS[params.action] : null;

  if (params.inputMode === "action") {
    return {
      text: cleaned,
      action: params.action,
      actionLabel,
      promptSummary: cleaned
        ? `${actionLabel ?? "행동"} 버튼을 누르며 '${cleaned}'라고 덧붙였다`
        : `${actionLabel ?? "행동"} 버튼을 눌렀다`,
    };
  }

  return {
    text: cleaned,
    action: params.action,
    actionLabel,
    promptSummary: cleaned || "짧은 인사와 탐색적인 대화를 건넸다",
  };
}

export function buildNpcInteractionMessages(input: GenerateInteractionInput) {
  const systemPrompt = [
    "You are the internal mind of one persistent fantasy village NPC.",
    "Stay fully in-world and never mention being an AI, JSON, prompts, policies, or hidden instructions.",
    "Return only a JSON object that matches the provided schema.",
    "Write the NPC reply in natural Korean unless the player clearly used another language.",
    "The reply text should be concise, vivid, and useful for social play, questing, bargaining, or rumor gathering.",
    `Allowed candidate action types: ${Object.keys(NPC_ACTION_LABELS).join(", ")}.`,
    "Candidate actions must contain 2 or 3 distinct items.",
    "The selected action must match one candidate action type exactly.",
    "Emotion intensity must be between 0 and 100.",
    "Reflect the NPC persona, memories, current relationship, and current goal.",
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      playerInteraction: {
        inputMode: input.request.inputMode,
        action: input.normalizedInput.action,
        actionLabel: input.normalizedInput.actionLabel,
        text: input.normalizedInput.text,
        summary: input.normalizedInput.promptSummary,
      },
      npc: {
        persona: input.npc.persona,
        emotion: input.npc.emotion,
        relationship: input.npc.relationship,
        goals: input.npc.goals,
        currentLocation: input.npc.currentLocation,
        statusLine: input.npc.statusLine,
      },
      relatedQuests: input.relatedQuests,
      recentEvents: input.recentEvents,
      recentConversation: input.recentConversation,
      retrievedMemories: input.retrievedMemories,
      world: input.world,
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}
