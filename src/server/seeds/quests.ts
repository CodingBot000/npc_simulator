import type { Quest } from "@/lib/types";

export function createSeedQuests(): Quest[] {
  return [
    {
      id: "lost-cargo",
      title: "잃어버린 화물의 행방",
      giverNpcId: "guild_clerk",
      status: "available",
      summary:
        "길드 담당자는 강변 창고에서 사라진 화물의 흔적을 찾을 사람을 찾고 있다.",
      requirements: ["길드 담당자와 신뢰를 쌓기", "창고 주변 단서 파악"],
      rewards: ["길드 신뢰 상승", "은화 12"],
    },
    {
      id: "suspicious-merchant",
      title: "수상한 상인 추적",
      giverNpcId: "innkeeper",
      status: "locked",
      summary:
        "여관 주인이 수상한 상인 이야기를 풀어놓을지 아직 확신하지 못하고 있다.",
      requirements: ["여관 주인에게 소문을 듣기", "경비병에게 증거를 제시하기"],
      rewards: ["경비병 협조", "길드 신뢰 상승"],
    },
    {
      id: "guild-charter",
      title: "길드 신뢰 확보",
      giverNpcId: "guild_clerk",
      status: "locked",
      summary:
        "길드 담당자는 책임감 있는 지원자에게만 정식 의뢰 문서를 연다.",
      requirements: ["길드 담당자 신뢰 58 이상", "실행 가능한 제안 제시"],
      rewards: ["정식 의뢰 접근", "길드 내부 정보"],
    },
  ];
}
