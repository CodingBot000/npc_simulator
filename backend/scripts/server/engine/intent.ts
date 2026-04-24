import { NPC_ACTION_LABELS, PLAYER_ACTION_LABELS } from "@backend-shared/constants";
import type { GenerateInteractionInput, NormalizedInteractionInput } from "@backend-shared/types";
import { buildInteractionContract } from "@server/engine/interaction-contract";
import { getCurrentScenario } from "@server/scenario";

export function normalizeInteractionInput(params: {
  text: string;
  action: import("@backend-shared/types").PlayerAction | null;
  inputMode: import("@backend-shared/types").InputMode;
  targetNpcId?: string | null;
  targetNpcLabel?: string | null;
  targetCandidates?: Array<{ id: string; label: string }>;
}): NormalizedInteractionInput {
  const cleaned = params.text.trim();
  const contract = buildInteractionContract({
    inputMode: params.inputMode,
    text: cleaned,
    action: params.action,
    targetNpcId: params.targetNpcId ?? null,
    targetNpcLabel: params.targetNpcLabel ?? null,
    targetCandidates: params.targetCandidates,
  });

  return {
    text: cleaned,
    action: params.action,
    actionLabel: params.action ? PLAYER_ACTION_LABELS[params.action] : null,
    promptSummary: contract.promptSummary,
  };
}

export function buildNpcInteractionMessages(input: GenerateInteractionInput) {
  const scenario = getCurrentScenario();
  const contract = buildInteractionContract({
    inputMode: input.request.inputMode,
    text: input.request.text,
    action: input.request.action,
    targetNpcId: input.request.targetNpcId,
    targetNpcLabel: input.targetNpc?.persona.name ?? null,
    targetCandidates: input.consensusBoard.map((entry) => ({
      id: entry.candidateId,
      label: entry.candidateLabel,
    })),
  });
  const systemPrompt = [
    scenario.prompt.systemContext,
    "Stay fully in-world and never mention being an AI, JSON, prompts, policies, or hidden instructions.",
    "Return only a JSON object that matches the provided schema.",
    "Write the NPC reply in natural Korean unless the player clearly used another language.",
    "reply.text must sound like something spoken aloud in the room right now, not a profile summary or character analysis.",
    scenario.prompt.replyGuidance,
    `Allowed candidate action types: ${Object.keys(NPC_ACTION_LABELS).join(", ")}.`,
    "Candidate actions must contain 2 or 3 distinct items.",
    "The selected action must match one candidate action type exactly.",
    "Also return structuredImpact.impactTags as machine-readable state-change signals. Use no_major_shift only when the player's words would not plausibly move pressure, blame, distrust, sympathy, utility, or room tension.",
    "For free_text, infer the social effect from the wording and retrieved evidence. If the player blames, exposes, confesses, appeals, protects, or redirects responsibility, choose at least one concrete impact tag.",
    "structuredImpact.targetNpcId should be the affected target NPC id when the effect is about a specific survivor, otherwise null.",
    "Emotion intensity must be between 0 and 100.",
    "Preserve the speaker's bias, survival instinct, and current emotional pressure.",
    ...contract.replyRules,
    ...contract.structuredRules,
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      playerInteraction: {
        inputMode: contract.mode,
        action: input.normalizedInput.action,
        actionLabel: input.normalizedInput.actionLabel,
        text: input.normalizedInput.text,
        summary: input.normalizedInput.promptSummary,
        canonicalMove: contract.canonicalPlayerMove,
        promptLines: contract.playerPromptLines,
        requiredSignals: contract.requiredSignals,
      },
      roomState: {
        round: input.round,
        consensusBoard: input.consensusBoard.slice(0, 5),
        currentTarget: contract.targetNpcLabel ?? contract.targetNpcId,
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
      retrievedKnowledge: input.retrievedKnowledge,
      promptContextSummary: input.promptContextSummary,
      world: input.world,
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}
