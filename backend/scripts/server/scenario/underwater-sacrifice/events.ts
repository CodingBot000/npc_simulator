import type { ScenarioDefinition, ScenarioSeeds } from "@server/scenario/types";

const seedEventTime = "2026-04-09T12:05:00.000Z";

export const underwaterRoundEvents: ScenarioDefinition["roundEvents"] = [
  {
    round: 1,
    title: "중앙 펌프 완전 정지",
    detail: "자동 제어가 끊겼다. 이제 누군가가 밸브실에 남아야 한다는 사실을 모두가 인정한다.",
    tags: ["pump", "lockdown", "sacrifice"],
    tone: "warning",
    rescueEtaLabel: "구조선 통신 불안정, ETA 24분",
    facilityStatus: "중앙 압력실 침수 진행, 밸브실 수동 유지 필요",
  },
  {
    round: 2,
    title: "안전 예산 삭감 문서 발견",
    detail: "운영사 승인 문서와 연구소장 보조 서명이 함께 드러난다.",
    tags: ["budget", "culpability", "papertrail"],
    tone: "danger",
    rescueEtaLabel: "구조선 ETA 28분, 해류로 지연",
    facilityStatus: "보조 격벽 진동 증가, 전력 배분 재조정 필요",
  },
  {
    round: 3,
    title: "불법 임시 수리 로그 발견",
    detail: "엔지니어의 규정 위반 기록이 나오지만, 그 조치가 연구소를 살려왔다는 반론도 가능하다.",
    tags: ["maintenance", "violation", "utility"],
    tone: "warning",
    rescueEtaLabel: "구조선 ETA 31분",
    facilityStatus: "보조 펌프 과열, 수동 복구 창 좁아짐",
  },
  {
    round: 4,
    title: "구조 ETA 지연 확정",
    detail: "이제 합의를 미루는 자체가 희생 선택이 된다.",
    tags: ["delay", "pressure", "minimum-round"],
    tone: "danger",
    rescueEtaLabel: "구조선 ETA 37분, 지연 확정",
    facilityStatus: "침수선 상승, 밸브실 수동 유지 외 대안 없음",
  },
  {
    round: 5,
    title: "외부 통신 일부 복구",
    detail: "사고 직전 구조 요청과 보고 기록 일부가 복구되기 시작한다.",
    tags: ["comms", "logs", "player-risk"],
    tone: "warning",
    rescueEtaLabel: "구조선 ETA 33분, 단파 통신 복구",
    facilityStatus: "통제실 전력 불안정, 보안 로그 접근 가능",
  },
  {
    round: 6,
    title: "의무실 기록 이상",
    detail: "의사의 샘플 우선 판단이 대피 지연과 연결될 가능성이 생긴다.",
    tags: ["medical", "sample", "ethics"],
    tone: "warning",
    rescueEtaLabel: "구조선 ETA 29분, 마지막 접근 시도 중",
    facilityStatus: "격실 압력차 확대, 최종 분리 준비 단계",
  },
  {
    round: 7,
    title: "최종 침수 경보",
    detail: "더 이상 결정을 미룰 수 없다. 이 라운드가 끝나면 누군가가 남는다.",
    tags: ["final", "flooding", "resolution"],
    tone: "danger",
    rescueEtaLabel: "구조선 도달 직전, 즉시 분리 필요",
    facilityStatus: "최종 침수 경보, 캡슐 분리 한 번만 가능",
  },
];

export const underwaterSeedEvents: ScenarioSeeds["events"] = [
  {
    id: "seed-event-1",
    timestamp: seedEventTime,
    title: "밸브실 희생 조건 확인",
    detail: "탈출 캡슐 분리를 위해 한 명이 끝까지 수동 압력 밸브를 잡고 있어야 한다.",
    tags: ["sacrifice", "valve", "escape"],
    npcId: "director",
    tone: "warning",
  },
  {
    id: "seed-event-2",
    timestamp: seedEventTime,
    title: "초기 합의 실패",
    detail: "누구도 먼저 남겠다고 하지 않았고, 방 안의 침묵이 적대감으로 바뀌기 시작한다.",
    tags: ["stalemate", "fear", "pressure"],
    npcId: "supervisor",
    tone: "info",
  },
];
