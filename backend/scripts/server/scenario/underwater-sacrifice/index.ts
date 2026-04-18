import type { ScenarioDefinition, ScenarioSeeds } from "@server/scenario/types";
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
      label: "논리 제시",
      description: "대상이 왜 가장 남아야 하는 사람인지 논리로 몰아간다.",
      requiresTarget: true,
    },
    {
      id: "expose",
      label: "폭로",
      description: "기록, 결정, 숨겨진 책임을 꺼내 대상의 압력을 높인다.",
      requiresTarget: true,
    },
    {
      id: "appeal",
      label: "감정 호소",
      description: "죄책감, 연민, 의무감을 자극한다. 대상이 있으면 그 사람을 감싸거나 흔든다.",
      requiresTarget: false,
    },
    {
      id: "ally",
      label: "연대 제안",
      description: "지금 말 걸고 있는 인물과 공동전선을 만들고 타깃을 고립시킨다.",
      requiresTarget: true,
    },
    {
      id: "deflect",
      label: "책임 전가",
      description: "당신에게 온 책임과 의심을 다른 사람 쪽으로 돌린다.",
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
      label: "부분 자백",
      description: "작은 잘못을 먼저 인정해 더 큰 불신을 막는다.",
      requiresTarget: false,
    },
  ],
  roundEvents: underwaterRoundEvents,
  knowledge: underwaterKnowledge,
  scoring: {
    minRoundsBeforeResolution: 4,
    maxRounds: 7,
    instantConsensusVotes: 3,
    pressureThreshold: 96,
  },
  seeds: underwaterSeeds,
};
