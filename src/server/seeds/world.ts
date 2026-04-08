import type {
  EventLogEntry,
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@/lib/types";
import { createSeedMemories, createSeedNpcs } from "@/server/seeds/npcs";
import { createSeedQuests } from "@/server/seeds/quests";

const seedEventTime = "2026-04-07T16:00:00.000Z";

function createSeedEvents(): EventLogEntry[] {
  return [
    {
      id: "seed-event-1",
      timestamp: seedEventTime,
      title: "강변 여관에 소문이 돈다",
      detail:
        "미라가 며칠째 같은 문장으로 수상한 상인을 언급하는 손님을 기억하고 있다.",
      tags: ["소문", "여관", "상인"],
      npcId: "innkeeper",
      tone: "info",
    },
    {
      id: "seed-event-2",
      timestamp: seedEventTime,
      title: "경비 순찰이 늘어났다",
      detail:
        "도윤은 여관 앞과 창고 사이의 이동 기록이 맞지 않는다고 느끼고 있다.",
      tags: ["경비", "창고", "순찰"],
      npcId: "guard",
      tone: "warning",
    },
  ];
}

export function createSeedWorldState(): WorldStateFile {
  return {
    world: {
      location: "강변 허브 마을",
      time: "저녁",
      weather: "맑음",
      mood: "소문과 의뢰가 뒤섞인 분주한 시간",
    },
    npcs: createSeedNpcs(),
    quests: createSeedQuests(),
    events: createSeedEvents(),
    lastInspector: null,
  };
}

export function createSeedMemoryFile(): NpcMemoryFile {
  return {
    memories: createSeedMemories(),
  };
}

export function createSeedInteractionLog(): InteractionLogFile {
  return {
    entries: [],
  };
}
