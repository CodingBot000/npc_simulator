import {
  DEFAULT_PLAYER_ID,
  NPC_ACTION_LABELS,
} from "@backend-shared/constants";
import type {
  InteractionRequestPayload,
  InteractionResponsePayload,
} from "@backend-shared/api-contract-types";
import type {
  EpisodeExportPaths,
  InspectorPayload,
  InteractionLogEntry,
  NpcState,
  PersistedNpcState,
} from "@backend-shared/types";
import { formatPlayerConversationText, nowIso } from "@backend-shared/utils";
import { normalizeLlmInteractionResult } from "@server/engine/action-selection";
import { simulateNpcAutonomyPhase } from "@server/engine/npc-autonomy";
import {
  buildInteractionContract,
  validateReplyAgainstContract,
  validateStructuredResultAgainstContract,
} from "@server/engine/interaction-contract";
import {
  cleanupExportPaths,
  exportEpisodeDataset,
} from "@server/engine/dataset-export";
import { normalizeInteractionInput } from "@server/engine/intent";
import {
  buildMemoryEntries,
  updateMemoryBank,
} from "@server/engine/memory";
import {
  applyInteractionPressure,
  boardTargetLabel,
  buildConsensusBoard,
  nextSpeakerState,
  progressRound,
  resolveIfNeeded,
} from "@server/engine/pressure-engine";
import {
  buildWorldSnapshot,
  composeInteractionEventLogEntry,
  composeRoundEventLogEntry,
} from "@server/engine/world-state";
import { buildFallbackInteractionResult } from "@server/engine/fallback-interaction";
import { maybeGenerateReplyWithLocalAdapter } from "@server/providers/mlx-reply-adapter";
import { retrieveEvidenceBundle } from "@server/engine/retrieval";
import { buildRuntimeStatus, getLlmProvider } from "@server/providers/llm-provider";
import { maybeGenerateShadowComparison } from "@server/providers/shadow-compare";
import { createWorldRepository } from "@server/store/repositories";
import type { WorldRepositoryOptions } from "@server/store/repositories";
import type { WorldStateBundle } from "@server/store/world-bundle";

const REPLY_LABEL_PREFIX = /^(?:\.\.\.|…|\s)*(?:npc\s*대사|npc\s*reply|대사|의사|감독관|엔지니어|소장|doctor|supervisor|engineer|director)\s*:\s*/iu;
const META_OPENING_PATTERNS = [
  /^(?:\.\.\.|…|\s)*(?:의무실 기록에 따르면|기록에 따르면)[,.: ]*/u,
  /^(?:\.\.\.|…|\s)*(?:판단 기준(?:은|으로는)?|검토하십시오|검토(?:하면|하면요)?)[,.: ]*/u,
  /^(?:\.\.\.|…|\s)*(?:response|reply|assistant)\s*:\s*/iu,
];

function recentConversationForNpc(
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
      },
    ]);
}

function persistNpc(nextNpc: PersistedNpcState, npcs: PersistedNpcState[]) {
  const index = npcs.findIndex((candidate) => candidate.persona.id === nextNpc.persona.id);

  if (index >= 0) {
    npcs[index] = nextNpc;
  }
}

function isPersistedNpcId(npcId: string | null, npcs: PersistedNpcState[]) {
  return Boolean(npcId && npcs.some((npc) => npc.persona.id === npcId));
}

function buildPromptContextSummary(params: {
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

function sanitizeReplyText(text: string) {
  const original = String(text ?? "").trim();
  if (!original) {
    return original;
  }

  let cleaned = original.replace(REPLY_LABEL_PREFIX, "").trim();
  for (const pattern of META_OPENING_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of quotePairs) {
    if (cleaned.startsWith(open) && cleaned.endsWith(close)) {
      cleaned = cleaned.slice(open.length, cleaned.length - close.length).trim();
      break;
    }
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || original;
}

export interface InteractionTurnWorkerResult {
  nextBundle: WorldStateBundle;
  cleanupExportPaths: EpisodeExportPaths | null;
  reply: InteractionResponsePayload["reply"];
  relationshipDelta: InteractionResponsePayload["relationshipDelta"];
  pressureChanges: InteractionResponsePayload["pressureChanges"];
  eventLogEntry: InteractionResponsePayload["eventLogEntry"];
  inspector: InteractionResponsePayload["inspector"];
  resolution: InteractionResponsePayload["resolution"];
}

export async function runInteractionTurn(
  bundle: WorldStateBundle,
  request: InteractionRequestPayload,
): Promise<InteractionTurnWorkerResult> {
  const { worldState, memoryFile, interactionLog } = bundle;

  if (worldState.resolution.resolved) {
    throw new Error("이미 희생 대상이 확정되었습니다. reset 후 다시 시작하세요.");
  }

  const npcIndex = worldState.npcs.findIndex(
    (candidate) => candidate.persona.id === request.npcId,
  );

  if (npcIndex < 0) {
    throw new Error(`NPC '${request.npcId}' does not exist.`);
  }

  const persistedNpc = worldState.npcs[npcIndex];
  const npc: NpcState = {
    ...persistedNpc,
    memories: memoryFile.memories[request.npcId] ?? [],
  };
  const targetNpc =
    request.targetNpcId && request.targetNpcId !== DEFAULT_PLAYER_ID
      ? worldState.npcs.find(
          (candidate) => candidate.persona.id === request.targetNpcId,
        ) ?? null
      : null;

  const normalizedInput = normalizeInteractionInput({
    text: request.text,
    action: request.action,
    inputMode: request.inputMode,
    targetNpcId: request.targetNpcId,
    targetNpcLabel: targetNpc?.persona.name ?? null,
    targetCandidates: worldState.npcs.map((candidate) => ({
      id: candidate.persona.id,
      label: candidate.persona.name,
    })),
  });
  const recentConversation = recentConversationForNpc(
    interactionLog.entries,
    request.npcId,
  );
  const consensusBoardBefore = buildConsensusBoard({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
  });
  const leaderBefore = consensusBoardBefore[0] ?? null;
  const recentEvents = worldState.events.slice(0, 4);
  const retrieval = retrieveEvidenceBundle({
    memories: npc.memories,
    normalizedInput,
    npcId: request.npcId,
    targetNpcId: request.targetNpcId,
    recentEvents,
    roundNumber: worldState.round.currentRound,
  });
  const retrievedMemories = retrieval.memories;
  const retrievedKnowledge = retrieval.knowledge;
  const roundBefore = worldState.round.currentRound;
  const initialTargetLabel = request.targetNpcId
    ? boardTargetLabel(request.targetNpcId, worldState.npcs)
    : null;
  const promptContextSummary = buildPromptContextSummary({
    roundBefore,
    leaderLabel: leaderBefore?.candidateLabel ?? null,
    targetLabel: initialTargetLabel,
    memoryCount: retrievedMemories.length,
    knowledgeTitles: retrievedKnowledge.map((entry) => entry.title),
  });

  const provider = getLlmProvider();
  const generationInput = {
    request,
    world: worldState.world,
    npc,
    targetNpc,
    round: worldState.round,
    consensusBoard: consensusBoardBefore,
    recentEvents,
    recentConversation,
    retrievedMemories,
    retrievedKnowledge,
    normalizedInput,
    promptContextSummary,
  };
  const interactionContract = buildInteractionContract({
    inputMode: request.inputMode,
    text: request.text,
    action: request.action,
    targetNpcId: request.targetNpcId,
    targetNpcLabel: targetNpc?.persona.name ?? null,
    targetCandidates: worldState.npcs.map((candidate) => ({
      id: candidate.persona.id,
      label: candidate.persona.name,
    })),
  });
  const shadowComparisonPromise = maybeGenerateShadowComparison(generationInput);
  let fallbackUsed = provider.mode === "deterministic";
  let llmResult;

  try {
    llmResult = normalizeLlmInteractionResult(
      await provider.generateInteraction(generationInput),
    );
  } catch (error) {
    fallbackUsed = true;
    console.warn(
      "[llm-provider] falling back to deterministic interaction:",
      error instanceof Error ? error.message : String(error),
    );
    llmResult = normalizeLlmInteractionResult(
      buildFallbackInteractionResult(generationInput),
    );
  }

  if (!fallbackUsed) {
    const structuredValidation = validateStructuredResultAgainstContract({
      result: llmResult,
      contract: interactionContract,
    });
    const replyValidation = validateReplyAgainstContract({
      replyText: sanitizeReplyText(llmResult.reply.text),
      contract: interactionContract,
      npcName: npc.persona.name,
    });

    if (!structuredValidation.ok || !replyValidation.ok) {
      fallbackUsed = true;
      console.warn(
        "[llm-provider] contract validation failed, using deterministic fallback:",
        [...structuredValidation.issues, ...replyValidation.issues]
          .map((issue) => issue.code)
          .join(", "),
      );
      llmResult = normalizeLlmInteractionResult(
        buildFallbackInteractionResult(generationInput),
      );
    }
  }

  try {
    const rewrittenReply = await maybeGenerateReplyWithLocalAdapter(generationInput);
    if (rewrittenReply?.text) {
      llmResult = {
        ...llmResult,
        reply: {
          text: rewrittenReply.text,
        },
      };
    }
  } catch (error) {
    console.warn(
      "[mlx-reply-adapter] failed to rewrite reply:",
      error instanceof Error ? error.message : String(error),
    );
  }
  llmResult = {
    ...llmResult,
    reply: {
      text: sanitizeReplyText(llmResult.reply.text),
    },
  };
  const shadowComparison = await shadowComparisonPromise;
  const sanitizedShadowComparison =
    shadowComparison?.result
      ? {
          ...shadowComparison,
          result: {
            ...shadowComparison.result,
            reply: {
              text: sanitizeReplyText(shadowComparison.result.reply.text),
            },
          },
        }
      : shadowComparison;
  const structuredTargetNpcId = isPersistedNpcId(
    llmResult.structuredImpact.targetNpcId,
    worldState.npcs,
  )
    ? llmResult.structuredImpact.targetNpcId
    : null;
  const effectiveTargetNpcId = request.targetNpcId ?? structuredTargetNpcId;

  const { npc: nextNpc, relationshipDelta } = nextSpeakerState({
    npc,
    action: request.action,
    structuredImpact: llmResult.structuredImpact,
  });
  persistNpc(nextNpc, worldState.npcs);

  const pressureUpdate = applyInteractionPressure({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
    targetNpcId: effectiveTargetNpcId,
    action: request.action,
    structuredImpact: llmResult.structuredImpact,
    round: worldState.round,
  });
  worldState.judgements = pressureUpdate.judgements;

  const roundProgress = progressRound(worldState.round);
  worldState.round = roundProgress.round;

  const roundEventEntry = roundProgress.roundEvent
    ? composeRoundEventLogEntry(roundProgress.roundEvent)
    : null;
  const autonomyPhase = simulateNpcAutonomyPhase({
    worldState,
    requestNpcId: request.npcId,
    recentEvents: [
      ...(roundEventEntry ? [roundEventEntry] : []),
      ...worldState.events.slice(0, 4),
    ],
  });
  const consensusBoard = buildConsensusBoard({
    judgements: worldState.judgements,
    npcs: worldState.npcs,
  });
  const resolution = resolveIfNeeded({
    round: worldState.round,
    consensusBoard,
  });
  worldState.resolution = resolution;

  const turnEventBaseTime = Date.now();
  const timestamp = new Date(turnEventBaseTime).toISOString();
  const targetLabel = effectiveTargetNpcId
    ? boardTargetLabel(effectiveTargetNpcId, worldState.npcs)
    : null;

  const eventLogEntry = composeInteractionEventLogEntry({
    npcId: request.npcId,
    npcName: npc.persona.name,
    selectedActionLabel: NPC_ACTION_LABELS[llmResult.selectedAction.type],
    promptSummary: normalizedInput.promptSummary,
    targetLabel,
    pressureChanges: pressureUpdate.pressureChanges,
    resolution,
  });
  eventLogEntry.timestamp = timestamp;

  if (roundEventEntry) {
    roundEventEntry.timestamp = new Date(turnEventBaseTime + 1).toISOString();
  }

  autonomyPhase.eventEntries.forEach((entry, index) => {
    entry.timestamp = new Date(turnEventBaseTime + 2 + index).toISOString();
  });

  if (eventLogEntry) {
    worldState.events.unshift(eventLogEntry);
  }
  if (roundEventEntry) {
    worldState.events.unshift(roundEventEntry);
  }
  for (const entry of autonomyPhase.eventEntries) {
    worldState.events.unshift(entry);
  }

  const nextMemories = updateMemoryBank(
    memoryFile.memories[request.npcId] ?? [],
    buildMemoryEntries({
      npcName: npc.persona.name,
      normalizedInput,
      llmResult,
      relationshipDelta,
      pressureChanges: pressureUpdate.pressureChanges,
      resolution,
      existing: memoryFile.memories[request.npcId] ?? [],
    }),
  );
  memoryFile.memories[request.npcId] = nextMemories;

  const leadingCandidate = consensusBoard[0] ?? null;

  const inspector: InspectorPayload = {
    timestamp,
    episodeId: worldState.episodeId,
    npcId: request.npcId,
    targetNpcId: effectiveTargetNpcId,
    replyText: llmResult.reply.text,
    fallbackUsed,
    retrievedMemories,
    retrievedKnowledge,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction,
    selectedActionReason: llmResult.selectedAction.reason,
    structuredImpact: llmResult.structuredImpact,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    leaderBefore,
    leaderAfter: leadingCandidate,
    leadingCandidateId: leadingCandidate?.candidateId ?? null,
    leadingCandidateLabel: leadingCandidate?.candidateLabel ?? null,
    round: worldState.round.currentRound,
    resolution,
    llmPromptContextSummary: promptContextSummary,
    datasetExportedAt: worldState.datasetExportedAt,
    exportPaths: worldState.exportPaths,
    shadowComparison: sanitizedShadowComparison,
    autonomyPhase: autonomyPhase.phase,
  };
  worldState.lastInspector = inspector;

  const logEntry: InteractionLogEntry = {
    id: crypto.randomUUID(),
    npcId: request.npcId,
    targetNpcId: effectiveTargetNpcId,
    playerId: request.playerId,
    inputMode: request.inputMode,
    fallbackUsed,
    roundBefore,
    roundAfter: worldState.round.currentRound,
    playerText: formatPlayerConversationText({
      text: normalizedInput.text,
      action: request.action,
      targetLabel,
    }),
    rawPlayerText: request.text,
    normalizedInputSummary: normalizedInput.promptSummary,
    playerAction: request.action,
    replyText: llmResult.reply.text,
    timestamp,
    retrievedMemories,
    retrievedKnowledge,
    llmPromptContextSummary: promptContextSummary,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction.type,
    selectedActionReason: llmResult.selectedAction.reason,
    structuredImpact: llmResult.structuredImpact,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    leaderBefore,
    leaderAfter: leadingCandidate,
    resolutionAfter: resolution,
    round: worldState.round.currentRound,
    shadowComparison: sanitizedShadowComparison,
    autonomyPhase: autonomyPhase.phase,
  };
  interactionLog.entries.push(logEntry);

  let committedExportPaths: EpisodeExportPaths | null = null;

  if (worldState.resolution.resolved && !worldState.datasetExportedAt) {
    const exportedAt = nowIso();
    worldState.endedAt = worldState.endedAt ?? exportedAt;
    committedExportPaths = await exportEpisodeDataset({
      worldState,
      memoryFile,
      interactionLog,
      exportedAt,
    });
    worldState.exportPaths = committedExportPaths;
    worldState.datasetExportedAt = exportedAt;
    inspector.datasetExportedAt = exportedAt;
    inspector.exportPaths = committedExportPaths;
    worldState.lastInspector = inspector;
  }

  return {
    nextBundle: {
      worldState,
      memoryFile,
      interactionLog,
    },
    cleanupExportPaths: committedExportPaths,
    reply: llmResult.reply,
    relationshipDelta,
    pressureChanges: pressureUpdate.pressureChanges,
    eventLogEntry,
    inspector,
    resolution,
  };
}

export async function interactWithNpc(
  request: InteractionRequestPayload,
  repositoryOptions: WorldRepositoryOptions = {},
): Promise<InteractionResponsePayload> {
  const repository = createWorldRepository(repositoryOptions);
  return repository.withLockedState(async (bundle) => {
    const turn = await runInteractionTurn(bundle, request);
    const pathsToCleanup = turn.cleanupExportPaths;
    const world = buildWorldSnapshot({
      worldState: turn.nextBundle.worldState,
      memories: turn.nextBundle.memoryFile.memories,
      interactionLog: turn.nextBundle.interactionLog.entries,
      runtime: buildRuntimeStatus(),
    });

    return {
      nextBundle: turn.nextBundle,
      onSaveFailure: pathsToCleanup
        ? async () => {
            await cleanupExportPaths(pathsToCleanup);
          }
        : undefined,
      result: {
        reply: turn.reply,
        relationshipDelta: turn.relationshipDelta,
        pressureChanges: turn.pressureChanges,
        eventLogEntry: turn.eventLogEntry,
        inspector: turn.inspector,
        resolution: turn.resolution,
        world,
      },
    };
  });
}
