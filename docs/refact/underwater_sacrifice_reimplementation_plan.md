# Underwater Sacrifice Reimplementation Plan

## 문서 목적

이 문서는 현재 저장소를 `중세 마을형 NPC 시뮬레이터`에서
`침수 중인 해저연구소 생존 협상 시뮬레이터`로 재구현하기 위한
실행 지시서다.

시나리오 정의는 `underwater_sacrifice_scenario_spec.md`가 담당하고,
이 문서는 그 시나리오를 현재 코드베이스에 어떻게 녹일지 설명한다.

## 가장 중요한 방향

이번 작업은 단순한 seed 교체가 아니다.

- `퀘스트 협상형 NPC` 구조를
  `다자 생존 협상 + 희생 압력 축적` 구조로 바꾼다.
- medieval 전용 데이터와 규칙을 더 이상 중심에 두지 않는다.
- theme separation 1차 작업을 넘어, `게임 루프` 자체를 바꾼다.

## 구현 전 필수 확인

코드 작성 전 반드시 아래 문서를 읽는다.

- `node_modules/next/dist/docs/01-app/index.md`
- `node_modules/next/dist/docs/01-app/04-glossary.md`

현재 저장소는 `Next.js 16.2.2` 기준이다.
기존 학습 기억으로 App Router를 추정하지 말고 실제 로컬 문서를 기준으로 구현한다.

## 유지할 것

- Next.js App Router
- TypeScript
- file-based store
- `GET /api/world`
- `POST /api/interact` 또는 동등한 단일 턴 처리 API
- `POST /api/reset`
- 감독자 모드
- LLM provider abstraction (`codex`, `openai`)

## 버릴 것 또는 바꿀 것

- medieval 전용 world copy
- `innkeeper`, `guard`, `guild_clerk` 중심 seed
- 퀘스트 잠금/진행/완료 루프
- 소문 기반 허브 탐색 루프
- 여관/길드/마을 문맥에 묶인 프롬프트

## 제품 레벨 변경점

### 기존

- 작은 허브에서 NPC를 선택한다
- 관계를 쌓아 퀘스트를 열고 진행한다
- 상호작용 결과가 다른 NPC 태도와 퀘스트에 영향을 준다

### 신규

- 폐쇄된 위기 현장에서 다자 협상을 진행한다
- 각 턴마다 생존자들의 숨은 평가가 흔들린다
- 목표는 자신이 아닌 다른 사람이 희생 대상으로 고립되게 만드는 것이다
- 퀘스트 대신 `희생 압력`, `합의 흐름`, `턴 이벤트`가 게임 진행을 이끈다

## 아키텍처 원칙

### 1. Scenario 레이어는 유지하되 더 강하게 쓴다

- `src/server/scenario/medieval.ts` 하나에 설정만 담는 수준으로는 부족하다.
- 이번 단계에서는 scenario가 아래를 모두 가져야 한다.
  - presentation copy
  - seed state
  - action catalog
  - round event sequence
  - prompt guidance
  - scoring config
  - resolution rules

### 2. Quest 엔진을 억지로 살리지 않는다

현재 구조가 quest 중심이라면, 이번 시나리오에서는 `quest-engine`을
유지하려고 우회하지 않는다.

권장 방향:

- `quest-engine` 제거 또는 비활성화
- `resolution-engine` 혹은 `pressure-engine` 도입
- 화면의 퀘스트 패널은 `Consensus Board` 또는 `Sacrifice Pressure Board`로 교체

### 3. LLM은 말과 심리를, 코드는 숫자와 종료를 담당한다

LLM이 맡을 것:

- 공개 발화 생성
- 감정 상태 요약
- 이번 턴의 의도
- 플레이어 말이 어떤 식으로 받아들여졌는지의 정성 판단
- 감독자 모드용 해설

코드가 맡을 것:

- 희생 지수 계산
- 턴 증가
- 종료 조건 판정
- 이벤트 발생
- 파일 저장

## 권장 폴더 구조

현재 구조를 완전히 버릴 필요는 없지만, 최종적으로는 아래에 가까워야 한다.

```text
src/
  app/
    page.tsx
    api/
      world/route.ts
      interact/route.ts
      reset/route.ts
  components/
    chamber/
    survivors/
    inspector/
    ui/
  lib/
    constants.ts
    types.ts
    utils.ts
  server/
    engine/
      world-state.ts
      interaction-engine.ts
      pressure-engine.ts
      resolution-engine.ts
      memory.ts
      round-events.ts
    providers/
      llm-provider.ts
      codex-provider.ts
      openai-provider.ts
      model-registry.ts
    scenario/
      types.ts
      underwater-sacrifice.ts
      index.ts
    store/
      repositories.ts
      file-store.ts
    seeds/
      world.ts
```

## 타입 변경 방향

현재 `src/lib/types.ts`는 medieval 퀘스트형 구조를 강하게 품고 있다.
다음 방향으로 바꾼다.

### PlayerAction 교체

기존:

- `question`
- `persuade`
- `trade`
- `request`
- `empathize`
- `pressure`

권장 신규:

- `make_case`
- `expose`
- `appeal`
- `ally`
- `deflect`
- `stall`
- `confess`

필요하면 `final_plea`, `trade_survival`, `split_pair`를 추가 확장한다.

### Quest 제거 또는 비중 축소

권장:

- `Quest`, `QuestStatus`, `QuestUpdate`를 제거
- 대신 아래 타입 도입

```ts
interface RoundState {
  currentRound: number;
  minRoundsBeforeResolution: number;
  maxRounds: number;
  resolutionUnlocked: boolean;
  rescueEtaLabel: string;
  facilityStatus: string;
}

interface SacrificeDimensions {
  blame: number;
  distrust: number;
  hostility: number;
  dispensability: number;
  utility: number;
  sympathy: number;
}

interface JudgementState {
  evaluatorNpcId: string;
  candidateNpcId: string;
  dimensions: SacrificeDimensions;
  sacrificePreference: number;
}

interface ConsensusBoardEntry {
  npcId: string;
  totalPressure: number;
  topVotes: number;
  trend: "up" | "down" | "flat";
  summary: string;
}

interface ResolutionState {
  resolved: boolean;
  sacrificedNpcId: string | null;
  resolutionType: "threshold" | "consensus" | "max_rounds" | null;
}
```

### NPC 상태 확장

기존 persona, emotion, memory 구조는 재사용 가능하다.
다만 NPC마다 아래가 필요하다.

- `biasSummary`
- `survivalRationale`
- `redLines`
- `initialTargets`

## World Snapshot 변경 방향

`WorldSnapshot`은 더 이상 퀘스트 목록을 중심으로 하면 안 된다.

권장 필드:

```ts
interface WorldSnapshot {
  scenarioId: string;
  presentation: ScenarioPresentation;
  world: WorldMeta;
  npcs: NpcState[];
  events: EventLogEntry[];
  chatByNpcId: Record<string, ChatMessage[]>;
  round: RoundState;
  consensusBoard: ConsensusBoardEntry[];
  lastInspector: InspectorPayload | null;
  runtime: RuntimeStatus;
  resolution: ResolutionState;
}
```

## 저장 포맷

기존 `data/` 기반 저장은 유지한다.
파일 수는 꼭 늘릴 필요 없지만, 의미는 바뀐다.

권장 저장 대상:

- `data/world-state.json`
  - world meta
  - npc 상태
  - round state
  - consensus board
  - last inspector
  - resolution state
- `data/npc-memory.json`
  - NPC별 기억, 로그, 폭로 이력
- `data/interaction-log.json`
  - 각 턴의 입력, 응답, 점수 변화

## Scenario 정의에 추가할 항목

현재 `ScenarioDefinition`은 너무 얇다.
이번 재구현에서는 아래 확장을 권장한다.

```ts
interface ScenarioActionDefinition {
  id: string;
  label: string;
  description: string;
  requiresTarget: boolean;
}

interface ScenarioRoundEvent {
  round: number;
  title: string;
  detail: string;
  tags: string[];
  effects?: string[];
}

interface ScenarioScoringConfig {
  minRoundsBeforeResolution: number;
  maxRounds: number;
  instantConsensusVotes: number;
  pressureThreshold: number;
}

interface ScenarioDefinition {
  id: string;
  prompt: ScenarioPrompt;
  presentation: ScenarioPresentation;
  seeds: ScenarioSeeds;
  actions: ScenarioActionDefinition[];
  roundEvents: ScenarioRoundEvent[];
  scoring: ScenarioScoringConfig;
}
```

## API 방향

### `GET /api/world`

유지한다.

목적:

- 현재 협상 상태 전체를 로드

반환 예시 개념:

```json
{
  "scenarioId": "underwater-sacrifice",
  "world": {
    "location": "Pelagia-9 Control Chamber",
    "time": "T+18m",
    "weather": "deep sea pressure storm",
    "mood": "sealed chamber, rising water, forced negotiation"
  },
  "round": {
    "currentRound": 2,
    "minRoundsBeforeResolution": 4,
    "maxRounds": 7,
    "resolutionUnlocked": false,
    "rescueEtaLabel": "31 minutes delayed",
    "facilityStatus": "central pressure chamber flooding"
  },
  "npcs": [],
  "consensusBoard": [],
  "events": [],
  "resolution": {
    "resolved": false,
    "sacrificedNpcId": null,
    "resolutionType": null
  }
}
```

### `POST /api/interact`

가능하면 유지한다.
기존 UI/클라이언트 흐름을 덜 깨기 위해서다.

다만 payload는 아래 방향으로 바꾼다.

```json
{
  "speakerNpcId": "director",
  "targetNpcId": "engineer",
  "inputMode": "action",
  "action": "expose",
  "text": "예산 삭감 문서를 지금 공개하겠다.",
  "playerId": "local-player"
}
```

또는

```json
{
  "speakerNpcId": "doctor",
  "targetNpcId": null,
  "inputMode": "free_text",
  "text": "우리가 지금 가장 먼저 따져야 할 건 누가 거짓말을 했는지예요.",
  "action": null,
  "playerId": "local-player"
}
```

응답은 아래를 포함해야 한다.

- 새 대화
- 감정 변화
- consensus board 변화
- 현재 leading sacrifice candidate
- inspector payload
- resolution state

### `POST /api/reset`

유지한다.
새 시나리오 seed로 복귀해야 한다.

## 엔진 처리 흐름

매 상호작용은 아래 순서로 처리한다.

1. 입력 정규화
2. 현재 라운드 상태 조회
3. 활성 이벤트와 관련 기억 조회
4. 대상 NPC 편향, 관계, 현재 압력 조회
5. LLM에 공개 응답과 정성 판단 요청
6. 코드가 정성 판단을 수치 변화로 반영
7. 희생 지수 / 합의 흐름 업데이트
8. 종료 조건 판정
9. 이벤트 로그 적재
10. 감독자 모드 정보 생성

## LLM 프롬프트 규칙

시스템 프롬프트는 반드시 medieval 문맥을 제거하고 아래 방향을 담아야 한다.

- 심해 연구소 생존 협상 상황
- 강한 자기보존 본능
- 각 인물의 편향과 비밀
- 공개 발화는 자연스럽고 절박해야 함
- 지나치게 순수한 합리성으로 쉽게 굴복하지 않음
- 말이 바뀌면 분명한 계기가 있어야 함

권장 출력 정보:

- `reply.text`
- `emotion`
- `intent.summary`
- `candidateActions`
- `selectedAction`
- `stanceShift`
  - 누구 쪽으로 조금 기울었는지
- `impactTags`
  - `blame_up_director`
  - `distrust_down_player`
  - `sympathy_up_doctor`

초기 버전은 `impactTags`를 받아 코드에서 해석하는 방법이 구현 난이도 대비 효율이 좋다.

## UI 재구성 지침

### 좌측 패널

현재 NPC 목록 패널은 유지 가능하다.
다만 보여줄 내용은 바꾼다.

- 이름
- 역할
- 현재 감정
- 플레이어에 대한 태도
- 현재 고립도 또는 위험도

### 중앙 패널

기존 대화 패널을 유지하되 아래를 추가한다.

- 라운드 정보
- 구조 ETA
- 현재 가장 위험한 희생 후보
- 행동 버튼
- 자유 입력

### 우측 패널

감독자 모드 유지.
다만 아래를 읽을 수 있어야 한다.

- 이번 턴에 회수한 로그
- 각 인물의 현재 판단 축
- 왜 특정 인물이 고립되고 있는지
- 플레이어 행동이 누구에게 먹혔는지

### 제거 대상

- medieval 퀘스트 카드
- 길드/의뢰 설명 블록
- 마을 허브 배경 설명

## MVP 구현 단계

### Phase 0. 문맥 교체 준비

- Next 16 문서 확인
- scenario 타입 확장
- medieval 문맥 제거 범위 파악

완료 기준:

- 구현 범위가 명확하다
- 새 scenario definition 스켈레톤이 존재한다

### Phase 1. Scenario seed 교체

- `underwater-sacrifice` scenario 추가
- world / npc / memory / event seed 작성
- reset이 새 seed를 쓴다

완료 기준:

- 첫 로드에서 해저연구소 시나리오 데이터가 보인다

### Phase 2. UI copy 및 구조 전환

- presentation 교체
- 퀘스트 영역 제거 또는 consensus board로 교체
- 라운드 상태 영역 추가

완료 기준:

- medieval 문구가 주요 화면에서 사라진다
- 화면이 해저연구소 협상 게임으로 읽힌다

### Phase 3. 액션 체계 교체

- player action enum 교체
- 버튼 렌더 교체
- 타깃 지정 가능하게 수정

완료 기준:

- `make_case`, `expose`, `appeal`, `ally`, `deflect`, `stall`, `confess`가 동작한다

### Phase 4. Pressure / Resolution 엔진

- 희생 지수 계산 로직 구현
- 라운드 진행 구현
- 최소 턴 / 최대 턴 / 즉시 종료 조건 구현

완료 기준:

- 특정 인물이 가장 위험하다는 흐름이 보인다
- 종료가 실제로 난다

### Phase 5. LLM 질감 조정

- 편향 유지 프롬프트 정리
- impact tags 또는 동등 메커니즘 구현
- 감독자 모드 설명 강화

완료 기준:

- 같은 행동도 대상에 따라 결과가 다르게 나온다
- NPC들이 쉽게 합리적 중립으로 수렴하지 않는다

### Phase 6. polish

- 로딩 / 에러
- reset 확인
- 최소 수동 테스트
- typecheck / build 정리

## 검증 기준

반드시 아래 시나리오가 가능해야 한다.

1. 1턴에서 플레이어가 공개적으로 중립을 취한다
2. 2턴에서 감독관 관련 예산 문서를 폭로한다
3. 엔지니어가 감독관 쪽에 더 적대적으로 기울어야 한다
4. 의사는 폭로 자체보다 은폐 여부에 더 반응해야 한다
5. 최소 턴 이전에는 즉시 종료가 나지 않아야 한다
6. 최소 턴 이후 특정 인물 압력이 몰리면 종료가 나야 한다
7. reset 후 초기 seed 상태가 복구되어야 한다

## 구현 중 우선순위

1. 한 판이 실제로 끝나는 수직 슬라이스
2. 캐릭터 편향의 일관성
3. 감독자 모드 설명력
4. UI polish
5. 코드 정리

## 주의사항

- 기존 medieval 전용 ID와 quest 규칙을 억지로 유지하지 않는다.
- 테마만 바꾸고 게임 루프는 그대로 두는 식의 얕은 치환을 금지한다.
- 현재 저장소가 이미 일부 scenario separation이 되어 있으므로, 그 토대를 이용하되 필요한 경우 더 밀어붙여도 된다.
- 이 시나리오의 재미는 `누가 옳은가`가 아니라 `누가 버려지기 쉬운가`에 있다.
