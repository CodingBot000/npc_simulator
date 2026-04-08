# NPC Simulator POC Development Plan

## 문서 목적

이 문서는 `/Users/switch/Development/Web/npc_simulator` 프로젝트를 새 Codex 세션에서 실제로 구현하기 위한 실행 문서다.

목표는 아래 3가지를 조합한 웹 기반 MMORPG형 NPC 엔진 POC를 완성하는 것이다.

- 관계 중심 소셜 시뮬레이터
- 퀘스트 협상형 NPC 인터페이스
- 얇은 감독자 모드

이 문서는 아이디어 메모가 아니라 개발 지시서다.  
새 Codex 세션은 이 문서를 읽고, 가능한 한 질문을 최소화한 채 구현을 진행하면 된다.

## 가장 중요한 운영 규칙

### 1. 반복 실패 시 중단 규칙

같은 원인 또는 유사한 원인으로 3회 연속 실패하면 해당 작업은 즉시 중단한다.

여기서 같은 또는 유사한 실패는 아래처럼 본다.

- 같은 패키지 설치 문제를 해결하지 못한 상태로 같은 계열 명령을 반복
- 같은 빌드 오류를 큰 변화 없이 반복 수정
- 같은 API 연동 실패를 키 없이 계속 재시도
- 같은 hydration 또는 render 오류를 근본 원인 변경 없이 반복
- 같은 DB 연결 실패를 환경 확인 없이 계속 재시도

3회 연속 실패 시 해야 할 일:

1. 즉시 그 작업을 멈춘다.
2. 현재까지 성공한 범위를 유지한다.
3. 아래 형식의 blocker note를 남긴다.

```md
## Blocker
- area:
- attempted:
- evidence:
- last successful state:
- likely next requirement:
```

4. 외부 의존성이 필요한 작업이면 `codex` 모드로 진행 가능한지 먼저 본다.
5. 저장소나 DB 문제는 file-based store로 우회하되, LLM이 필요한 단계는 mock으로 대체하지 않는다.
6. `codex` 모드가 불가능하면 `openai` 모드 구현 상태를 점검한다.
7. 두 모드 모두 실제 LLM 호출이 불가능하면, LLM 비의존 phase까지만 진행하고 그 지점에서 멈춘다.

### 2. 무한 루프 방지 규칙

- 이미 본 오류를 거의 같은 방식으로 다시 시도하지 않는다.
- UI 미세 조정만 반복하며 시간을 쓰지 않는다.
- `OPENAI_API_KEY`가 없어도 `codex` 모드로 진행하되, `codex CLI` 로그인도 없으면 LLM 비의존 구간까지만 진행한다.
- 완성보다 진행 정지가 더 나쁘므로, 우선 동작하는 수직 슬라이스를 만든다.
- 리팩터링은 동작하는 기능이 나온 뒤에만 한다.

### 3. 외부 의존성 우선순위

외부 조건이 부족하면 아래 순서로 대응한다.

1. `codex` provider로 진행
2. 저장 계층은 file-based store로 대체
3. local seed data로 대체
4. `openai` provider는 구현만 유지하되, 키 없이는 실제 검증하지 않는다
5. 실제 LLM 접근이 안 되면 LLM 의존 phase에서 중단 규칙 적용

## 제품 정의

### 한 줄 정의

사용자는 작은 마을 허브에서 NPC와 대화하고, 협상하고, 부탁을 주고받으며 관계를 쌓는다.  
NPC는 플레이어와 세계의 사건을 기억하며, 현재 목표와 감정에 따라 다른 발화와 행동을 선택한다.

### 사용자에게 보여야 하는 핵심 가치

- 같은 NPC와 다시 대화하면 이전 상호작용이 반영된다.
- 한 NPC와의 상호작용이 다른 NPC 태도에도 영향을 준다.
- 대화는 단순 잡담이 아니라 퀘스트, 정보, 거래, 설득으로 이어진다.
- 감독자 모드에서는 NPC가 왜 그런 반응을 했는지 설명 가능하다.

### 이번 POC에서 하지 않을 것

- 실시간 전투 시스템
- 3D 맵
- 음성 대화
- 고급 멀티플레이 동기화
- 파인튜닝, RLHF
- 복잡한 경제 시뮬레이션

## POC 성공 기준

아래가 모두 만족되면 POC는 성공으로 본다.

1. 메인 화면에서 허브와 NPC 목록이 보인다.
2. NPC 3명 이상과 각각 다른 성격으로 대화할 수 있다.
3. 자유 입력과 행동 버튼이 모두 동작한다.
4. 대화 후 관계도, 신뢰도, 퀘스트 상태 중 최소 1개 이상이 변한다.
5. 같은 NPC에게 재접근했을 때 최근 기억이 반영된다.
6. 감독자 모드에서 기억, 감정, 의도, 후보 행동, 최종 선택 이유가 보인다.
7. `LLM_PROVIDER_MODE=codex`에서 실제 LLM 호출로 전체 플로우가 동작한다.
8. `LLM_PROVIDER_MODE=openai`로 바꾸면 `OPENAI_API_KEY`를 통해 동작할 수 있는 구조가 준비되어 있다.

## 권장 기술 선택

기본 원칙은 `빨리 완성 가능한 것`과 `나중에 확장 가능한 것`의 균형이다.

### 프론트엔드

- Next.js App Router
- TypeScript
- Tailwind CSS

### 서버

- Next.js Route Handlers
- Node runtime

### 상태 저장

1차 POC 기본값:

- file-based store
- `data/` 아래 JSON 파일 사용

확장 고려:

- 나중에 Postgres로 교체할 수 있도록 repository interface를 먼저 둔다

### LLM

반드시 provider abstraction을 둔다.

- `codex`
- `openai`

기본 개발 모드는 `codex`다.  
`life_simulator`처럼 `codex CLI` 인증을 기본 경로로 사용한다.

LLM이 필요한 부분은 mock으로 대체하지 않는다.  
NPC 발화 생성, 의도 추론, 행동 후보 생성, 최종 행동 선택 이유는 실제 LLM 호출을 사용한다.

비용 최적화가 필요하면 모델별 cost 정의와 stage별 모델 분리를 둔다.  
필요 없으면 초기 POC는 단일 모델로 시작해도 된다.

### LLM 환경 변수와 모델 정책

기본 환경 변수는 아래처럼 둔다.

```bash
LLM_PROVIDER_MODE=codex
OPENAI_MODEL=gpt-5.4
LOW_COST_MODEL=gpt-5.4-mini
PREMIUM_MODEL=gpt-5.4
LOW_COST_FALLBACK_MODEL=gpt-5.4-mini
PREMIUM_FALLBACK_MODEL=gpt-5.4-mini
```

모드 규칙:

- `LLM_PROVIDER_MODE=codex` → `OPENAI_API_KEY` 불필요, 대신 `codex CLI` 설치 + 로그인 필요
- `LLM_PROVIDER_MODE=openai` → `OPENAI_API_KEY` 필요

현재 구현 단계의 실제 테스트는 `codex` 모드만 수행한다.  
하지만 사용자가 나중에 `LLM_PROVIDER_MODE=openai`와 `OPENAI_API_KEY`를 채우면 동작하도록 구현은 해둔다.

모델 정책:

- 초기 POC는 필요 없으면 `gpt-5.4` 단일 모델로 처리해도 된다
- 비용 최적화가 필요해지면 `LOW_COST_MODEL`과 `PREMIUM_MODEL`을 stage별로 나눈다
- fallback 모델은 모두 `gpt-5.4-mini`로 둔다

## 권장 폴더 구조

프로젝트가 비어 있다면 아래 구조를 목표로 시작한다.

```text
app/
  page.tsx
  api/
    world/route.ts
    interact/route.ts
    inspector/route.ts
    reset/route.ts

src/
  components/
    hub/
    npc/
    quest/
    inspector/
    ui/
  lib/
    types.ts
    constants.ts
    utils.ts
  server/
    engine/
      npc-engine.ts
      memory.ts
      intent.ts
      action-selection.ts
      world-state.ts
      quest-engine.ts
      relationship.ts
    providers/
      llm-provider.ts
      codex-provider.ts
      openai-provider.ts
      model-registry.ts
    store/
      repositories.ts
      file-store.ts
    seeds/
      npcs.ts
      quests.ts
      world.ts

data/
  world-state.json
  interaction-log.json
  npc-memory.json

docs/
  optional
```

## 제품 UX 구조

## 메인 화면

메인 화면은 하나의 허브 페이지로 시작한다.

필수 영역:

- NPC 목록 패널
- 월드 허브 메인 패널
- 선택한 NPC 상세 카드
- 대화/행동 입력 패널
- 월드 이벤트 로그
- 감독자 모드 토글

### 사용 흐름

1. 사용자가 허브에 진입한다.
2. NPC 목록에서 하나를 선택한다.
3. 선택한 NPC의 상태 요약이 보인다.
4. 사용자가 자유 입력 또는 행동 버튼으로 상호작용한다.
5. NPC 응답과 함께 관계, 퀘스트, 로그가 바뀐다.
6. 감독자 모드가 켜져 있으면 내부 판단 근거가 보인다.

## NPC 최소 설계

각 NPC는 아래 필드를 가져야 한다.

```ts
type NpcId = string;

interface NpcPersona {
  id: NpcId;
  name: string;
  role: string;
  tone: string;
  traits: string[];
  values: string[];
  dislikes: string[];
  secrets: string[];
}

interface NpcEmotionState {
  primary: "calm" | "curious" | "guarded" | "annoyed" | "friendly";
  intensity: number;
  reason: string;
}

interface RelationshipState {
  playerTrust: number;
  playerAffinity: number;
  playerTension: number;
  npcOpinions: Record<string, number>;
}

interface MemoryEntry {
  id: string;
  scope: "short" | "long";
  summary: string;
  tags: string[];
  importance: number;
  timestamp: string;
}

interface NpcGoalState {
  currentGoal: string;
  currentNeed: string;
  opennessToPlayer: number;
}

interface NpcState {
  persona: NpcPersona;
  emotion: NpcEmotionState;
  relationship: RelationshipState;
  memories: MemoryEntry[];
  goals: NpcGoalState;
}
```

## 퀘스트 최소 설계

퀘스트는 복잡할 필요 없다.  
처음에는 대화 기반 상태 변화만 있어도 된다.

```ts
interface Quest {
  id: string;
  title: string;
  giverNpcId: string;
  status: "locked" | "available" | "active" | "completed" | "failed";
  summary: string;
  requirements: string[];
  rewards: string[];
}
```

## 엔진 처리 흐름

모든 상호작용은 아래 순서로 처리한다.

1. 입력 정규화
2. 대상 NPC 상태 조회
3. 관련 기억 검색
4. 현재 관계 상태 조회
5. 현재 퀘스트/월드 맥락 조회
6. NPC 감정 계산
7. NPC 의도 계산
8. 후보 행동 2~3개 생성
9. 최종 행동 선택
10. 사용자용 응답 생성
11. 관계, 기억, 퀘스트, 로그 업데이트
12. 감독자 모드용 진단 정보 반환

## 행동 종류

초기 POC에서는 행동 종류를 아래로 제한한다.

- answer
- ask_back
- refuse
- hint
- negotiate
- accept_request
- delay

이 정도면 협상형 경험과 관계 변화 표현에 충분하다.

## API 설계

### `GET /api/world`

목적:

- 허브 화면 초기 데이터 제공

응답 예시:

```json
{
  "world": {
    "location": "Riverside Tavern",
    "time": "evening"
  },
  "npcs": [],
  "quests": [],
  "events": []
}
```

### `POST /api/interact`

목적:

- 플레이어와 NPC 상호작용 처리

요청 예시:

```json
{
  "npcId": "innkeeper",
  "inputMode": "free_text",
  "text": "어제 이야기한 상인 얘기 좀 더 해줘",
  "action": null,
  "playerId": "local-player"
}
```

또는

```json
{
  "npcId": "guard",
  "inputMode": "action",
  "text": "",
  "action": "persuade",
  "playerId": "local-player"
}
```

응답 예시:

```json
{
  "reply": {
    "text": "..."
  },
  "relationshipDelta": {
    "trust": 1,
    "affinity": 0,
    "tension": -1
  },
  "questUpdates": [],
  "eventLogEntry": {},
  "inspector": {
    "retrievedMemories": [],
    "emotion": {},
    "intent": {},
    "candidateActions": [],
    "selectedAction": {}
  }
}
```

### `GET /api/inspector`

목적:

- 최근 상호작용의 감독자 정보 확인

주의:

- POC에서는 `POST /api/interact` 응답에 포함되어도 된다
- 별도 route는 선택 사항이다

### `POST /api/reset`

목적:

- seed 데이터로 상태 초기화

이 route는 개발 속도를 크게 높여준다.

## UI 상세 요구사항

### NPC 목록

보여야 하는 것:

- 이름
- 역할
- 현재 감정
- 플레이어와의 관계 요약

### NPC 상세 카드

보여야 하는 것:

- 이름
- 역할
- 현재 기분
- 플레이어에 대한 태도
- 현재 관심사 또는 목표
- 관련 퀘스트 요약

### 상호작용 영역

반드시 둘 다 제공한다.

- 자유 입력
- 행동 버튼

행동 버튼 초기안:

- 질문
- 설득
- 거래
- 부탁
- 공감
- 압박

### 관계/결과 피드백

사용자가 대화 결과를 체감해야 한다.

필수 피드백:

- 신뢰도 변화
- 태도 변화
- 퀘스트 상태 변화
- 월드 이벤트 로그 추가

### 감독자 모드

감독자 모드는 얇게 붙인다.  
기본 플레이 경험을 망치지 않게 접이식 패널로 구현한다.

표시 항목:

- retrieved memories
- emotion summary
- intent summary
- candidate actions
- selected action
- selected action reason

## Seed 데이터 요구사항

초기 NPC는 3명으로 시작한다.

### 권장 NPC 구성

1. 여관 주인
- 비교적 친절
- 소문을 많이 안다
- 거래와 정보 제공에 열려 있다

2. 경비병
- 규칙 중심
- 경계심이 높다
- 설득과 평판의 영향을 많이 받는다

3. 길드 담당자
- 실용적
- 퀘스트 제공자
- 플레이어의 신뢰 수준을 중요하게 본다

### 초기 퀘스트 예시

1. 잃어버린 화물의 행방 찾기
2. 수상한 상인에 대한 정보 수집
3. 길드 의뢰 수락을 위한 신뢰 확보

## 구현 단계

## Phase 0. 부트스트랩

목표:

- 빈 폴더를 실행 가능한 Next.js 앱으로 만든다

작업:

1. Next.js App Router + TypeScript + Tailwind 초기화
2. 기본 폴더 구조 생성
3. `codex/openai` provider 인터페이스와 file store 껍데기 생성
4. `.env` 또는 `.env.local` 예시 구성
5. seed 데이터 파일 생성

완료 기준:

- `npm install`
- `npm run dev`
- 첫 화면이 뜬다

## Phase 1. 정적 허브 화면

목표:

- 실제 데이터 없이도 전체 화면 골격이 보이게 한다

작업:

1. 허브 레이아웃 구현
2. NPC 목록 패널 구현
3. NPC 상세 카드 구현
4. 대화 패널 구현
5. 감독자 패널 UI 틀 구현

완료 기준:

- 클릭 가능한 더미 NPC 목록이 있다
- 레이아웃이 데스크톱에서 깨지지 않는다

## Phase 2. world API + seed 데이터 연결

목표:

- 허브가 실제 seed 데이터로 그려진다

작업:

1. `GET /api/world` 구현
2. seed 기반 world/npc/quest/event 데이터 제공
3. 프론트에서 로드 후 렌더

완료 기준:

- 새로고침해도 같은 seed 허브가 보인다

## Phase 3. 상호작용 수직 슬라이스

목표:

- 실제로 NPC와 대화해 응답을 받는다

작업:

1. `POST /api/interact` 구현
2. 자유 입력 처리
3. 행동 버튼 처리
4. 실제 LLM provider 기반 응답 생성
5. 응답을 대화 패널에 누적

완료 기준:

- 한 NPC와 2회 이상 대화 가능
- 자유 입력과 행동 버튼 모두 동작

## Phase 4. 관계/기억 업데이트

목표:

- 상호작용 결과가 누적된다

작업:

1. relationship update 로직 구현
2. short memory 저장 구현
3. long memory 승격 규칙은 단순 버전으로 구현
4. 재대화 시 기억 반영

완료 기준:

- 같은 NPC가 이전 상호작용을 반영한다
- 관계 수치 변화가 UI에 보인다

## Phase 5. 퀘스트와 사회적 파장

목표:

- 대화가 실제 목적 지향 경험으로 이어진다

작업:

1. 퀘스트 상태 전이 구현
2. 이벤트 로그 누적
3. 일부 상호작용이 다른 NPC 태도에 영향을 주게 구현

완료 기준:

- 퀘스트가 잠금 해제 또는 진행된다
- 최소 1회 이상 NPC 간 영향이 보인다

## Phase 6. 감독자 모드

목표:

- 엔진 동작이 설명 가능해진다

작업:

1. memory retrieval 결과 표시
2. emotion 계산 결과 표시
3. intent 표시
4. candidate actions 표시
5. selected action 이유 표시

완료 기준:

- 플레이 모드와 감독자 모드가 둘 다 읽을 수 있다

## Phase 7. polish

목표:

- 사용 흐름을 끊지 않는 최소 수준의 완성도 확보

작업:

1. 로딩 상태
2. 에러 상태
3. reset 기능
4. codex/openai provider 스위치
5. 모바일 최소 대응

완료 기준:

- 데모 시 큰 막힘 없이 끝까지 체험 가능

## 개발 중 우선순위 규칙

항상 아래 순서로 판단한다.

1. 동작하는 수직 슬라이스
2. 데이터 구조 안정화
3. 감독자 설명 가능성
4. UI polish
5. 코드 정리

즉, 예쁜 UI보다 먼저 `대화 -> 기억 -> 관계 변화 -> 퀘스트 반영`이 살아야 한다.

## 검증 규칙

각 phase가 끝날 때 아래를 확인한다.

### 공통

- 앱 실행 여부
- TypeScript 오류 여부
- 주요 화면 렌더 여부
- 해당 phase 기능의 최소 수동 확인

### 권장 명령

프로젝트가 초기화된 뒤에는 아래를 기본 검증으로 사용한다.

```bash
npm run build
npm run typecheck
```

만약 `typecheck` 스크립트가 없으면 추가해도 된다.

### 최소 수동 점검 시나리오

1. 허브 진입
2. NPC 선택
3. 자유 입력 1회
4. 행동 버튼 1회
5. 관계 변화 확인
6. 같은 NPC 재대화
7. 감독자 모드 확인
8. reset 후 초기화 확인

## Codex provider 규칙

기본 provider는 `codex`다.

필요 이유:

- 현재 검증 기준이 `codex` 모드다
- `life_simulator`와 동일하게 `codex CLI` 인증 경로를 사용할 수 있다
- `OPENAI_API_KEY` 없이도 실제 LLM 기반 개발이 가능하다

`codex` provider는 아래를 만족해야 한다.

- `codex CLI` 로그인 상태를 전제로 동작
- 실제 NPC 발화와 추론 결과를 반환
- stage별 모델 선택 또는 단일 모델 처리 가능
- 감독자 패널용 진단 정보를 함께 반환할 수 있는 구조
- 호출 실패 시 fallback 모델로 재시도 가능

## OpenAI provider 규칙

`openai` provider는 현재 단계에서 실제 검증하지 않더라도 구현해 둔다.

조건:

- provider interface를 공유해야 한다
- `LLM_PROVIDER_MODE=openai`일 때 `OPENAI_API_KEY`를 사용한다
- `OPENAI_API_KEY`가 없으면 명확한 설정 오류를 반환한다
- 사용자가 나중에 모드를 바꾸면 앱 전체 수정 없이 동작해야 한다
- 외부 연동 실패가 앱 전체 실패로 이어지지 않게 에러 처리를 둔다

## LLM 호출 대상 규칙

아래 영역은 실제 LLM을 사용한다.

- NPC 발화 생성
- 의도 추론
- 후보 행동 생성
- 선택 이유 요약

아래 영역은 비LLM 로직으로 구현해도 된다.

- 관계 수치 증감
- 퀘스트 상태 전이
- 저장소 읽기/쓰기
- 이벤트 로그 적재

## 파일 저장 규칙

POC에서는 file-based store를 사용하되, 나중에 교체 가능해야 한다.

저장 대상:

- NPC 상태
- 플레이어와의 관계
- 최근 상호작용 로그
- 퀘스트 상태
- 감독자 패널용 최근 추론 결과

주의:

- 데이터 저장 로직을 UI 안에 넣지 않는다
- repository interface 뒤로 숨긴다

## Codex 세션용 실행 지침

새 Codex 세션은 아래 원칙을 따른다.

1. 먼저 현재 폴더 상태를 확인한다.
2. 프로젝트가 비어 있으면 Phase 0부터 시작한다.
3. 이미 코드가 있으면 가장 앞선 미완료 phase부터 진행한다.
4. 한 번에 전체를 완성하려 하지 말고 phase 단위로 검증한다.
5. 현재 실제 검증은 `codex` 모드 기준으로 수행한다.
6. `openai` 모드는 구현만 해두고, 키가 없으면 설정 오류 메시지까지 확인한다.
7. 매 phase가 끝날 때 변경 파일과 검증 결과를 남긴다.
8. 같은 계열 실패 3회면 중단 규칙을 적용한다.

## 완료 보고 형식

각 작업 단위가 끝날 때 아래 형식으로 정리하면 된다.

```md
## Completed
- phase:
- files changed:
- validation run:
- remaining risk:

## Next
- next recommended step:
```

## 최종 데모 시나리오

POC 완성 후 아래 흐름이 자연스럽게 보여야 한다.

1. 사용자가 여관 주인과 대화해 소문을 얻는다.
2. 경비병에게 같은 주제로 접근했을 때 태도가 다르게 나온다.
3. 길드 담당자와 협상해 퀘스트가 열린다.
4. 다시 여관 주인에게 가면 이전 상호작용이 기억되어 있다.
5. 감독자 모드에서 왜 그런 반응이 나왔는지 확인할 수 있다.

## 이 문서만으로 부족할 때의 판단 기준

세부 구현에서 선택지가 여러 개면 아래 기준으로 고른다.

1. 실제 LLM 호출을 유지할 수 있는 쪽
2. 외부 의존성 적은 쪽
3. 수직 슬라이스를 빨리 완성하는 쪽
4. 감독자 모드 설명이 쉬운 쪽
5. 나중에 Postgres나 provider 교체가 쉬운 쪽

## 새 Codex 세션에 바로 줄 수 있는 요청 문장

아래 문장을 새 프로젝트에서 그대로 줘도 된다.

```text
/Users/switch/Development/Web/npc_simulator/POC_DEVELOPMENT_PLAN.md 를 기준으로 프로젝트를 구현해줘.
같거나 유사한 원인으로 3회 연속 실패하면 즉시 중단하고 blocker note를 남겨줘.
LLM이 필요한 부분은 mock으로 대체하지 말고 실제 모델 호출을 사용해줘.
기본 모드는 LLM_PROVIDER_MODE=codex 로 두고, life_simulator처럼 codex CLI 인증을 사용해줘.
OPENAI 모드도 구현해두되, 현재 검증은 codex 모드만 해줘.
DB가 없어도 file-based store로 계속 진행해줘.
한 번에 전부 하려 하지 말고 phase 단위로 구현하고, 각 phase마다 검증 결과를 남겨줘.
```
