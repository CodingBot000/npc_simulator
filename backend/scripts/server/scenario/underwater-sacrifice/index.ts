import type { ScenarioDefinition, ScenarioSeeds } from "@server/scenario/types";
import { appConfig } from "@server/config";
import { underwaterAutonomyConfig } from "@server/scenario/underwater-sacrifice/autonomy";
import { underwaterCharacters, underwaterMemories } from "@server/scenario/underwater-sacrifice/characters";
import { underwaterRoundEvents, underwaterSeedEvents } from "@server/scenario/underwater-sacrifice/events";
import { createUnderwaterInitialJudgements } from "@server/scenario/underwater-sacrifice/judgements";
import { underwaterKnowledge } from "@server/scenario/underwater-sacrifice/knowledge";
import { underwaterSacrificeMetadata } from "@server/scenario/underwater-sacrifice/metadata";
import {
  underwaterInitialResolutionState,
  underwaterInitialRoundState,
  underwaterWorld,
} from "@server/scenario/underwater-sacrifice/state";

const underwaterSeeds: ScenarioSeeds = {
  world: underwaterWorld,
  npcs: underwaterCharacters,
  memories: underwaterMemories,
  events: underwaterSeedEvents,
  round: underwaterInitialRoundState,
  judgements: createUnderwaterInitialJudgements(),
  resolution: underwaterInitialResolutionState,
};

export const underwaterSacrificeScenario: ScenarioDefinition = {
  id: underwaterSacrificeMetadata.id,
  prompt: {
    systemContext:
      "You are the internal mind of one survivor trapped in a flooding underwater research station. The chamber only has enough escape capacity for four of five people. Everyone wants to live. Stay in-world, protect your own survival, and speak as a biased human under pressure.",
    replyGuidance:
      "Replies should feel immediate, tense, and natural in Korean. Do not become neutral too easily. Preserve this speaker's bias, grudges, fear, and self-justification. If the player says something persuasive, show partial movement, not total surrender.",
  },
  presentation: underwaterSacrificeMetadata.presentation,
  actions: underwaterSacrificeMetadata.actions,
  roundEvents: underwaterRoundEvents,
  knowledge: underwaterKnowledge,
  scoring: underwaterSacrificeMetadata.scoring,
  autonomy: {
    ...underwaterAutonomyConfig,
    debugSeed: appConfig.npcAutonomy.debugSeed,
  },
  seeds: underwaterSeeds,
};
