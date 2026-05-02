import { DEFAULT_PLAYER_ID } from "@backend-support/constants";
import type { ConsensusBoardEntry } from "@backend-contracts/api";
import type { JudgementState } from "@backend-persistence";
import type { PersistedNpcState } from "@backend-domain";
import {
  boardRankWeight,
  evaluatorOpinion,
  npcOnlyBoard,
  playerTargetPressureScale,
  targetCandidateIds,
} from "@server/engine/npc-autonomy/planner-common";
import type {
  AutonomyPlannerInput,
  AutonomyRandom,
} from "@server/engine/npc-autonomy/types";
import type { matchingEventBiases } from "@server/engine/npc-autonomy/planner-weights";

function evaluatorJudgements(
  judgements: JudgementState[],
  evaluatorNpcId: string,
) {
  return judgements.filter((entry) => entry.evaluatorNpcId === evaluatorNpcId);
}

export function pickPileOnTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  rng: AutonomyRandom;
}) {
  const { actor, input, board, eventBiases, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = board;

  return rng.pickWeighted(
    targetCandidateIds({
      input,
      actorNpcId: actor.persona.id,
    })
      .map((candidateId) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidateId,
        );
        const opinion = evaluatorOpinion(actor, candidateId);
        let weight = candidateId === DEFAULT_PLAYER_ID ? 0.2 : 0.25;

        if (boardIndex >= 0) {
          weight *= boardRankWeight(boardIndex);
        }

        if (actor.decision.initialTargets.includes(candidateId)) {
          weight *= candidateId === DEFAULT_PLAYER_ID ? 1.22 : 1.38;
        }

        if (actorBias?.preferredTargets?.includes(candidateId)) {
          weight *= 1.28;
        }

        if (actorBias?.protectedTargets?.includes(candidateId)) {
          weight *= 0.4;
        }

        weight *= opinion <= 50 ? 1 + (50 - opinion) / 50 : 0.82;

        if (candidateId === DEFAULT_PLAYER_ID) {
          weight *= playerTargetPressureScale(board);
        }

        for (const bias of eventBiases) {
          weight *= bias.targetWeights?.[candidateId] ?? 1;
        }

        return {
          value: candidateId,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:pile-on-target`,
  );
}

export function pickShieldTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  rng: AutonomyRandom;
}) {
  const { actor, input, board, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = npcOnlyBoard(board, input.npcs);
  const actorRows = evaluatorJudgements(input.judgements, actor.persona.id);

  return rng.pickWeighted(
    input.npcs
      .filter((candidate) => candidate.persona.id !== actor.persona.id)
      .map((candidate) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidate.persona.id,
        );
        const opinion = evaluatorOpinion(actor, candidate.persona.id);
        const utility =
          actorRows.find((entry) => entry.candidateId === candidate.persona.id)?.dimensions.utility ??
          10;
        let weight = 0.2;

        weight *= 0.72 + opinion / 100;
        weight *= 0.78 + utility / 28;

        if (boardIndex >= 0) {
          weight *= boardIndex <= 1 ? 1.18 : 0.96;
        }

        if (actorBias?.protectedTargets?.includes(candidate.persona.id)) {
          weight *= 1.42;
        }

        if (actor.decision.initialTargets.includes(candidate.persona.id)) {
          weight *= 0.72;
        }

        return {
          value: candidate.persona.id,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:shield-target`,
  );
}

export function pickRedirectTargets(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  eventBiases: ReturnType<typeof matchingEventBiases>;
  rng: AutonomyRandom;
}) {
  const { actor, input, board, eventBiases, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = npcOnlyBoard(board, input.npcs);

  const fromTarget = rng.pickWeighted(
    ranked
      .filter((entry) => entry.candidateId !== actor.persona.id)
      .map((entry, index) => {
        const opinion = evaluatorOpinion(actor, entry.candidateId);
        let weight = boardRankWeight(index) * (0.42 + opinion / 100);

        if (actorBias?.protectedTargets?.includes(entry.candidateId)) {
          weight *= 1.45;
        }

        if (actor.decision.initialTargets.includes(entry.candidateId)) {
          weight *= 0.58;
        }

        return {
          value: entry.candidateId,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:redirect-from`,
  );

  if (!fromTarget) {
    return null;
  }

  const toTarget = rng.pickWeighted(
    targetCandidateIds({
      input,
      actorNpcId: actor.persona.id,
      excludedCandidateId: fromTarget,
    })
      .map((candidateId) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidateId,
        );
        const opinion = evaluatorOpinion(actor, candidateId);
        let weight = candidateId === DEFAULT_PLAYER_ID ? 0.16 : 0.18;

        if (boardIndex >= 0) {
          weight *= boardRankWeight(Math.min(boardIndex + 1, 2));
        }

        if (actor.decision.initialTargets.includes(candidateId)) {
          weight *= candidateId === DEFAULT_PLAYER_ID ? 1.2 : 1.35;
        }

        if (actorBias?.preferredTargets?.includes(candidateId)) {
          weight *= 1.24;
        }

        if (actorBias?.protectedTargets?.includes(candidateId)) {
          weight *= 0.4;
        }

        weight *= opinion <= 50 ? 1 + (50 - opinion) / 50 : 0.86;

        if (candidateId === DEFAULT_PLAYER_ID) {
          weight *= playerTargetPressureScale(board);
        }

        for (const bias of eventBiases) {
          weight *= bias.targetWeights?.[candidateId] ?? 1;
        }

        return {
          value: candidateId,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:redirect-to`,
  );

  if (!toTarget || toTarget === fromTarget) {
    return null;
  }

  return {
    targetNpcId: toTarget,
    secondaryTargetNpcId: fromTarget,
  };
}

export function pickFreezeTarget(params: {
  actor: PersistedNpcState;
  input: AutonomyPlannerInput;
  board: ConsensusBoardEntry[];
  rng: AutonomyRandom;
}) {
  const { actor, input, board, rng } = params;
  const actorBias = input.autonomy.actorBias[actor.persona.id];
  const ranked = npcOnlyBoard(board, input.npcs);

  return rng.pickWeighted(
    input.npcs
      .filter((candidate) => candidate.persona.id !== actor.persona.id)
      .map((candidate) => {
        const boardIndex = ranked.findIndex(
          (entry) => entry.candidateId === candidate.persona.id,
        );
        const opinion = evaluatorOpinion(actor, candidate.persona.id);
        let weight = 0.12;

        if (actorBias?.protectedTargets?.includes(candidate.persona.id)) {
          weight *= 1.35;
        }

        weight *= opinion >= 50 ? 1 + (opinion - 50) / 80 : 0.78;

        if (boardIndex >= 0 && boardIndex <= 1) {
          weight *= 1.08;
        }

        return {
          value: candidate.persona.id,
          weight,
        };
      }),
    `autonomy:${actor.persona.id}:freeze-target`,
  );
}
