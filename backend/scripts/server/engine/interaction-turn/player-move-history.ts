import type {
  InteractionLogEntry,
} from "@backend-persistence";
import type {
  RecentPlayerMoveContext,
} from "@server/engine/npc-autonomy/types";

const RECENT_PLAYER_MOVE_LIMIT = 5;

function emptyPressureContext() {
  return {
    targetPressureBefore: null,
    playerPressureBefore: null,
    targetWasLowPressure: false,
    leaderBeforeCandidateId: null,
    leaderBeforePressure: null,
  };
}

export function buildRecentPlayerMoveHistory(
  entries: InteractionLogEntry[],
): RecentPlayerMoveContext[] {
  return entries
    .slice(-RECENT_PLAYER_MOVE_LIMIT)
    .map((entry) => ({
      round: entry.roundBefore ?? entry.round,
      action: entry.playerAction,
      targetNpcId: entry.targetNpcId,
      impactTags: entry.structuredImpact?.impactTags ?? [],
      ...emptyPressureContext(),
    }));
}
