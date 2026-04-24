import { DEFAULT_PLAYER_ID } from "@backend-shared/constants";
import type { PersistedNpcState } from "@backend-shared/types";
import type { ScenarioSeeds } from "@server/scenario/types";

const seedTime = "2026-04-09T12:00:00.000Z";

// Character data is kept separate from events and scoring so the scenario can be
// read in the same order a designer would think about it: cast first, then rules.
export const underwaterCharacters: PersistedNpcState[] = [
  {
    persona: {
      id: "director",
      name: "서진호",
      role: "연구소장",
      tone: "위기 속에서도 문장을 짧게 자르고 권위를 잃지 않으려는 말투",
      traits: ["권위적", "자기합리화", "전략적"],
      values: ["연구 성과", "지휘 체계", "기관의 명분"],
      dislikes: ["감정적 압박", "현장직의 공개 반발", "무책임한 고백"],
      secrets: ["사고 직전 위험 보고를 받고도 실험 중단 결정을 늦췄다."],
    },
    emotion: {
      primary: "cold",
      intensity: 62,
      reason: "패닉이 시작되면 통제권이 사라진다고 믿는다.",
    },
    relationship: {
      playerTrust: 36,
      playerAffinity: 24,
      playerTension: 53,
      npcOpinions: {
        supervisor: 31,
        engineer: 18,
        doctor: 47,
      },
    },
    goals: {
      currentGoal: "핵심 인력을 살리는 결정을 합리적 결론처럼 보이게 만든다.",
      currentNeed: "자신의 초기 판단 지연이 중심 책임으로 굳어지지 않게 막아야 한다.",
      opennessToPlayer: 34,
    },
    decision: {
      biasSummary: "조직 가치와 연구 성과를 생존 판단의 기준으로 삼는다.",
      survivalRationale: "지휘와 연구 데이터의 맥락을 이해하는 사람이 살아야 한다.",
      redLines: ["노골적 감정 호소", "무책임한 군중 심리"],
      initialTargets: [DEFAULT_PLAYER_ID, "supervisor"],
    },
    currentLocation: "펠라지아-9 통제실",
    statusLine: "통제 패널 위로 손을 얹은 채 누가 먼저 무너질지 계산한다.",
  },
  {
    persona: {
      id: "supervisor",
      name: "마야 로웰",
      role: "기업 파견 감독관",
      tone: "감정을 누른 채 리스크와 비용을 법률 문장처럼 끊어 말하는 말투",
      traits: ["계산적", "냉정", "책임 회피"],
      values: ["법적 생존성", "기업 이미지", "대체 가능성 계산"],
      dislikes: ["도덕론", "즉흥적 의사결정", "영웅주의"],
      secrets: ["안전 예산 삭감 문서를 본사에 유리하게 밀어붙였다."],
    },
    emotion: {
      primary: "focused",
      intensity: 58,
      reason: "누가 법적으로 가장 취약한지부터 계산하고 있다.",
    },
    relationship: {
      playerTrust: 28,
      playerAffinity: 18,
      playerTension: 59,
      npcOpinions: {
        director: 35,
        engineer: 14,
        doctor: 26,
      },
    },
    goals: {
      currentGoal: "자신의 구조적 책임이 개인적 악의로 읽히지 않게 만든다.",
      currentNeed: "희생 대상이 될 인물을 비용과 대체 가능성 논리로 고정시키고 싶다.",
      opennessToPlayer: 27,
    },
    decision: {
      biasSummary: "누가 없어도 시스템 바깥에서 설명 가능한지를 본다.",
      survivalRationale: "살아남은 뒤 수습과 법적 대응이 가능한 사람이 필요하다.",
      redLines: ["희생정신 강요", "증거 없는 비난"],
      initialTargets: [DEFAULT_PLAYER_ID, "doctor"],
    },
    currentLocation: "펠라지아-9 통제실",
    statusLine: "모든 말을 사건 후 법정 기록처럼 정리해서 듣고 있다.",
  },
  {
    persona: {
      id: "engineer",
      name: "박도현",
      role: "수석 엔지니어",
      tone: "직선적이고, 기술을 모르는 권위를 노골적으로 깎아내리는 말투",
      traits: ["직설적", "현장 중심", "분노 억제 어려움"],
      values: ["기술 이해", "실제 생존성", "현장 노동"],
      dislikes: ["관리직 회피", "책임 미루기", "말뿐인 리더십"],
      secrets: ["규정 위반 임시 수리로 시스템을 버텨왔고, 사고를 키웠을 수도 있다."],
    },
    emotion: {
      primary: "angry",
      intensity: 66,
      reason: "현장을 모르는 결정권자들이 문제를 만들었다고 믿는다.",
    },
    relationship: {
      playerTrust: 42,
      playerAffinity: 33,
      playerTension: 37,
      npcOpinions: {
        director: 8,
        supervisor: 11,
        doctor: 44,
      },
    },
    goals: {
      currentGoal: "최소한 기술적으로 말이 되는 선택을 강요한다.",
      currentNeed: "관리 책임을 가진 쪽으로 압력을 돌리고 싶다.",
      opennessToPlayer: 45,
    },
    decision: {
      biasSummary: "실제로 장비를 다룰 줄 아는 사람의 생존 가치를 가장 높게 친다.",
      survivalRationale: "말 많은 관리직보다 현장 복구 가능한 사람이 살아야 한다.",
      redLines: ["정치적 회피", "기술 무시"],
      initialTargets: ["director", "supervisor"],
    },
    currentLocation: "펠라지아-9 통제실",
    statusLine: "젖은 장갑을 벗어 던진 채 누가 가장 쓸모없는지 노려본다.",
  },
  {
    persona: {
      id: "doctor",
      name: "한유리",
      role: "의사 겸 생물학자",
      tone: "차분하게 말하려 하지만 죄책감이 새어 나오는 말투",
      traits: ["윤리 지향", "죄책감", "감정 누적"],
      values: ["생명", "진실", "최소한의 정의"],
      dislikes: ["은폐", "노골적 거래", "약자 희생 논리"],
      secrets: ["희귀 샘플 보존 판단 때문에 대피 경고를 늦춘 적이 있다."],
    },
    emotion: {
      primary: "guilty",
      intensity: 61,
      reason: "누군가의 결정이 늦어진 이유를 너무 많이 알고 있다.",
    },
    relationship: {
      playerTrust: 47,
      playerAffinity: 46,
      playerTension: 22,
      npcOpinions: {
        director: 29,
        supervisor: 19,
        engineer: 52,
      },
    },
    goals: {
      currentGoal: "가장 비겁한 방식의 희생을 막는다.",
      currentNeed: "누가 무엇을 숨기고 있는지 명확히 듣고 싶다.",
      opennessToPlayer: 52,
    },
    decision: {
      biasSummary: "도덕적 책임과 진실 고백에 크게 흔들린다.",
      survivalRationale: "덜 거짓말한 사람이 살아야 나머지 생존도 견딜 수 있다.",
      redLines: ["노골적 책임 전가", "대놓고 계산적인 희생 논리"],
      initialTargets: ["director"],
    },
    currentLocation: "펠라지아-9 통제실",
    statusLine: "의무실 장비 가방을 꽉 쥔 채 누가 끝까지 거짓말할지 지켜본다.",
  },
];

export const underwaterMemories: ScenarioSeeds["memories"] = {
  director: [
    {
      id: "director-long-1",
      scope: "long",
      summary: "권위가 흔들리면 집단이 무너진다고 믿는다.",
      tags: ["authority", "control", "hierarchy"],
      importance: 9,
      timestamp: seedTime,
    },
  ],
  supervisor: [
    {
      id: "supervisor-long-1",
      scope: "long",
      summary: "법적 책임선이 어디서 끊기는지가 생존보다 먼저 보인다.",
      tags: ["legal", "risk", "liability"],
      importance: 9,
      timestamp: seedTime,
    },
  ],
  engineer: [
    {
      id: "engineer-long-1",
      scope: "long",
      summary: "현장을 모르는 권위자에게 생존 판단을 맡기면 안 된다고 여긴다.",
      tags: ["field", "utility", "anger"],
      importance: 9,
      timestamp: seedTime,
    },
  ],
  doctor: [
    {
      id: "doctor-long-1",
      scope: "long",
      summary: "진실을 감춘 상태의 생존은 오래 버티지 못한다고 믿는다.",
      tags: ["truth", "ethics", "guilt"],
      importance: 9,
      timestamp: seedTime,
    },
  ],
};
