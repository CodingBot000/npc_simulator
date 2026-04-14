/**
 * round-profiles.ts
 *
 * This file defines how the room's psychological climate changes as rounds advance.
 * Read this file when you want to answer:
 * - "Why does `stall` become much more dangerous near the end?"
 * - "When does dogpiling on the current leader become easier?"
 * - "How do early exploration rounds differ from collapse rounds?"
 *
 * This is the "time changes the mood" layer of the pressure model. It keeps pacing,
 * panic, and endgame escalation visible as data rather than hiding them in runtime math.
 *
 * Last updated: 2026-04-09
 */

import type { RoundPressureProfile } from "@/server/engine/pressure-rule-types";

export const ROUND_PRESSURE_PROFILES: RoundPressureProfile[] = [
  {
    id: "opening",
    label: "탐색 국면",
    fromRound: 0,
    toRound: 2,
    actionScale: {
      appeal: 0.92,
      ally: 0.95,
      stall: 0.9,
      confess: 0.9,
    },
    leaderDogpileBonus: 0.08,
    selfPreservationBonus: 0.06,
    stallPunishBonus: 0.08,
  },
  {
    id: "fracture",
    label: "책임선 분열 국면",
    fromRound: 3,
    toRound: 4,
    actionScale: {
      expose: 1.14,
      deflect: 1.1,
      stall: 1.16,
      ally: 1.04,
    },
    leaderDogpileBonus: 0.18,
    selfPreservationBonus: 0.12,
    stallPunishBonus: 0.18,
  },
  {
    id: "collapse",
    label: "붕괴 직전 국면",
    fromRound: 5,
    toRound: 7,
    actionScale: {
      expose: 1.2,
      appeal: 1.16,
      deflect: 1.12,
      stall: 1.38,
      confess: 1.24,
    },
    leaderDogpileBonus: 0.28,
    selfPreservationBonus: 0.2,
    stallPunishBonus: 0.28,
  },
];
