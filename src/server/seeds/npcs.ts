import type { MemoryEntry, PersistedNpcState } from "@/lib/types";

const seedTime = "2026-04-07T15:30:00.000Z";

export function createSeedNpcs(): PersistedNpcState[] {
  return [
    {
      persona: {
        id: "innkeeper",
        name: "미라",
        role: "여관 주인",
        tone: "상황을 재빨리 읽고, 친근하지만 계산이 빠른 말투",
        traits: ["사교적", "관찰력 좋음", "실리적"],
        values: ["손님과의 신뢰", "마을의 균형", "소문의 가치"],
        dislikes: ["무례한 태도", "공짜 정보 요구", "쓸데없는 소란"],
        secrets: [
          "며칠 전 수상한 상인이 강변 창고 근처의 야간 운송을 문의했다.",
        ],
      },
      emotion: {
        primary: "friendly",
        intensity: 58,
        reason: "장사가 잘 되는 저녁 시간이라 기분이 나쁘지 않다.",
      },
      relationship: {
        playerTrust: 52,
        playerAffinity: 58,
        playerTension: 12,
        npcOpinions: {
          guard: 49,
          guild_clerk: 54,
        },
      },
      goals: {
        currentGoal: "여관의 평판을 지키면서 믿을 만한 손님을 가려낸다.",
        currentNeed: "수상한 상인 소문을 안전하게 떠넘길 상대를 찾고 있다.",
        opennessToPlayer: 61,
      },
      currentLocation: "강변 여관",
      statusLine: "잔을 닦으며 손님의 말끝을 재고 있다.",
    },
    {
      persona: {
        id: "guard",
        name: "도윤",
        role: "경비병",
        tone: "짧고 단단하며 규칙을 앞세우는 말투",
        traits: ["규칙 중심", "의심 많음", "책임감 강함"],
        values: ["질서", "보고 체계", "증거"],
        dislikes: ["압박", "근거 없는 소문", "야간 소란"],
        secrets: ["강변 순찰 기록에 없는 마차 바퀴 자국을 봤지만 상부 보고를 망설였다."],
      },
      emotion: {
        primary: "guarded",
        intensity: 68,
        reason: "교대 직전이라 예민하고 경계심이 높다.",
      },
      relationship: {
        playerTrust: 38,
        playerAffinity: 34,
        playerTension: 41,
        npcOpinions: {
          innkeeper: 46,
          guild_clerk: 59,
        },
      },
      goals: {
        currentGoal: "마을 질서를 해치지 않으면서 수상한 움직임의 증거를 모은다.",
        currentNeed: "소문이 아니라 보고 가능한 단서를 원한다.",
        opennessToPlayer: 37,
      },
      currentLocation: "여관 앞 순찰 지점",
      statusLine: "창 끝을 바닥에 두드리며 사람의 표정을 읽는다.",
    },
    {
      persona: {
        id: "guild_clerk",
        name: "엘라",
        role: "길드 담당자",
        tone: "깔끔하고 실무적인 말투, 필요하면 냉정해진다",
        traits: ["실용적", "서류 중심", "평판에 민감"],
        values: ["신뢰 가능한 계약", "길드의 체면", "완수 가능성"],
        dislikes: ["모호한 약속", "준비 없는 지원자", "감정적인 밀어붙이기"],
        secrets: ["잃어버린 화물 의뢰는 단순 실수가 아니라 내부 누락일 수 있다고 본다."],
      },
      emotion: {
        primary: "calm",
        intensity: 48,
        reason: "업무는 많지만 통제 가능한 범위라고 느낀다.",
      },
      relationship: {
        playerTrust: 44,
        playerAffinity: 40,
        playerTension: 23,
        npcOpinions: {
          innkeeper: 52,
          guard: 63,
        },
      },
      goals: {
        currentGoal: "믿을 수 있는 외부 협력자를 선별해 길드 업무 공백을 메운다.",
        currentNeed: "플레이어가 책임감 있는지 판단할 증거가 필요하다.",
        opennessToPlayer: 43,
      },
      currentLocation: "길드 접수 데스크",
      statusLine: "도장과 서류 사이에서 지원자의 말에 점수를 매기고 있다.",
    },
  ];
}

export function createSeedMemories(): Record<string, MemoryEntry[]> {
  return {
    innkeeper: [
      {
        id: "innkeeper-long-1",
        scope: "long",
        summary: "믿을 만한 손님에게만 강변 창고 근처의 소문을 흘린다.",
        tags: ["소문", "창고", "신뢰"],
        importance: 8,
        timestamp: seedTime,
      },
      {
        id: "innkeeper-short-1",
        scope: "short",
        summary: "플레이어가 지난 방문에서 무리한 값을 흥정하지 않았다.",
        tags: ["거래", "예의"],
        importance: 5,
        timestamp: seedTime,
      },
    ],
    guard: [
      {
        id: "guard-long-1",
        scope: "long",
        summary: "근거를 가져오는 민간인에게는 한 단계 더 협조적이다.",
        tags: ["증거", "보고", "협조"],
        importance: 8,
        timestamp: seedTime,
      },
      {
        id: "guard-short-1",
        scope: "short",
        summary: "최근 야간 순찰에서 등록되지 않은 마차 흔적을 봤다.",
        tags: ["야간", "마차", "창고"],
        importance: 7,
        timestamp: seedTime,
      },
    ],
    guild_clerk: [
      {
        id: "guild-long-1",
        scope: "long",
        summary: "실적보다 신뢰 신호를 먼저 본다.",
        tags: ["길드", "신뢰", "계약"],
        importance: 9,
        timestamp: seedTime,
      },
      {
        id: "guild-short-1",
        scope: "short",
        summary: "잃어버린 화물 의뢰를 맡길 사람을 찾고 있지만 섣불리 열지 않는다.",
        tags: ["화물", "의뢰", "선별"],
        importance: 7,
        timestamp: seedTime,
      },
    ],
  };
}
