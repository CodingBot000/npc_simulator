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
import { formatDimensionDelta, groupBy } from "@/lib/utils";
import { buildConsensusBoard } from "@/server/engine/pressure-engine";
import { getLlmProvider } from "@/server/providers/llm-provider";
import { getCurrentScenario } from "@/server/scenario";
import { createWorldRepository } from "@/server/store/repositories";

function interactionToMessages(entry: InteractionLogEntry): ChatMessage[] {
  return [
    {
      id: `${entry.id}-player`,
      npcId: entry.npcId,
      speaker: "player",
      text: entry.playerText || "짧게 숨을 고르며 방 안의 시선을 읽었다.",
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

export function composeInteractionEventLogEntry(params: {
  npcId: string;
  npcName: string;
  selectedActionLabel: string;
  promptSummary: string;
  targetLabel: string | null;
  pressureChanges: import("@/lib/types").PressureChange[];
  resolution: import("@/lib/types").ResolutionState;
}) {
  const tone: EventLogEntry["tone"] = params.resolution.resolved
    ? "danger"
    : params.pressureChanges.some((entry) => entry.totalPressureDelta > 0)
      ? "warning"
      : "info";

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    title: `${params.npcName} 반응`,
    detail: [
      `${params.selectedActionLabel} 성향으로 반응했다.`,
      `플레이어 시도: ${params.promptSummary}.`,
      params.targetLabel ? `논의 대상: ${params.targetLabel}.` : null,
      ...params.pressureChanges.map(
        (entry) =>
          `${entry.candidateLabel} 압력 ${entry.totalPressureDelta >= 0 ? "+" : ""}${entry.totalPressureDelta}. ${formatDimensionDelta(entry.dimensionDelta, { omitZero: true })}. ${entry.reasons.join(" ")}`,
      ),
      params.resolution.resolved ? params.resolution.summary : null,
    ]
      .filter(Boolean)
      .join(" "),
    tags: [
      params.npcId,
      params.selectedActionLabel,
      ...(params.targetLabel ? [params.targetLabel] : []),
    ],
    npcId: params.npcId,
    tone,
  };
}

export function composeRoundEventLogEntry(params: {
  title: string;
  detail: string;
  tags: readonly string[];
  tone: EventLogEntry["tone"];
}) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    title: params.title,
    detail: params.detail,
    tags: params.tags,
    npcId: "system",
    tone: params.tone,
  } satisfies EventLogEntry;
}

export function buildWorldSnapshot(params: {
  worldState: WorldStateFile;
  memories: Record<string, MemoryEntry[]>;
  interactionLog: InteractionLogEntry[];
  runtime: RuntimeStatus;
}): WorldSnapshot {
  const scenario = getCurrentScenario();
  const npcs = params.worldState.npcs.map((npc) => ({
    ...npc,
    memories: params.memories[npc.persona.id] ?? [],
  }));

  return {
    scenarioId: scenario.id,
    presentation: { ...scenario.presentation },
    availableActions: [...scenario.actions],
    world: params.worldState.world,
    npcs,
    events: [...params.worldState.events]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, MAX_EVENT_LOG_ENTRIES),
    conversations: buildConversations(params.interactionLog),
    round: params.worldState.round,
    consensusBoard: buildConsensusBoard({
      judgements: params.worldState.judgements,
      npcs: params.worldState.npcs,
    }),
    lastInspector: params.worldState.lastInspector,
    runtime: params.runtime,
    resolution: params.worldState.resolution,
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
