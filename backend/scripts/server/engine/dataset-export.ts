import fs from "node:fs/promises";
import path from "node:path";
import type {
  EpisodeExportPaths,
  InteractionLogEntry,
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@backend-shared/types";
import { DATA_DIR, PROJECT_ROOT } from "@server/config";
import { buildConsensusBoard } from "@server/engine/pressure-engine";
import { upsertEpisodeExportToDb } from "@server/db/review-db";

const EXPORT_TEMP_DIR = path.join(DATA_DIR, "datasets", ".tmp");
const EXPORT_TEMP_TTL_MS = 60 * 60 * 1000;

function exportTimestamp(isoTimestamp: string) {
  return isoTimestamp.replace(/[:.]/g, "-");
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeJsonl(filePath: string, rows: unknown[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

async function cleanupExpiredTransactions() {
  if (!(await pathExists(EXPORT_TEMP_DIR))) {
    return;
  }

  const entries = await fs.readdir(EXPORT_TEMP_DIR, { withFileTypes: true });
  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(EXPORT_TEMP_DIR, entry.name);

      try {
        const stats = await fs.stat(entryPath);

        if (now - stats.mtimeMs > EXPORT_TEMP_TTL_MS) {
          await fs.rm(entryPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup races.
      }
    }),
  );
}

function relativePath(filePath: string) {
  return path.relative(PROJECT_ROOT, filePath);
}

function absolutePath(relativeOrAbsolutePath: string | null) {
  if (!relativeOrAbsolutePath) {
    return null;
  }

  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(PROJECT_ROOT, relativeOrAbsolutePath);
}

function turnToSftRow(params: {
  worldState: WorldStateFile;
  turn: InteractionLogEntry;
  index: number;
}) {
  return {
    instruction:
      "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화와 구조화된 추론 JSON을 생성한다.",
    input: {
      episodeId: params.worldState.episodeId,
      scenarioId: params.worldState.scenarioId,
      turnIndex: params.index,
      roundBefore: params.turn.roundBefore ?? params.turn.round,
      npcId: params.turn.npcId,
      targetNpcId: params.turn.targetNpcId,
      inputMode: params.turn.inputMode,
      action: params.turn.playerAction,
      playerText: params.turn.rawPlayerText ?? params.turn.playerText,
      normalizedInputSummary:
        params.turn.normalizedInputSummary ?? params.turn.playerText,
      promptContextSummary: params.turn.llmPromptContextSummary ?? null,
      retrievedMemories: params.turn.retrievedMemories ?? [],
      retrievedKnowledge: params.turn.retrievedKnowledge ?? [],
    },
    assistant: {
      replyText: params.turn.replyText,
      emotion: params.turn.emotion ?? null,
      intent: params.turn.intent ?? null,
      candidateActions: params.turn.candidateActions ?? [],
      selectedAction: {
        type: params.turn.selectedAction,
        reason: params.turn.selectedActionReason ?? "",
      },
      structuredImpact: params.turn.structuredImpact ?? null,
    },
    metadata: {
      relationshipDelta: params.turn.relationshipDelta,
      pressureChanges: params.turn.pressureChanges,
      leaderBefore: params.turn.leaderBefore ?? null,
      leaderAfter: params.turn.leaderAfter ?? null,
      resolutionAfter: params.turn.resolutionAfter ?? null,
    },
  };
}

function turnToReviewRow(params: {
  worldState: WorldStateFile;
  turn: InteractionLogEntry;
  index: number;
}) {
  return {
    labelStatus: "unlabeled",
    promptBundle: {
      episodeId: params.worldState.episodeId,
      scenarioId: params.worldState.scenarioId,
      turnIndex: params.index,
      npcId: params.turn.npcId,
      targetNpcId: params.turn.targetNpcId,
      inputMode: params.turn.inputMode,
      playerText: params.turn.rawPlayerText ?? params.turn.playerText,
      normalizedInputSummary:
        params.turn.normalizedInputSummary ?? params.turn.playerText,
      retrievedMemories: params.turn.retrievedMemories ?? [],
      retrievedKnowledge: params.turn.retrievedKnowledge ?? [],
      promptContextSummary: params.turn.llmPromptContextSummary ?? null,
    },
    currentChosenOutput: {
      replyText: params.turn.replyText,
      selectedAction: params.turn.selectedAction,
      selectedActionReason: params.turn.selectedActionReason ?? "",
      structuredImpact: params.turn.structuredImpact ?? null,
    },
    rubricHints: [
      "NPC persona and bias consistency",
      "Grounded use of retrieved evidence",
      "Useful structured impact tags for game-state update",
      "No out-of-world or prompt-policy talk",
      "Pressure movement should match the spoken response",
    ],
    metadata: {
      relationshipDelta: params.turn.relationshipDelta,
      pressureChanges: params.turn.pressureChanges,
      resolutionAfter: params.turn.resolutionAfter ?? null,
      shadowComparison: params.turn.shadowComparison ?? null,
    },
  };
}

function buildFinalPaths(params: { fileStem: string }) {
  return {
    episodePath: path.join(
      DATA_DIR,
      "datasets",
      "episodes",
      `${params.fileStem}.json`,
    ),
    sftPath: path.join(
      DATA_DIR,
      "datasets",
      "sft",
      `${params.fileStem}_underwater_sft.jsonl`,
    ),
    reviewPath: path.join(
      DATA_DIR,
      "datasets",
      "review",
      `${params.fileStem}_preference_review_queue.jsonl`,
    ),
  };
}

export async function cleanupExportPaths(paths: EpisodeExportPaths) {
  await Promise.all(
    [paths.richTrace, paths.sft, paths.review]
      .map((candidatePath) => absolutePath(candidatePath))
      .filter(Boolean)
      .map(async (candidatePath) => {
        await fs.rm(candidatePath!, { force: true });
      }),
  );
}

export async function exportEpisodeDataset(params: {
  worldState: WorldStateFile;
  memoryFile: NpcMemoryFile;
  interactionLog: InteractionLogFile;
  exportedAt: string;
}): Promise<EpisodeExportPaths> {
  await cleanupExpiredTransactions();

  const timestamp = exportTimestamp(params.exportedAt);
  const fileStem = `${timestamp}_${params.worldState.episodeId}`;
  const finalPaths = buildFinalPaths({ fileStem });
  const transactionDir = path.join(
    EXPORT_TEMP_DIR,
    `${fileStem}-${crypto.randomUUID()}`,
  );
  const stagedPaths = {
    episodePath: path.join(transactionDir, "episode.json"),
    sftPath: path.join(transactionDir, "sft.jsonl"),
    reviewPath: path.join(transactionDir, "review.jsonl"),
  };
  const finalConsensusBoard = buildConsensusBoard({
    judgements: params.worldState.judgements,
    npcs: params.worldState.npcs,
  });
  const turns = params.interactionLog.entries;
  const episodePayload = {
    episode: {
      episodeId: params.worldState.episodeId,
      scenarioId: params.worldState.scenarioId,
      startedAt: params.worldState.startedAt,
      endedAt: params.worldState.endedAt,
      exportedAt: params.exportedAt,
      resolved: params.worldState.resolution.resolved,
      resolutionType: params.worldState.resolution.resolutionType,
      sacrificedNpcId: params.worldState.resolution.sacrificedNpcId,
      sacrificedLabel: params.worldState.resolution.sacrificedLabel,
      finalRound: params.worldState.round.currentRound,
    },
    turns: turns.map((turn, index) => ({
      turnIndex: index,
      roundBefore: turn.roundBefore ?? turn.round,
      roundAfter: turn.roundAfter ?? turn.round,
      npcId: turn.npcId,
      targetNpcId: turn.targetNpcId,
      inputMode: turn.inputMode,
      action: turn.playerAction,
      rawPlayerText: turn.rawPlayerText ?? turn.playerText,
      normalizedInputSummary:
        turn.normalizedInputSummary ?? turn.playerText,
      retrievedMemories: turn.retrievedMemories ?? [],
      retrievedKnowledge: turn.retrievedKnowledge ?? [],
      llmPromptContextSummary: turn.llmPromptContextSummary ?? null,
      modelReplyText: turn.replyText,
      emotion: turn.emotion ?? null,
      intent: turn.intent ?? null,
      candidateActions: turn.candidateActions ?? [],
      selectedAction: {
        type: turn.selectedAction,
        reason: turn.selectedActionReason ?? "",
      },
      structuredImpact: turn.structuredImpact ?? null,
      shadowComparison: turn.shadowComparison ?? null,
      relationshipDelta: turn.relationshipDelta,
      pressureChanges: turn.pressureChanges,
      leaderBefore: turn.leaderBefore ?? null,
      leaderAfter: turn.leaderAfter ?? null,
      resolutionAfter: turn.resolutionAfter ?? null,
    })),
    finalState: {
      round: params.worldState.round,
      resolution: params.worldState.resolution,
      consensusBoard: finalConsensusBoard,
      events: params.worldState.events,
      memories: params.memoryFile.memories,
    },
  };

  await writeJson(stagedPaths.episodePath, episodePayload);

  await writeJsonl(
    stagedPaths.sftPath,
    turns.map((turn, index) =>
      turnToSftRow({ worldState: params.worldState, turn, index }),
    ),
  );

  await writeJsonl(
    stagedPaths.reviewPath,
    turns.map((turn, index) =>
      turnToReviewRow({ worldState: params.worldState, turn, index }),
    ),
  );

  const committedAbsolutePaths: string[] = [];

  try {
    await fs.mkdir(path.dirname(finalPaths.episodePath), { recursive: true });
    await fs.mkdir(path.dirname(finalPaths.sftPath), { recursive: true });
    await fs.mkdir(path.dirname(finalPaths.reviewPath), { recursive: true });

    await fs.rename(stagedPaths.episodePath, finalPaths.episodePath);
    committedAbsolutePaths.push(finalPaths.episodePath);

    await fs.rename(stagedPaths.sftPath, finalPaths.sftPath);
    committedAbsolutePaths.push(finalPaths.sftPath);

    await fs.rename(stagedPaths.reviewPath, finalPaths.reviewPath);
    committedAbsolutePaths.push(finalPaths.reviewPath);
  } catch (error) {
    await Promise.all(
      committedAbsolutePaths.map(async (committedPath) => {
        await fs.rm(committedPath, { force: true }).catch(() => {});
      }),
    );
    throw error;
  } finally {
    await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => {});
  }

  const exportPaths = {
    richTrace: relativePath(finalPaths.episodePath),
    sft: relativePath(finalPaths.sftPath),
    review: relativePath(finalPaths.reviewPath),
  };

  try {
    await upsertEpisodeExportToDb({
      worldState: params.worldState as unknown as Record<string, unknown>,
      turns: episodePayload.turns as Record<string, unknown>[],
      exportedAt: params.exportedAt,
      exportPaths,
    });
  } catch (error) {
    await Promise.all(
      committedAbsolutePaths.map(async (committedPath) => {
        await fs.rm(committedPath, { force: true }).catch(() => {});
      }),
    );
    throw error;
  }

  return exportPaths;
}
