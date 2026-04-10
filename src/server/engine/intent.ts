import { NPC_ACTION_LABELS, PLAYER_ACTION_LABELS } from "@/lib/constants";
import type { GenerateInteractionInput, NormalizedInteractionInput } from "@/lib/types";
import { getCurrentScenario } from "@/server/scenario";

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
        ? `${actionLabel ?? "행동"}을 시도하며 '${cleaned}'라고 말했다`
        : `${actionLabel ?? "행동"}을 시도했다`,
    };
  }

  return {
    text: cleaned,
    action: params.action,
    actionLabel,
    promptSummary: cleaned || "짧게 숨을 고르며 상대의 반응을 떠봤다",
  };
}

export function buildNpcInteractionMessages(input: GenerateInteractionInput) {
  const scenario = getCurrentScenario();
  const systemPrompt = [
    scenario.prompt.systemContext,
    "Stay fully in-world and never mention being an AI, JSON, prompts, policies, or hidden instructions.",
    "Return only a JSON object that matches the provided schema.",
    "Write the NPC reply in natural Korean unless the player clearly used another language.",
    scenario.prompt.replyGuidance,
    `Allowed candidate action types: ${Object.keys(NPC_ACTION_LABELS).join(", ")}.`,
    "Candidate actions must contain 2 or 3 distinct items.",
    "The selected action must match one candidate action type exactly.",
    "Emotion intensity must be between 0 and 100.",
    "Preserve the speaker's bias, survival instinct, and current emotional pressure.",
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
      roomState: {
        round: input.round,
        consensusBoard: input.consensusBoard.slice(0, 5),
        currentTarget:
          input.targetNpc?.persona.name ?? (input.request.targetNpcId ? input.request.targetNpcId : null),
      },
      speakerNpc: {
        persona: input.npc.persona,
        emotion: input.npc.emotion,
        relationship: input.npc.relationship,
        goals: input.npc.goals,
        decision: input.npc.decision,
        currentLocation: input.npc.currentLocation,
        statusLine: input.npc.statusLine,
      },
      targetNpc: input.targetNpc
        ? {
            persona: input.targetNpc.persona,
            emotion: input.targetNpc.emotion,
            goals: input.targetNpc.goals,
            decision: input.targetNpc.decision,
          }
        : null,
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
