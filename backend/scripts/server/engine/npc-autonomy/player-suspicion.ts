import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import type {
  ConsensusBoardEntry,
  EventLogEntry,
  RoundState,
} from "@backend-contracts/api";
import type { PlayerAction } from "@sim-shared/types";
import type {
  LastPlayerMoveContext,
  PlayerSuspicionContext,
  RecentPlayerMoveContext,
} from "@server/engine/npc-autonomy/types";

const AGGRESSIVE_ACTIONS = new Set<PlayerAction>([
  "make_case",
  "expose",
  "ally",
  "deflect",
]);

const DEFAULT_PLAYER_SUSPICION_SCORE = 0;
const MAX_SCORE = 100;
const MULTIPLIER_SCORE_CAP = 70;
const TARGET_WEIGHT_RANGE = 1.1;
const DELTA_SCALE_RANGE = 0.35;

export const DEFAULT_PLAYER_SUSPICION_CONTEXT: PlayerSuspicionContext = {
  score: DEFAULT_PLAYER_SUSPICION_SCORE,
  targetWeightMultiplier: 1,
  deltaScale: 1,
  reasons: [],
};

function clampScore(value: number) {
  return Math.max(0, Math.min(MAX_SCORE, Math.round(value)));
}

function multiplierFor(score: number, range: number) {
  return 1 + (Math.min(score, MULTIPLIER_SCORE_CAP) / MULTIPLIER_SCORE_CAP) * range;
}

function boardIndex(board: ConsensusBoardEntry[], candidateId: string) {
  return board.findIndex((entry) => entry.candidateId === candidateId);
}

function isAggressiveAction(action: PlayerAction | null) {
  return action ? AGGRESSIVE_ACTIONS.has(action) : false;
}

function recentWindow(
  recentMoves: RecentPlayerMoveContext[] | undefined,
  lastMove: LastPlayerMoveContext | null | undefined,
) {
  return [
    ...(recentMoves ?? []),
    ...(lastMove ? [lastMove] : []),
  ].slice(-5);
}

function countAggressiveMoves(moves: RecentPlayerMoveContext[], limit: number) {
  return moves
    .slice(-limit)
    .filter((move) => isAggressiveAction(move.action))
    .length;
}

function distinctAggressiveTargets(moves: RecentPlayerMoveContext[], limit: number) {
  return new Set(
    moves
      .slice(-limit)
      .filter((move) => isAggressiveAction(move.action))
      .map((move) => move.targetNpcId)
      .filter(Boolean),
  ).size;
}

function countPlayerBlameDown(moves: RecentPlayerMoveContext[], limit: number) {
  return moves
    .slice(-limit)
    .filter((move) =>
      move.impactTags.includes("player_blame_down") ||
      move.impactTags.includes("player_distrust_down"),
    )
    .length;
}

function hasRecentDangerTone(events: EventLogEntry[]) {
  return events.some((event) => event.tone === "danger");
}

export function buildPlayerSuspicionContext(params: {
  board: ConsensusBoardEntry[];
  round: RoundState;
  recentEvents: EventLogEntry[];
  recentPlayerMoves?: RecentPlayerMoveContext[];
  lastPlayerMove?: LastPlayerMoveContext | null;
}): PlayerSuspicionContext {
  const moves = recentWindow(params.recentPlayerMoves, params.lastPlayerMove);
  const lastMove = params.lastPlayerMove ?? null;
  const aggressiveCount = countAggressiveMoves(moves, 3);
  const distinctTargets = distinctAggressiveTargets(moves, 4);
  const playerIndex = boardIndex(params.board, DEFAULT_PLAYER_ID);
  let score = DEFAULT_PLAYER_SUSPICION_SCORE;
  const reasons: string[] = [];

  if (aggressiveCount >= 2) {
    score += 15;
    reasons.push("최근 공격성 행동이 반복됐다.");
  }

  if (distinctTargets >= 3) {
    score += 20;
    reasons.push("공격 타깃이 짧은 시간 안에 여러 명으로 바뀌었다.");
  }

  if (
    lastMove &&
    isAggressiveAction(lastMove.action) &&
    lastMove.targetNpcId &&
    lastMove.targetWasLowPressure
  ) {
    score += 15;
    reasons.push("상대적으로 안전하던 후보를 새 책임선으로 끌어올렸다.");
  }

  if (
    moves.slice(-3).filter((move) => move.action === "deflect").length >= 2 ||
    countPlayerBlameDown(moves, 3) >= 2
  ) {
    score += 15;
    reasons.push("자신에게 오던 책임을 반복해서 밖으로 돌렸다.");
  }

  if (
    lastMove &&
    isAggressiveAction(lastMove.action) &&
    lastMove.targetNpcId &&
    lastMove.leaderBeforeCandidateId &&
    lastMove.leaderBeforeCandidateId !== lastMove.targetNpcId &&
    (lastMove.leaderBeforePressure ?? 0) >= 130 &&
    lastMove.targetWasLowPressure
  ) {
    score += 12;
    reasons.push("이미 위험한 선두를 두고 낮은 후보를 새로 찔렀다.");
  }

  if (params.round.currentRound >= params.round.minRoundsBeforeResolution) {
    score += 8;
    reasons.push("합의가 열리는 후반 국면이라 조작 시도가 더 민감하게 읽힌다.");
  }

  if (hasRecentDangerTone(params.recentEvents)) {
    score += 8;
    reasons.push("최근 방 안 분위기가 위험 단계까지 올라갔다.");
  }

  if (playerIndex >= 2 && aggressiveCount > 0) {
    score += 12;
    reasons.push("당신은 비교적 안전한 위치에서 다른 사람을 몰고 있다.");
  }

  if (lastMove?.action === "confess") {
    score -= 15;
    reasons.push("이번 턴의 부분 인정이 노골적 조작 의심을 일부 낮췄다.");
  } else if (lastMove?.action === "appeal") {
    score -= 8;
    reasons.push("이번 턴의 호소가 즉각적인 공격 의심을 일부 누그러뜨렸다.");
  }

  const clampedScore = clampScore(score);

  return {
    score: clampedScore,
    targetWeightMultiplier: multiplierFor(clampedScore, TARGET_WEIGHT_RANGE),
    deltaScale: multiplierFor(clampedScore, DELTA_SCALE_RANGE),
    reasons,
  };
}
