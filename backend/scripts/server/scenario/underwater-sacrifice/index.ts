import type { ScenarioDefinition, ScenarioSeeds } from "@server/scenario/types";
import { appConfig } from "@server/config";
import { underwaterAutonomyConfig } from "@server/scenario/underwater-sacrifice/autonomy";
import { underwaterCharacters, underwaterMemories } from "@server/scenario/underwater-sacrifice/characters";
import { underwaterRoundEvents, underwaterSeedEvents } from "@server/scenario/underwater-sacrifice/events";
import { createUnderwaterInitialJudgements } from "@server/scenario/underwater-sacrifice/judgements";
import { underwaterKnowledge } from "@server/scenario/underwater-sacrifice/knowledge";
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
  id: "underwater-sacrifice",
  prompt: {
    systemContext:
      "You are the internal mind of one survivor trapped in a flooding underwater research station. The chamber only has enough escape capacity for four of five people. Everyone wants to live. Stay in-world, protect your own survival, and speak as a biased human under pressure.",
    replyGuidance:
      "Replies should feel immediate, tense, and natural in Korean. Do not become neutral too easily. Preserve this speaker's bias, grudges, fear, and self-justification. If the player says something persuasive, show partial movement, not total surrender.",
  },
  presentation: {
    appTitle: "펠라지아-9 탈출 협상",
    npcListTitle: "지금 말 걸 사람",
    npcListSubtitle: "누구를 움직일지 먼저 고르고, 그 입에서 다른 사람 이름이 나오게 만들어라.",
    interactionTitle: "한 턴 시작하기",
    interactionSubtitle: "한 사람을 설득해 다른 누군가를 더 위험하게 만들거나, 자신에게 몰린 시선을 흩뜨린다.",
    interactionPlaceholder: "예: 마지막 중단 결정을 미룬 쪽이 누구였는지부터 다시 짚어봅시다.",
    boardTitle: "현재 가장 위험한 사람",
    boardSubtitle: "지금 방 안에서 가장 많이 몰리고 있는 사람부터 읽어라.",
  },
  actions: [
    {
      id: "make_case",
      label: "책임 묻기",
      description: "타겟이 왜 희생되어야 하는지 논리부터 세운다.",
      requiresTarget: true,
    },
    {
      id: "expose",
      label: "사실 확인",
      description: "타겟에게 불리한 기록과 사실을 꺼내 몰아세운다.",
      requiresTarget: true,
    },
    {
      id: "appeal",
      label: "양심 흔들기",
      description: "죄책감과 연민을 자극해 상대의 판단을 흔든다.",
      requiresTarget: false,
    },
    {
      id: "ally",
      label: "편들기",
      description: "현재 대화상대와 한편이 되어 타겟을 고립시킨다.",
      requiresTarget: true,
    },
    {
      id: "deflect",
      label: "화살 돌리기",
      description: "당신에게 온 책임과 시선을 타겟에게 돌린다.",
      requiresTarget: true,
    },
    {
      id: "stall",
      label: "시간 끌기",
      description: "판단을 미루고 다음 라운드까지 버틴다.",
      requiresTarget: false,
    },
    {
      id: "confess",
      label: "작게 인정하기",
      description: "내 잘못을 먼저 인정해 나에게 몰린 압박을 낮춘다.",
      requiresTarget: false,
    },
  ],
  roundEvents: underwaterRoundEvents,
  knowledge: underwaterKnowledge,
  scoring: {
    minRoundsBeforeResolution: 4,
    maxRounds: 7,
    instantConsensusVotes: 3,
    leadGapThreshold: 140,
  },
  autonomy: {
    ...underwaterAutonomyConfig,
    debugSeed: appConfig.npcAutonomy.debugSeed,
  },
  seeds: underwaterSeeds,
};
