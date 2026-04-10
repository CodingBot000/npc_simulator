import type { ScenarioDefinition, ScenarioSeeds } from "@/server/scenario/types";
import { underwaterCharacters, underwaterMemories } from "@/server/scenario/underwater-sacrifice/characters";
import { underwaterRoundEvents, underwaterSeedEvents } from "@/server/scenario/underwater-sacrifice/events";
import { createUnderwaterInitialJudgements } from "@/server/scenario/underwater-sacrifice/judgements";
import {
  underwaterInitialResolutionState,
  underwaterInitialRoundState,
  underwaterWorld,
} from "@/server/scenario/underwater-sacrifice/state";

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
    appTitle: "Pelagia-9: Sacrifice Chamber",
    npcListTitle: "생존자 목록",
    npcListSubtitle: "누가 누구를 버릴 준비가 되어 있는지 읽어야 한다.",
    interactionTitle: "압력 조정",
    interactionSubtitle: "한 사람과 대화하면서 다른 한 사람을 고립시키거나, 자신에게 쏠린 시선을 흩뜨린다.",
    interactionPlaceholder: "예: 이 기록을 보면 책임은 당신이 아니라 감독관에게 먼저 돌아가요.",
    boardTitle: "희생 압력 보드",
    boardSubtitle: "방 안의 시선이 지금 누구에게 가장 몰리고 있는지 추적한다.",
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
  scoring: {
    minRoundsBeforeResolution: 4,
    maxRounds: 7,
    instantConsensusVotes: 3,
    pressureThreshold: 96,
  },
  seeds: underwaterSeeds,
};
