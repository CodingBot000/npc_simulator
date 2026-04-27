import rawPlayerActions from "./player-actions.json";
import type { PlayerAction } from "../simulator-rules/types";

type PlayerActionTargetMode = "required" | "optional" | "ignored";

type PlayerActionPresentationRecord = {
  id: PlayerAction;
  label: string;
  description: string;
  targetMode: PlayerActionTargetMode;
};

const playerActionRecords = rawPlayerActions as PlayerActionPresentationRecord[];

function toRecord<TValue>(
  mapValue: (record: PlayerActionPresentationRecord) => TValue,
) {
  return Object.fromEntries(
    playerActionRecords.map((record) => [record.id, mapValue(record)]),
  ) as Record<PlayerAction, TValue>;
}

export const PLAYER_ACTION_DEFINITIONS = playerActionRecords;

export const PLAYER_ACTION_LABELS = toRecord((record) => record.label);

export const PLAYER_ACTION_DESCRIPTIONS = toRecord(
  (record) => record.description,
);

export const PLAYER_ACTION_TARGET_MODES = toRecord(
  (record) => record.targetMode,
);

export function buildScenarioActionDefinitions(
  actionIds: readonly PlayerAction[],
): Array<{
  id: PlayerAction;
  label: string;
  description: string;
  requiresTarget: boolean;
}> {
  const byId = new Map(
    PLAYER_ACTION_DEFINITIONS.map((record) => [record.id, record]),
  );

  return actionIds.map((actionId) => {
    const record = byId.get(actionId);
    if (!record) {
      throw new Error(`Unknown player action id: ${actionId}`);
    }

    return {
      id: record.id,
      label: record.label,
      description: record.description,
      requiresTarget: record.targetMode === "required",
    };
  });
}
