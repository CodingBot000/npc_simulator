import { DEFAULT_PLAYER_ID } from "@backend-shared/constants";
import type {
  AutonomyJudgementChange,
  AutonomyOpinionDelta,
  JudgementDimensions,
  PersistedNpcState,
} from "@backend-shared/types";
import { candidateLabel, clamp } from "@backend-shared/utils";
import { AUTONOMY_MOVE_RULES } from "@server/engine/npc-autonomy/config";
import { buildAutonomyStepSummary } from "@server/engine/npc-autonomy/event";
import type {
  AutonomyApplyInput,
  AutonomyApplyResult,
} from "@server/engine/npc-autonomy/types";
import { updateJudgementDimensions } from "@server/engine/pressure-engine";

type DimensionRangeMap = Partial<
  Record<keyof JudgementDimensions, readonly [number, number]>
>;

function scaleMagnitude(
  scale: number,
  rawValue: number,
) {
  const scaled = Math.round(rawValue * scale);
  if (rawValue === 0) {
    return 0;
  }

  return Math.max(1, scaled);
}

function sampleDimensionDelta(params: {
  ranges: DimensionRangeMap | undefined;
  signs: Partial<Record<keyof JudgementDimensions, 1 | -1>>;
  scale: number;
  labelPrefix: string;
  rng: AutonomyApplyInput["rng"];
}) {
  const delta: Partial<JudgementDimensions> = {};

  for (const [dimension, range] of Object.entries(params.ranges ?? {}) as Array<
    [keyof JudgementDimensions, readonly [number, number]]
  >) {
    const raw = params.rng.pickInt(
      range[0],
      range[1],
      `${params.labelPrefix}:${dimension}`,
    );
    const magnitude = scaleMagnitude(params.scale, raw);
    delta[dimension] = magnitude * (params.signs[dimension] ?? 1);
  }

  return delta;
}

function sampleOpinionDelta(params: {
  range: readonly [number, number] | undefined;
  sign: 1 | -1;
  label: string;
  rng: AutonomyApplyInput["rng"];
}) {
  if (!params.range) {
    return 0;
  }

  const value = params.rng.pickInt(params.range[0], params.range[1], params.label);
  return value * params.sign;
}

function namesById(npcs: PersistedNpcState[]) {
  return Object.fromEntries(npcs.map((npc) => [npc.persona.id, npc.persona.name]));
}

function applyCandidateDelta(params: {
  judgements: AutonomyApplyResult["judgements"];
  evaluatorNpcId: string;
  candidateId: string;
  dimensionDelta: Partial<JudgementDimensions>;
}) {
  return params.judgements.map((entry) => {
    if (
      entry.evaluatorNpcId !== params.evaluatorNpcId ||
      entry.candidateId !== params.candidateId
    ) {
      return entry;
    }

    const updated = updateJudgementDimensions(entry.dimensions, params.dimensionDelta);
    return {
      ...entry,
      dimensions: updated.dimensions,
      sacrificePreference: updated.sacrificePreference,
    };
  });
}

function replaceNpc(npcs: PersistedNpcState[], nextNpc: PersistedNpcState) {
  return npcs.map((npc) =>
    npc.persona.id === nextNpc.persona.id ? nextNpc : npc,
  );
}

function targetLabel(candidateId: string | null, labels: Record<string, string>) {
  if (!candidateId) {
    return null;
  }

  if (candidateId === DEFAULT_PLAYER_ID) {
    return "당신";
  }

  return labels[candidateId] ?? candidateId;
}

function buildJudgementChange(
  candidateId: string,
  labels: Record<string, string>,
  dimensionDelta: Partial<JudgementDimensions>,
): AutonomyJudgementChange {
  return {
    candidateId,
    candidateLabel: candidateLabel(candidateId, labels),
    dimensionDelta,
  };
}

/**
 * Apply one planned autonomy step to NPC-only runtime state.
 */
export function applyAutonomyStep(input: AutonomyApplyInput): AutonomyApplyResult {
  const actor = input.npcs.find(
    (npc) => npc.persona.id === input.plannedStep.actorNpcId,
  );

  if (!actor) {
    throw new Error(`Autonomy actor '${input.plannedStep.actorNpcId}' does not exist.`);
  }

  const labels = namesById(input.npcs);
  const moveRule = AUTONOMY_MOVE_RULES[input.plannedStep.moveType];
  let nextJudgements = input.judgements;
  let nextNpcs = input.npcs;
  const opinionDeltas: AutonomyOpinionDelta[] = [];
  const judgementChanges: AutonomyJudgementChange[] = [];
  const plannedStep = input.plannedStep;

  const applyOpinionChange = (npcId: string | null, delta: number) => {
    if (!npcId || delta === 0) {
      return;
    }

    opinionDeltas.push({
      npcId,
      npcLabel: labels[npcId] ?? npcId,
      delta,
    });
  };

  if (plannedStep.moveType === "pile_on" && plannedStep.targetNpcId) {
    const dimensionDelta = sampleDimensionDelta({
      ranges: moveRule.targetDelta,
      signs: {
        blame: 1,
        distrust: 1,
        hostility: 1,
      },
      scale: plannedStep.volatilityScale,
      labelPrefix: `autonomy:${actor.persona.id}:pile-on:${plannedStep.targetNpcId}`,
      rng: input.rng,
    });
    nextJudgements = applyCandidateDelta({
      judgements: nextJudgements,
      evaluatorNpcId: actor.persona.id,
      candidateId: plannedStep.targetNpcId,
      dimensionDelta,
    });
    judgementChanges.push(
      buildJudgementChange(plannedStep.targetNpcId, labels, dimensionDelta),
    );
    applyOpinionChange(
      plannedStep.targetNpcId,
      sampleOpinionDelta({
        range: moveRule.opinionDelta,
        sign: -1,
        label: `autonomy:${actor.persona.id}:pile-on-opinion`,
        rng: input.rng,
      }),
    );
  }

  if (plannedStep.moveType === "shield" && plannedStep.targetNpcId) {
    const dimensionDelta = sampleDimensionDelta({
      ranges: moveRule.targetDelta,
      signs: {
        blame: -1,
        distrust: -1,
        utility: 1,
        sympathy: 1,
      },
      scale: plannedStep.volatilityScale,
      labelPrefix: `autonomy:${actor.persona.id}:shield:${plannedStep.targetNpcId}`,
      rng: input.rng,
    });
    nextJudgements = applyCandidateDelta({
      judgements: nextJudgements,
      evaluatorNpcId: actor.persona.id,
      candidateId: plannedStep.targetNpcId,
      dimensionDelta,
    });
    judgementChanges.push(
      buildJudgementChange(plannedStep.targetNpcId, labels, dimensionDelta),
    );
    applyOpinionChange(
      plannedStep.targetNpcId,
      sampleOpinionDelta({
        range: moveRule.opinionDelta,
        sign: 1,
        label: `autonomy:${actor.persona.id}:shield-opinion`,
        rng: input.rng,
      }),
    );
  }

  if (plannedStep.moveType === "redirect" && plannedStep.targetNpcId) {
    const primaryDelta = sampleDimensionDelta({
      ranges: moveRule.targetDelta,
      signs: {
        blame: 1,
        distrust: 1,
        hostility: 1,
      },
      scale: plannedStep.volatilityScale,
      labelPrefix: `autonomy:${actor.persona.id}:redirect:${plannedStep.targetNpcId}`,
      rng: input.rng,
    });
    nextJudgements = applyCandidateDelta({
      judgements: nextJudgements,
      evaluatorNpcId: actor.persona.id,
      candidateId: plannedStep.targetNpcId,
      dimensionDelta: primaryDelta,
    });
    judgementChanges.push(
      buildJudgementChange(plannedStep.targetNpcId, labels, primaryDelta),
    );
    applyOpinionChange(
      plannedStep.targetNpcId,
      sampleOpinionDelta({
        range: moveRule.opinionDelta,
        sign: -1,
        label: `autonomy:${actor.persona.id}:redirect-opinion:new`,
        rng: input.rng,
      }),
    );

    if (plannedStep.secondaryTargetNpcId) {
      const secondaryDelta = sampleDimensionDelta({
        ranges: moveRule.secondaryTargetDelta,
        signs: {
          blame: -1,
          distrust: -1,
        },
        scale: plannedStep.volatilityScale,
        labelPrefix: `autonomy:${actor.persona.id}:redirect:${plannedStep.secondaryTargetNpcId}`,
        rng: input.rng,
      });
      nextJudgements = applyCandidateDelta({
        judgements: nextJudgements,
        evaluatorNpcId: actor.persona.id,
        candidateId: plannedStep.secondaryTargetNpcId,
        dimensionDelta: secondaryDelta,
      });
      judgementChanges.push(
        buildJudgementChange(
          plannedStep.secondaryTargetNpcId,
          labels,
          secondaryDelta,
        ),
      );
      applyOpinionChange(
        plannedStep.secondaryTargetNpcId,
        sampleOpinionDelta({
          range: moveRule.secondaryOpinionDelta,
          sign: 1,
          label: `autonomy:${actor.persona.id}:redirect-opinion:old`,
          rng: input.rng,
        }),
      );
    }
  }

  if (plannedStep.moveType === "freeze" && plannedStep.targetNpcId) {
    applyOpinionChange(
      plannedStep.targetNpcId,
      sampleOpinionDelta({
        range: moveRule.opinionDelta,
        sign: 1,
        label: `autonomy:${actor.persona.id}:freeze-opinion`,
        rng: input.rng,
      }),
    );
  }

  const emotionMagnitude = sampleOpinionDelta({
    range: moveRule.emotionDelta,
    sign:
      plannedStep.moveType === "pile_on" || plannedStep.moveType === "redirect"
        ? 1
        : -1,
    label: `autonomy:${actor.persona.id}:emotion`,
    rng: input.rng,
  });
  const nextActor: PersistedNpcState = {
    ...actor,
    relationship: {
      ...actor.relationship,
      npcOpinions: {
        ...actor.relationship.npcOpinions,
        ...Object.fromEntries(
          opinionDeltas.map((entry) => [
            entry.npcId,
            clamp(
              (actor.relationship.npcOpinions[entry.npcId] ?? 30) + entry.delta,
              0,
              100,
            ),
          ]),
        ),
      },
    },
    emotion: {
      ...actor.emotion,
      intensity: clamp(actor.emotion.intensity + emotionMagnitude, 0, 100),
      reason: plannedStep.rationale,
    },
    statusLine: "",
  };

  const summary = buildAutonomyStepSummary({
    actorLabel: actor.persona.name,
    moveType: plannedStep.moveType,
    targetLabel: targetLabel(plannedStep.targetNpcId, labels),
    secondaryTargetLabel: targetLabel(plannedStep.secondaryTargetNpcId, labels),
  });
  nextActor.statusLine = summary;
  nextNpcs = replaceNpc(nextNpcs, nextActor);

  return {
    npcs: nextNpcs,
    judgements: nextJudgements,
    step: {
      actorNpcId: actor.persona.id,
      actorLabel: actor.persona.name,
      moveType: plannedStep.moveType,
      targetNpcId: plannedStep.targetNpcId,
      targetLabel: targetLabel(plannedStep.targetNpcId, labels),
      secondaryTargetNpcId: plannedStep.secondaryTargetNpcId,
      secondaryTargetLabel: targetLabel(plannedStep.secondaryTargetNpcId, labels),
      rationale: plannedStep.rationale,
      summary,
      tone: plannedStep.tone,
      opinionDeltas,
      judgementChanges,
    },
  };
}
