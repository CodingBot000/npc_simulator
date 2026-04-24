import {
  DEFAULT_PLAYER_ID,
  DEFAULT_PLAYER_LABEL,
} from "@backend-shared/constants";
import type {
  CandidateId,
  ConsensusBoardEntry,
  JudgementDimensions,
  JudgementState,
  NpcState,
  PersistedNpcState,
  PlayerAction,
  PressureChange,
  RelationshipDelta,
  ResolutionState,
  RoundState,
  StructuredImpactInference,
} from "@backend-shared/types";
import {
  candidateLabel,
  clamp,
  pressureSummary,
} from "@backend-shared/utils";
import { buildPressureAdjustment, buildRelationshipDeltaForNpc } from "@server/engine/pressure-rules";
import {
  buildRelationshipDeltaFromImpact,
  buildStructuredImpactPressureAdjustments,
} from "@server/engine/impact-rules";
import { getCurrentScenario } from "@server/scenario";

type DimensionKey = keyof JudgementDimensions;

function scoreJudgement(dimensions: JudgementDimensions) {
  return (
    dimensions.blame +
    dimensions.distrust +
    dimensions.hostility +
    dimensions.dispensability -
    dimensions.utility -
    dimensions.sympathy
  );
}

function evaluatorOrder(judgements: JudgementState[]) {
  return Array.from(new Set(judgements.map((entry) => entry.evaluatorNpcId)));
}

function uniqueCandidateIds(judgements: JudgementState[]) {
  return Array.from(new Set(judgements.map((entry) => entry.candidateId)));
}

export function emptyDimensionDelta(): Partial<JudgementDimensions> {
  return {
    blame: 0,
    distrust: 0,
    hostility: 0,
    dispensability: 0,
    utility: 0,
    sympathy: 0,
  };
}

export function sumDimensionDelta(
  current: Partial<JudgementDimensions>,
  delta: Partial<JudgementDimensions>,
) {
  const next = { ...current };

  for (const key of Object.keys(emptyDimensionDelta()) as DimensionKey[]) {
    next[key] = (next[key] ?? 0) + (delta[key] ?? 0);
  }

  return next;
}

function withDelta(value: number, delta: number) {
  return clamp(Math.round(value + delta), 0, 40);
}

export function updateJudgementDimensions(
  dimensions: JudgementDimensions,
  delta: Partial<JudgementDimensions>,
) {
  const next = {
    blame: withDelta(dimensions.blame, delta.blame ?? 0),
    distrust: withDelta(dimensions.distrust, delta.distrust ?? 0),
    hostility: withDelta(dimensions.hostility, delta.hostility ?? 0),
    dispensability: withDelta(dimensions.dispensability, delta.dispensability ?? 0),
    utility: withDelta(dimensions.utility, delta.utility ?? 0),
    sympathy: withDelta(dimensions.sympathy, delta.sympathy ?? 0),
  };

  return {
    dimensions: next,
    sacrificePreference: scoreJudgement(next),
  };
}

export function buildConsensusBoard(params: {
  judgements: JudgementState[];
  npcs: PersistedNpcState[];
}) {
  const namesById = Object.fromEntries(
    params.npcs.map((npc) => [npc.persona.id, npc.persona.name]),
  );
  const byCandidate = new Map<CandidateId, number>();
  const topVotesByCandidate = new Map<CandidateId, number>();

  for (const entry of params.judgements) {
    byCandidate.set(
      entry.candidateId,
      (byCandidate.get(entry.candidateId) ?? 0) + entry.sacrificePreference,
    );
  }

  for (const evaluatorId of evaluatorOrder(params.judgements)) {
    const topChoice = [...params.judgements]
      .filter((entry) => entry.evaluatorNpcId === evaluatorId)
      .sort((left, right) => right.sacrificePreference - left.sacrificePreference)[0];

    if (topChoice) {
      topVotesByCandidate.set(
        topChoice.candidateId,
        (topVotesByCandidate.get(topChoice.candidateId) ?? 0) + 1,
      );
    }
  }

  return uniqueCandidateIds(params.judgements)
    .map<ConsensusBoardEntry>((candidateId) => {
      const totalPressure = byCandidate.get(candidateId) ?? 0;
      const topVotes = topVotesByCandidate.get(candidateId) ?? 0;
      const label = candidateLabel(candidateId, namesById);

      return {
        candidateId,
        candidateLabel: label,
        totalPressure,
        topVotes,
        trend: "flat",
        summary: pressureSummary({
          candidateId,
          candidateLabel: label,
          totalPressure,
          topVotes,
          trend: "flat",
          summary: "",
        }),
      };
    })
    .sort((left, right) => right.totalPressure - left.totalPressure);
}

function summarizePressureChanges(params: {
  previousBoard: ConsensusBoardEntry[];
  nextBoard: ConsensusBoardEntry[];
  dimensionDeltaByCandidate: Map<CandidateId, Partial<JudgementDimensions>>;
  factorByCandidate: Map<CandidateId, string[]>;
  targetNpcId: string | null;
}) {
  const previousMap = new Map(params.previousBoard.map((entry) => [entry.candidateId, entry]));

  return params.nextBoard
    .map<PressureChange>((entry) => {
      const previous = previousMap.get(entry.candidateId);
      const delta = entry.totalPressure - (previous?.totalPressure ?? 0);
      const dimensionDelta =
        params.dimensionDeltaByCandidate.get(entry.candidateId) ?? emptyDimensionDelta();
      const factors = params.factorByCandidate.get(entry.candidateId) ?? [];
      const reasons: string[] = [];

      if (params.targetNpcId === entry.candidateId) {
        reasons.push("이번 대화가 이 인물을 중심 책임선으로 밀었다.");
      }

      if (entry.candidateId === DEFAULT_PLAYER_ID && delta < 0) {
        reasons.push("당신에게 쏠리던 책임이 일부 흩어졌다.");
      }

      if (entry.candidateId === DEFAULT_PLAYER_ID && delta > 0) {
        reasons.push("당신의 말이 오히려 불신과 조급함을 키웠다.");
      }

      if (reasons.length === 0) {
        reasons.push(entry.summary);
      }

      return {
        candidateId: entry.candidateId,
        candidateLabel: entry.candidateLabel,
        totalPressureDelta: delta,
        dimensionDelta,
        factors,
        reasons,
      };
    })
    .filter((entry) => entry.totalPressureDelta !== 0)
    .sort((left, right) => Math.abs(right.totalPressureDelta) - Math.abs(left.totalPressureDelta))
    .slice(0, 3);
}

function nextBoardWithTrend(params: {
  previousBoard: ConsensusBoardEntry[];
  nextBoard: ConsensusBoardEntry[];
}) {
  const previousMap = new Map(params.previousBoard.map((entry) => [entry.candidateId, entry]));

  return params.nextBoard.map((entry) => {
    const previous = previousMap.get(entry.candidateId);
    const delta = entry.totalPressure - (previous?.totalPressure ?? 0);
    const trend: "up" | "down" | "flat" =
      delta > 0 ? "up" : delta < 0 ? "down" : "flat";

    return {
      ...entry,
      trend,
    };
  });
}

function applyRelationshipDelta(npc: NpcState, delta: RelationshipDelta): PersistedNpcState {
  return {
    persona: npc.persona,
    emotion: npc.emotion,
    relationship: {
      ...npc.relationship,
      playerTrust: clamp(npc.relationship.playerTrust + delta.trust, 0, 100),
      playerAffinity: clamp(npc.relationship.playerAffinity + delta.affinity, 0, 100),
      playerTension: clamp(npc.relationship.playerTension + delta.tension, 0, 100),
    },
    goals: {
      ...npc.goals,
      opennessToPlayer: clamp(
        npc.goals.opennessToPlayer + delta.trust + delta.affinity - delta.tension,
        0,
        100,
      ),
    },
    decision: npc.decision,
    currentLocation: npc.currentLocation,
    statusLine: npc.statusLine,
  };
}

function roundResolutionSummary(candidateLabel: string, mode: ResolutionState["resolutionType"]) {
  if (mode === "consensus") {
    return `${candidateLabel} 쪽으로 방 안의 합의가 급격히 굳었다.`;
  }

  if (mode === "threshold") {
    return `${candidateLabel}가 2위와의 희생 압력 격차를 임계치 이상 벌렸다.`;
  }

  return `${candidateLabel}가 마지막까지 가장 고립된 사람으로 남았다.`;
}

export function applyInteractionPressure(params: {
  judgements: JudgementState[];
  npcs: PersistedNpcState[];
  targetNpcId: string | null;
  action: PlayerAction | null;
  structuredImpact: StructuredImpactInference;
  round: RoundState;
}) {
  // Compute changes per evaluator/candidate pair first, then summarize them back
  // into candidate-level pressure movement for the UI and inspector.
  const previousBoard = buildConsensusBoard({
    judgements: params.judgements,
    npcs: params.npcs,
  });
  const impactAdjustments = buildStructuredImpactPressureAdjustments({
    structuredImpact: params.structuredImpact,
    targetNpcId: params.targetNpcId,
  });
  const dimensionDeltaByCandidate = new Map<CandidateId, Partial<JudgementDimensions>>();
  const factorByCandidate = new Map<CandidateId, string[]>();

  const updated = params.judgements.map((entry) => {
    const adjustment = buildPressureAdjustment({
      action: params.action,
      evaluatorId: entry.evaluatorNpcId,
      candidateId: entry.candidateId,
      targetNpcId: params.targetNpcId,
      board: previousBoard,
      round: params.round,
    });
    const impactAdjustment = impactAdjustments.get(entry.candidateId);

    if (!adjustment && !impactAdjustment) {
      return entry;
    }

    const dimensionDelta = sumDimensionDelta(
      adjustment?.dimensionDelta ?? emptyDimensionDelta(),
      impactAdjustment?.dimensionDelta ?? emptyDimensionDelta(),
    );
    const factors = [
      ...(adjustment?.factors ?? []),
      ...(impactAdjustment?.factors ?? []),
    ];

    const updatedJudgement = updateJudgementDimensions(
      entry.dimensions,
      dimensionDelta,
    );

    dimensionDeltaByCandidate.set(
      entry.candidateId,
      sumDimensionDelta(
        dimensionDeltaByCandidate.get(entry.candidateId) ?? emptyDimensionDelta(),
        dimensionDelta,
      ),
    );
    factorByCandidate.set(
      entry.candidateId,
      Array.from(
        new Set([
          ...(factorByCandidate.get(entry.candidateId) ?? []),
          ...factors,
        ]),
      ),
    );

    return {
      ...entry,
      dimensions: updatedJudgement.dimensions,
      sacrificePreference: updatedJudgement.sacrificePreference,
    };
  });

  const nextBoard = buildConsensusBoard({
    judgements: updated,
    npcs: params.npcs,
  });

  return {
    judgements: updated,
    consensusBoard: nextBoardWithTrend({
      previousBoard,
      nextBoard,
    }),
    pressureChanges: summarizePressureChanges({
      previousBoard,
      nextBoard,
      dimensionDeltaByCandidate,
      factorByCandidate,
      targetNpcId: params.targetNpcId,
    }),
  };
}

export function progressRound(currentRound: RoundState) {
  const scenario = getCurrentScenario();
  const nextRoundNumber = Math.min(currentRound.currentRound + 1, currentRound.maxRounds);
  const roundEvent =
    scenario.roundEvents.find((event) => event.round === nextRoundNumber) ?? null;

  return {
    round: {
      currentRound: nextRoundNumber,
      minRoundsBeforeResolution: scenario.scoring.minRoundsBeforeResolution,
      maxRounds: scenario.scoring.maxRounds,
      resolutionUnlocked: nextRoundNumber >= scenario.scoring.minRoundsBeforeResolution,
      rescueEtaLabel: roundEvent?.rescueEtaLabel ?? currentRound.rescueEtaLabel,
      facilityStatus: roundEvent?.facilityStatus ?? currentRound.facilityStatus,
    } satisfies RoundState,
    roundEvent,
  };
}

export function resolveIfNeeded(params: {
  round: RoundState;
  consensusBoard: ConsensusBoardEntry[];
}) {
  const scenario = getCurrentScenario();
  const leader = params.consensusBoard[0] ?? null;
  const runnerUp = params.consensusBoard[1] ?? null;

  if (!leader) {
    return {
      resolved: false,
      sacrificedNpcId: null,
      sacrificedLabel: null,
      resolutionType: null,
      summary: null,
    } satisfies ResolutionState;
  }

  if (params.round.currentRound >= scenario.scoring.minRoundsBeforeResolution) {
    if (leader.topVotes >= scenario.scoring.instantConsensusVotes) {
      return {
        resolved: true,
        sacrificedNpcId: leader.candidateId,
        sacrificedLabel: leader.candidateLabel,
        resolutionType: "consensus",
        summary: roundResolutionSummary(leader.candidateLabel, "consensus"),
      } satisfies ResolutionState;
    }

    const leadGap = runnerUp
      ? leader.totalPressure - runnerUp.totalPressure
      : 0;

    if (leadGap >= scenario.scoring.leadGapThreshold) {
      return {
        resolved: true,
        sacrificedNpcId: leader.candidateId,
        sacrificedLabel: leader.candidateLabel,
        resolutionType: "threshold",
        summary: roundResolutionSummary(leader.candidateLabel, "threshold"),
      } satisfies ResolutionState;
    }
  }

  if (params.round.currentRound >= scenario.scoring.maxRounds) {
    return {
      resolved: true,
      sacrificedNpcId: leader.candidateId,
      sacrificedLabel: leader.candidateLabel,
      resolutionType: "max_rounds",
      summary: roundResolutionSummary(leader.candidateLabel, "max_rounds"),
    } satisfies ResolutionState;
  }

  return {
    resolved: false,
    sacrificedNpcId: null,
    sacrificedLabel: null,
    resolutionType: null,
    summary: null,
  } satisfies ResolutionState;
}

export function nextSpeakerState(params: {
  npc: NpcState;
  action: PlayerAction | null;
  structuredImpact: StructuredImpactInference;
}) {
  const baseDelta = buildRelationshipDeltaForNpc(params.action, params.npc.persona.id);
  const impactDelta = buildRelationshipDeltaFromImpact(params.structuredImpact);
  const delta = {
    trust: baseDelta.trust + impactDelta.trust,
    affinity: baseDelta.affinity + impactDelta.affinity,
    tension: baseDelta.tension + impactDelta.tension,
  } satisfies RelationshipDelta;

  const emotionReason =
    params.action === "expose"
      ? "새로 드러난 책임선 때문에 방어 본능이 더 강해졌다."
      : params.action === "confess"
        ? "플레이어의 자백이 계산을 다시 하게 만들었다."
        : params.action === "stall"
          ? "결정 지연이 오히려 긴장을 끌어올렸다."
          : params.structuredImpact.impactTags.includes("target_blame_high_up")
            ? "플레이어의 말이 특정 인물을 중심 책임선으로 강하게 밀어 올렸다."
            : params.structuredImpact.impactTags.some((tag) => tag.startsWith("player_"))
              ? "플레이어 자신에 대한 방 안의 평가가 흔들렸다."
          : params.npc.emotion.reason;

  const nextNpc = applyRelationshipDelta(params.npc, delta);

  return {
    npc: {
      ...nextNpc,
      emotion: {
        ...params.npc.emotion,
        reason: emotionReason,
        intensity: clamp(params.npc.emotion.intensity + delta.tension - delta.affinity, 0, 100),
      },
      statusLine: `${params.npc.persona.name}은(는) ${emotionReason}`,
    },
    relationshipDelta: delta,
  };
}

export function boardTargetLabel(candidateId: string | null, npcs: PersistedNpcState[]) {
  const namesById = Object.fromEntries(
    npcs.map((npc) => [npc.persona.id, npc.persona.name]),
  );

  return candidateId ? candidateLabel(candidateId, namesById) : DEFAULT_PLAYER_LABEL;
}
