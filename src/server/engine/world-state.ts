import { MAX_CONVERSATION_MESSAGES, MAX_EVENT_LOG_ENTRIES } from "@/lib/constants";
import type {
  ChatMessage,
  EventLogEntry,
  InteractionLogEntry,
  MemoryEntry,
  RuntimeStatus,
  WorldSnapshot,
  WorldStateFile,
} from "@/lib/types";
import { groupBy } from "@/lib/utils";
import { getLlmProvider } from "@/server/providers/llm-provider";
import { createWorldRepository } from "@/server/store/repositories";

function interactionToMessages(entry: InteractionLogEntry): ChatMessage[] {
  return [
    {
      id: `${entry.id}-player`,
      npcId: entry.npcId,
      speaker: "player",
      text: entry.playerText || "행동 버튼을 눌렀다.",
      timestamp: entry.timestamp,
      action: entry.playerAction,
    },
    {
      id: `${entry.id}-npc`,
      npcId: entry.npcId,
      speaker: "npc",
      text: entry.replyText,
      timestamp: entry.timestamp,
      action: entry.selectedAction,
    },
  ];
}

function buildConversations(entries: InteractionLogEntry[]) {
  const grouped = groupBy(entries, (entry) => entry.npcId);

  return Object.fromEntries(
    Object.entries(grouped).map(([npcId, npcEntries]) => [
      npcId,
      npcEntries
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .flatMap((entry) => interactionToMessages(entry))
        .slice(-MAX_CONVERSATION_MESSAGES),
    ]),
  );
}

export function composeEventLogEntry(params: {
  npcId: string;
  npcName: string;
  selectedActionLabel: string;
  promptSummary: string;
  questUpdates: import("@/lib/types").QuestUpdate[];
  rippleNotes: string[];
}) {
  const tone: EventLogEntry["tone"] =
    params.questUpdates.length > 0 ? "success" : params.rippleNotes.length > 0 ? "warning" : "info";

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    title: `${params.npcName}와의 상호작용`,
    detail: [
      `${params.selectedActionLabel}으로 반응했다.`,
      `플레이어 시도: ${params.promptSummary}.`,
      ...params.questUpdates.map((update) => `${update.title}: ${update.note}`),
      ...params.rippleNotes,
    ].join(" "),
    tags: [
      params.npcId,
      params.selectedActionLabel,
      ...params.questUpdates.map((update) => update.questId),
    ],
    npcId: params.npcId,
    tone,
  };
}

export function buildWorldSnapshot(params: {
  worldState: WorldStateFile;
  memories: Record<string, MemoryEntry[]>;
  interactionLog: InteractionLogEntry[];
  runtime: RuntimeStatus;
}): WorldSnapshot {
  const npcs = params.worldState.npcs.map((npc) => ({
    ...npc,
    memories: params.memories[npc.persona.id] ?? [],
  }));

  return {
    world: params.worldState.world,
    npcs,
    quests: [...params.worldState.quests],
    events: [...params.worldState.events]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, MAX_EVENT_LOG_ENTRIES),
    conversations: buildConversations(params.interactionLog),
    lastInspector: params.worldState.lastInspector,
    runtime: params.runtime,
  };
}

export async function getWorldSnapshot() {
  const repository = createWorldRepository();
  await repository.ensureSeedData();

  const [worldState, memoryFile, interactionLog, runtime] = await Promise.all([
    repository.readWorldState(),
    repository.readMemoryFile(),
    repository.readInteractionLog(),
    getLlmProvider().getStatus(),
  ]);

  return buildWorldSnapshot({
    worldState,
    memories: memoryFile.memories,
    interactionLog: interactionLog.entries,
    runtime,
  });
}
