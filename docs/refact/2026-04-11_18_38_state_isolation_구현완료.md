# state isolation 구현 완료

작성 시각: 2026-04-11 18:38 KST

## 구현 목적

병렬 episode 수집 시 여러 worker가 같은 `data/world-state.json`, `data/npc-memory.json`, `data/interaction-log.json`를 공유하면서 `reset`과 `interact`가 서로 덮어쓰는 문제를 막기 위해 state isolation을 추가했다.

핵심 아이디어:

- 각 실행은 `x-world-instance-id` 헤더를 가진다.
- 서버는 이 값을 기준으로 `data/runs/<instanceId>/` 아래의 별도 world state를 사용한다.
- 따라서 서로 다른 episode/case를 동시에 돌려도 상태가 섞이지 않는다.

## 수정한 파일

- `src/server/store/instance-context.ts`
- `src/server/store/repositories.ts`
- `src/server/store/file-store.ts`
- `src/server/engine/world-state.ts`
- `src/server/engine/npc-engine.ts`
- `src/app/api/reset/route.ts`
- `src/app/api/world/route.ts`
- `src/app/api/interact/route.ts`
- `src/app/api/inspector/route.ts`
- `src/server/engine/dataset-export.ts`
- `scripts/_episode-cli-helpers.mjs`
- `scripts/collect-episodes.mjs`
- `scripts/replay-eval-cases.mjs`
- `scripts/smoke-episode.mjs`
- `docs/refact/2026-04-11_18_38_state_isolation_구현완료.md`

## 서버 변경

### 1. instance header 파싱

새 헤더:

- `x-world-instance-id`

허용 형식:

- 영문/숫자/`_`/`-`
- 최대 128자

### 2. repository data dir 분리

기본 UI 흐름:

- header 없음
- 기존처럼 `data/` 사용

isolated 실행:

- header 있음
- `data/runs/<instanceId>/` 사용

생성되는 파일:

- `data/runs/<instanceId>/world-state.json`
- `data/runs/<instanceId>/npc-memory.json`
- `data/runs/<instanceId>/interaction-log.json`

### 3. API 전 구간 반영

아래 라우트가 모두 `instanceId`를 인식한다.

- `/api/reset`
- `/api/world`
- `/api/interact`
- `/api/inspector`

## 스크립트 변경

### collector / replay

- 각 episode 또는 case마다 고유 `instanceId`를 자동 생성한다.
- 결과 JSONL에 `instanceId`를 남긴다.
- request metrics에도 `instanceId`를 남긴다.
- 새 옵션:
  - `--instance-prefix`

예:

- `collector-a-blame_supervisor-001-b71c8da3`
- `parallel-b-director_followup_memory_case-001-63909535`

### smoke

- 기본적으로 고유 isolated instance를 사용한다.
- 필요하면 `SMOKE_INSTANCE_ID`로 직접 지정할 수 있다.

## dataset export 충돌 방지

기존에는 `sft` / `review` export 파일명이 timestamp만 포함해서, 병렬 종료 시 이론상 충돌 가능성이 있었다.

이번 수정으로 파일명에 `episodeId`를 포함하도록 변경했다.

예:

- `data/datasets/sft/<timestamp>_<episodeId>_underwater_sft.jsonl`
- `data/datasets/review/<timestamp>_<episodeId>_preference_review_queue.jsonl`

## 실행한 검증

정적 검증:

```bash
node --check scripts/_episode-cli-helpers.mjs
node --check scripts/collect-episodes.mjs
node --check scripts/replay-eval-cases.mjs
node --check scripts/smoke-episode.mjs
npm run typecheck
npm run build
```

병렬 replay 검증:

```bash
node scripts/replay-eval-cases.mjs \
  --base-url http://localhost:3000 \
  --cases scripts/eval-cases/sample-eval-cases.json \
  --case-id free_text_supervisor_blame_case \
  --instance-prefix parallel-a \
  --output data/evals/parallel-replay-a.jsonl \
  --verbose

node scripts/replay-eval-cases.mjs \
  --base-url http://localhost:3000 \
  --cases scripts/eval-cases/sample-eval-cases.json \
  --case-id director_followup_memory_case \
  --instance-prefix parallel-b \
  --output data/evals/parallel-replay-b.jsonl \
  --verbose
```

병렬 collector 검증:

```bash
node scripts/collect-episodes.mjs \
  --base-url http://localhost:3000 \
  --strategy blame_supervisor \
  --max-episodes 1 \
  --instance-prefix collector-a \
  --output data/evals/parallel-collector-a.jsonl \
  --aggregate-output data/evals/parallel-collector-a-aggregate.json \
  --verbose

node scripts/collect-episodes.mjs \
  --base-url http://localhost:3000 \
  --strategy blame_director \
  --max-episodes 1 \
  --instance-prefix collector-b \
  --output data/evals/parallel-collector-b.jsonl \
  --aggregate-output data/evals/parallel-collector-b-aggregate.json \
  --verbose
```

## 검증 결과

### 병렬 replay

- `free_text_supervisor_blame_case`: `pass`
- `director_followup_memory_case`: `pass`

분리된 state 파일 생성 확인:

- `data/runs/parallel-a-free_text_supervisor_blame_case-001-a5e3d3d2/...`
- `data/runs/parallel-b-director_followup_memory_case-001-63909535/...`

### 병렬 collector

- `collector-a` (`blame_supervisor`): resolved, `마야 로웰`, final round 4
- `collector-b` (`blame_director`): resolved, `서진호`, final round 4

분리된 state 파일 생성 확인:

- `data/runs/collector-a-blame_supervisor-001-b71c8da3/...`
- `data/runs/collector-b-blame_director-001-65ecaad2/...`

즉, 같은 서버에서 동시에 실행해도 서로 다른 state dir 아래에서 독립적으로 종료했다.

## 아직 남은 것

- `data/runs/<instanceId>/` cleanup 정책은 아직 없다.
- 같은 `instanceId`에 대해 동시에 두 `interact`를 날리는 경우까지 보호하는 file lock / transaction은 아직 없다.
- 현재 구현은 “서로 다른 episode/case 병렬 실행”을 안전하게 만든 것이다.
