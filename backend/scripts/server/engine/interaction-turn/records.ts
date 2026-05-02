import type {
  ConsensusBoardEntry,
  InspectorPayload,
  InteractionFailureDebugEntry,
  InteractionRequestPayload,
  InteractionResponsePayload,
  InteractionTraceEntry,
  LlmInteractionResult,
  NpcState,
  RetrievedKnowledgeEvidence,
  RetrievedMemoryEntry,
} from "@backend-contracts/api";
import type {
  InteractionLogEntry,
  InteractionLogFile,
  WorldStateFile,
} from "@backend-persistence";
import { formatPlayerConversationText } from "@backend-support/utils";
import type { NormalizedInteractionInput } from "@backend-provider";
import type { SimulateNpcAutonomyPhaseResult } from "@server/engine/npc-autonomy/types";
import {
  finishInteractionTraceStage,
  startInteractionTraceStage,
} from "@server/engine/interaction-trace";

export interface CommitInteractionTurnRecordsInput {
  worldState: WorldStateFile;
  interactionLog: InteractionLogFile;
  request: InteractionRequestPayload;
  npc: NpcState;
  normalizedInput: NormalizedInteractionInput;
  llmResult: LlmInteractionResult;
  fallbackUsed: boolean;
  replyRewriteSource: string | null;
  replyRewriteReason: string | null;
  replyJudge: InspectorPayload["replyJudge"];
  failureDebugEntries: InteractionFailureDebugEntry[];
  interactionTraceEntries: InteractionTraceEntry[];
  retrievedMemories: RetrievedMemoryEntry[];
  retrievedKnowledge: RetrievedKnowledgeEvidence[];
  timestamp: string;
  effectiveTargetNpcId: string | null;
  targetLabel: string | null;
  relationshipDelta: InteractionResponsePayload["relationshipDelta"];
  pressureChanges: InteractionResponsePayload["pressureChanges"];
  leaderBefore: ConsensusBoardEntry | null;
  leadingCandidate: ConsensusBoardEntry | null;
  resolution: InteractionResponsePayload["resolution"];
  promptContextSummary: string;
  sanitizedShadowComparison: InspectorPayload["shadowComparison"];
  autonomyPhase: SimulateNpcAutonomyPhaseResult;
  roundBefore: number;
  turnStartedAtMs: number;
}

export interface CommitInteractionTurnRecordsResult {
  inspector: InspectorPayload;
  logEntry: InteractionLogEntry;
}

export function commitInteractionTurnRecords(
  input: CommitInteractionTurnRecordsInput,
): CommitInteractionTurnRecordsResult {
  const {
    worldState,
    interactionLog,
    request,
    npc,
    normalizedInput,
    llmResult,
    fallbackUsed,
    replyRewriteSource,
    replyRewriteReason,
    replyJudge,
    failureDebugEntries,
    interactionTraceEntries,
    retrievedMemories,
    retrievedKnowledge,
    timestamp,
    effectiveTargetNpcId,
    targetLabel,
    relationshipDelta,
    pressureChanges,
    leaderBefore,
    leadingCandidate,
    resolution,
    promptContextSummary,
    sanitizedShadowComparison,
    autonomyPhase,
    roundBefore,
    turnStartedAtMs,
  } = input;
  const failureDebug = failureDebugEntries.length > 0 ? failureDebugEntries : null;
  const interactionTrace =
    interactionTraceEntries.length > 0 ? interactionTraceEntries : null;

  const inspector: InspectorPayload = {
    timestamp,
    episodeId: worldState.episodeId,
    npcId: request.npcId,
    targetNpcId: effectiveTargetNpcId,
    replyText: llmResult.reply.text,
    fallbackUsed,
    replyRewriteSource,
    replyRewriteReason,
    replyJudge,
    failureDebug,
    interactionTrace,
    retrievedMemories,
    retrievedKnowledge,
    emotion: llmResult.emotion,
    intent: llmResult.intent,
    candidateActions: llmResult.candidateActions,
    selectedAction: llmResult.selectedAction,
    selectedActionReason: llmResult.selectedAction.reason,
    structuredImpact: llmResult.structuredImpact,
    relationshipDelta,
    pressureChanges,
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
    replyRewriteSource,
    replyRewriteReason,
    replyJudge,
    failureDebug,
    interactionTrace,
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
    pressureChanges,
    leaderBefore,
    leaderAfter: leadingCandidate,
    resolutionAfter: resolution,
    round: worldState.round.currentRound,
    shadowComparison: sanitizedShadowComparison,
    autonomyPhase: autonomyPhase.phase,
  };
  const logCommitTrace = startInteractionTraceStage(
    turnStartedAtMs,
    "log_commit",
    "턴 로그 적재",
  );
  interactionLog.entries.push(logEntry);
  finishInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    logCommitTrace,
    "ok",
    "inspector와 interaction log에 기록했습니다.",
  );

  return {
    inspector,
    logEntry,
  };
}
