import { DEFAULT_PLAYER_ID } from "@backend-shared/constants";
import type { JudgementDimensions, JudgementState } from "@backend-shared/types";

function judgementScore(dimensions: JudgementDimensions) {
  return (
    dimensions.blame +
    dimensions.distrust +
    dimensions.hostility +
    dimensions.dispensability -
    dimensions.utility -
    dimensions.sympathy
  );
}

function makeJudgement(
  evaluatorNpcId: string,
  candidateId: string,
  dimensions: JudgementDimensions,
): JudgementState {
  return {
    evaluatorNpcId,
    candidateId,
    dimensions,
    sacrificePreference: judgementScore(dimensions),
  };
}

export function createUnderwaterInitialJudgements() {
  return [
    makeJudgement("director", DEFAULT_PLAYER_ID, {
      blame: 12,
      distrust: 16,
      hostility: 11,
      dispensability: 19,
      utility: 8,
      sympathy: 3,
    }),
    makeJudgement("director", "director", {
      blame: 4,
      distrust: 3,
      hostility: 2,
      dispensability: 2,
      utility: 19,
      sympathy: 2,
    }),
    makeJudgement("director", "supervisor", {
      blame: 10,
      distrust: 9,
      hostility: 7,
      dispensability: 15,
      utility: 6,
      sympathy: 2,
    }),
    makeJudgement("director", "engineer", {
      blame: 9,
      distrust: 8,
      hostility: 8,
      dispensability: 6,
      utility: 17,
      sympathy: 3,
    }),
    makeJudgement("director", "doctor", {
      blame: 7,
      distrust: 6,
      hostility: 4,
      dispensability: 9,
      utility: 13,
      sympathy: 4,
    }),

    makeJudgement("supervisor", DEFAULT_PLAYER_ID, {
      blame: 10,
      distrust: 17,
      hostility: 10,
      dispensability: 20,
      utility: 6,
      sympathy: 2,
    }),
    makeJudgement("supervisor", "director", {
      blame: 12,
      distrust: 8,
      hostility: 7,
      dispensability: 9,
      utility: 12,
      sympathy: 1,
    }),
    makeJudgement("supervisor", "supervisor", {
      blame: 3,
      distrust: 3,
      hostility: 2,
      dispensability: 3,
      utility: 15,
      sympathy: 1,
    }),
    makeJudgement("supervisor", "engineer", {
      blame: 9,
      distrust: 13,
      hostility: 10,
      dispensability: 11,
      utility: 14,
      sympathy: 1,
    }),
    makeJudgement("supervisor", "doctor", {
      blame: 6,
      distrust: 10,
      hostility: 5,
      dispensability: 16,
      utility: 11,
      sympathy: 2,
    }),

    makeJudgement("engineer", DEFAULT_PLAYER_ID, {
      blame: 7,
      distrust: 8,
      hostility: 4,
      dispensability: 12,
      utility: 9,
      sympathy: 3,
    }),
    makeJudgement("engineer", "director", {
      blame: 18,
      distrust: 16,
      hostility: 14,
      dispensability: 13,
      utility: 7,
      sympathy: 1,
    }),
    makeJudgement("engineer", "supervisor", {
      blame: 17,
      distrust: 17,
      hostility: 15,
      dispensability: 14,
      utility: 5,
      sympathy: 1,
    }),
    makeJudgement("engineer", "engineer", {
      blame: 5,
      distrust: 4,
      hostility: 2,
      dispensability: 3,
      utility: 20,
      sympathy: 1,
    }),
    makeJudgement("engineer", "doctor", {
      blame: 6,
      distrust: 5,
      hostility: 3,
      dispensability: 8,
      utility: 13,
      sympathy: 5,
    }),

    makeJudgement("doctor", DEFAULT_PLAYER_ID, {
      blame: 5,
      distrust: 7,
      hostility: 3,
      dispensability: 9,
      utility: 8,
      sympathy: 6,
    }),
    makeJudgement("doctor", "director", {
      blame: 14,
      distrust: 12,
      hostility: 9,
      dispensability: 11,
      utility: 8,
      sympathy: 1,
    }),
    makeJudgement("doctor", "supervisor", {
      blame: 10,
      distrust: 13,
      hostility: 8,
      dispensability: 12,
      utility: 6,
      sympathy: 1,
    }),
    makeJudgement("doctor", "engineer", {
      blame: 8,
      distrust: 6,
      hostility: 3,
      dispensability: 6,
      utility: 12,
      sympathy: 6,
    }),
    makeJudgement("doctor", "doctor", {
      blame: 8,
      distrust: 5,
      hostility: 2,
      dispensability: 4,
      utility: 14,
      sympathy: 3,
    }),
  ];
}
