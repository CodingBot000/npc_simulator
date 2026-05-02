import type {
  EpisodeExportPaths,
  InspectorPayload,
  InteractionTraceEntry,
} from "@backend-contracts/api";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@backend-persistence";
import { nowIso } from "@backend-support/utils";
import { exportEpisodeDataset } from "@server/engine/dataset-export";
import {
  finishInteractionTraceStage,
  recordInteractionTraceStage,
  startInteractionTraceStage,
} from "@server/engine/interaction-trace";

export interface CommitResolvedEpisodeExportInput {
  worldState: WorldStateFile;
  memoryFile: NpcMemoryFile;
  interactionLog: InteractionLogFile;
  inspector: InspectorPayload;
  turnStartedAtMs: number;
  interactionTraceEntries: InteractionTraceEntry[];
}

export async function commitResolvedEpisodeExport(
  input: CommitResolvedEpisodeExportInput,
): Promise<EpisodeExportPaths | null> {
  const {
    worldState,
    memoryFile,
    interactionLog,
    inspector,
    turnStartedAtMs,
    interactionTraceEntries,
  } = input;

  if (worldState.resolution.resolved && !worldState.datasetExportedAt) {
    const datasetExportTrace = startInteractionTraceStage(
      turnStartedAtMs,
      "dataset_export",
      "데이터셋 export",
    );
    const exportedAt = nowIso();
    worldState.endedAt = worldState.endedAt ?? exportedAt;
    const committedExportPaths = await exportEpisodeDataset({
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
    finishInteractionTraceStage(
      interactionTraceEntries,
      turnStartedAtMs,
      datasetExportTrace,
      "ok",
      "resolved episode dataset을 export했습니다.",
    );

    return committedExportPaths;
  }

  recordInteractionTraceStage(
    interactionTraceEntries,
    turnStartedAtMs,
    "dataset_export",
    "데이터셋 export",
    "skipped",
    "결말 확정 전이라 export를 건너뛰었습니다.",
  );

  return null;
}
