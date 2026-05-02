import type { InteractionLogEntry } from "@backend-persistence";
import type { PersistedNpcState } from "@backend-domain";

export function recentConversationForNpc(
  entries: InteractionLogEntry[],
  npcId: string,
) {
  return entries
    .filter((entry) => entry.npcId === npcId)
    .slice(-4)
    .flatMap((entry) => [
      {
        id: `${entry.id}-player`,
        npcId: entry.npcId,
        speaker: "player" as const,
        text: entry.playerText,
        timestamp: entry.timestamp,
        action: entry.playerAction,
        fallbackUsed: false,
      },
      {
        id: `${entry.id}-npc`,
        npcId: entry.npcId,
        speaker: "npc" as const,
        text: entry.replyText,
        timestamp: entry.timestamp,
        action: entry.selectedAction,
        fallbackUsed: entry.fallbackUsed ?? false,
        replyRewriteSource: entry.replyRewriteSource ?? null,
      },
    ]);
}

export function buildPromptContextSummary(params: {
  roundBefore: number;
  leaderLabel: string | null;
  targetLabel: string | null;
  memoryCount: number;
  knowledgeTitles: string[];
}) {
  return [
    `roundBefore=${params.roundBefore}`,
    `leaderBefore=${params.leaderLabel ?? "none"}`,
    `target=${params.targetLabel ?? "none"}`,
    `retrievedMemories=${params.memoryCount}`,
    `retrievedEvidence=${params.knowledgeTitles.join(", ") || "none"}`,
  ].join(" | ");
}

export function persistNpc(
  nextNpc: PersistedNpcState,
  npcs: PersistedNpcState[],
) {
  const index = npcs.findIndex((candidate) => candidate.persona.id === nextNpc.persona.id);

  if (index >= 0) {
    npcs[index] = nextNpc;
  }
}

export function isPersistedNpcId(
  npcId: string | null,
  npcs: PersistedNpcState[],
) {
  return Boolean(npcId && npcs.some((npc) => npc.persona.id === npcId));
}
