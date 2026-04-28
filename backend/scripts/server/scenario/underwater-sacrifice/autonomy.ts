import type { ScenarioAutonomyConfig } from "@server/scenario/types";

export const underwaterAutonomyConfig: Omit<
  ScenarioAutonomyConfig,
  "debugSeed"
> = {
  enabled: true,
  minStepsPerTurn: 1,
  maxStepsPerTurn: 2,
  moveWeights: {
    pile_on: 1,
    shield: 1.15,
    redirect: 1.22,
    freeze: 0.78,
  },
  roundVolatility: [
    { fromRound: 0, toRound: 2, scale: 0.9 },
    { fromRound: 3, toRound: 4, scale: 1 },
    { fromRound: 5, toRound: 7, scale: 1.12 },
  ],
  actorBias: {
    director: {
      actorWeight: 0.95,
      preferredTargets: ["supervisor"],
      moveWeights: {
        redirect: 1.18,
        pile_on: 0.94,
      },
      eventTagAffinity: ["budget", "papertrail", "delay"],
    },
    supervisor: {
      actorWeight: 0.92,
      preferredTargets: ["director", "doctor"],
      moveWeights: {
        redirect: 1.24,
        shield: 0.82,
      },
      eventTagAffinity: ["budget", "culpability", "player-risk"],
    },
    engineer: {
      actorWeight: 1.14,
      preferredTargets: ["director", "supervisor"],
      protectedTargets: ["doctor"],
      moveWeights: {
        pile_on: 1.36,
        freeze: 0.74,
      },
      eventTagAffinity: ["maintenance", "violation", "utility", "pressure"],
    },
    doctor: {
      actorWeight: 1.04,
      preferredTargets: ["director"],
      protectedTargets: ["engineer"],
      moveWeights: {
        shield: 1.28,
        freeze: 1.14,
        pile_on: 0.86,
      },
      eventTagAffinity: ["ethics", "sample", "medical", "truth"],
    },
  },
  eventBiases: [
    {
      tag: "budget",
      actorWeights: {
        supervisor: 1.08,
        engineer: 1.1,
      },
      targetWeights: {
        supervisor: 1.24,
        director: 1.08,
      },
      moveWeights: {
        pile_on: 1.14,
      },
    },
    {
      tag: "culpability",
      actorWeights: {
        director: 1.08,
        engineer: 1.06,
      },
      targetWeights: {
        supervisor: 1.16,
        director: 1.1,
      },
      moveWeights: {
        pile_on: 1.12,
        redirect: 1.08,
      },
    },
    {
      tag: "papertrail",
      actorWeights: {
        supervisor: 1.08,
        director: 1.06,
      },
      targetWeights: {
        supervisor: 1.14,
        director: 1.14,
      },
      moveWeights: {
        pile_on: 1.1,
      },
    },
    {
      tag: "maintenance",
      actorWeights: {
        engineer: 1.1,
        doctor: 1.04,
      },
      targetWeights: {
        engineer: 1.18,
      },
      moveWeights: {
        redirect: 1.16,
        shield: 1.08,
      },
    },
    {
      tag: "violation",
      targetWeights: {
        engineer: 1.16,
      },
      moveWeights: {
        redirect: 1.14,
      },
    },
    {
      tag: "utility",
      targetWeights: {
        engineer: 0.86,
        director: 1.06,
        supervisor: 1.06,
      },
      moveWeights: {
        shield: 1.12,
      },
    },
    {
      tag: "delay",
      actorWeights: {
        director: 1.04,
        supervisor: 1.04,
      },
      moveWeights: {
        pile_on: 1.16,
        redirect: 1.1,
      },
    },
    {
      tag: "pressure",
      moveWeights: {
        pile_on: 1.12,
        redirect: 1.08,
      },
    },
    {
      tag: "medical",
      actorWeights: {
        doctor: 1.06,
      },
      targetWeights: {
        doctor: 1.2,
      },
      moveWeights: {
        redirect: 1.14,
      },
    },
    {
      tag: "sample",
      targetWeights: {
        doctor: 1.18,
      },
      moveWeights: {
        redirect: 1.16,
      },
    },
    {
      tag: "ethics",
      actorWeights: {
        doctor: 1.08,
      },
      moveWeights: {
        shield: 1.12,
        freeze: 1.08,
      },
    },
  ],
};
