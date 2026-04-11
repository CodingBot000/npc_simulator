# state lock + transaction 구현 완료

작성 시각: 2026-04-11 19:09 KST

## 구현 목적

`state isolation`만으로는 서로 다른 `instanceId` 간 충돌은 막을 수 있지만, 같은 `instanceId`에 대해 동시에 두 `interact` 또는 `reset`이 들어오는 경우까지는 방어하지 못한다.

이번 작업은 아래 두 문제를 같이 막는 데 목적이 있다.

- 같은 `instanceId` 동시 mutation 충돌
- 저장 도중 실패했을 때 partial state / partial export가 정식 결과처럼 남는 문제

## 핵심 설계

### 1. per-instance mutation lock

- 각 instance dir 아래에 `.lock/lock.json`을 사용한다.
- `resetToSeed()`와 `withLockedState()`는 mutation 시작 전에 lock을 먼저 잡는다.
- lock이 이미 있으면 바로 `WorldRepositoryBusyError`를 던지고 API는 `409`를 반환한다.

의미:

- 같은 `instanceId`의 두 번째 요청은 작업 시작 전에 차단된다.
- 동시에 같은 state를 읽고 각자 덮어쓰는 race를 막는다.

### 2. single snapshot state

기존:

- `world-state.json`
- `npc-memory.json`
- `interaction-log.json`

변경 후 canonical state:

- `state.json`

안에는 아래가 함께 들어간다.

- `worldState`
- `memoryFile`
- `interactionLog`

의미:

- 저장 단위를 3파일이 아니라 1 snapshot으로 통합했다.
- 따라서 `1개 저장 성공 + 1개 저장 실패` 같은 반쪽 상태가 정식 상태로 남지 않는다.

### 3. atomic state commit

state 저장 흐름:

1. 메모리에서 next bundle 계산
2. `data/.../.tmp/state.json.<uuid>.tmp`에 먼저 기록
3. `rename(...tmp, state.json)`으로 교체

의미:

- temp 파일은 중간 산출물일 뿐 정식 읽기 경로에서 사용되지 않는다.
- 프로세스가 중간에 죽어도 `state.json`은 이전 정상 snapshot을 유지한다.
- partial state는 canonical file에 반영되지 않는다.

### 4. export transaction

dataset export는 `data/datasets/.tmp/<txid>/`에 먼저 쓴 뒤 최종 경로로 이동한다.

흐름:

1. `episode.json`, `sft.jsonl`, `review.jsonl`을 temp transaction dir에 생성
2. 3개가 모두 준비되면 최종 경로로 move
3. 그 후에만 world state에 `datasetExportedAt` / `exportPaths`를 기록

의미:

- export 중간 실패 시 정식 export path가 부분적으로 남지 않게 정리한다.
- export는 성공했는데 state save가 실패한 경우도 `onSaveFailure` cleanup으로 되돌린다.

## 구현 파일

- `src/server/store/repositories.ts`
- `src/server/store/file-store.ts`
- `src/server/store/instance-context.ts`
- `src/server/errors.ts`
- `src/server/engine/npc-engine.ts`
- `src/server/engine/world-state.ts`
- `src/server/engine/dataset-export.ts`
- `src/app/api/reset/route.ts`
- `src/app/api/world/route.ts`
- `src/app/api/interact/route.ts`
- `src/app/api/inspector/route.ts`

## 동작 정책

### same instance 동시 요청

- 첫 번째 mutation 요청: lock 획득 후 처리
- 두 번째 mutation 요청: `409 busy`

즉, queue나 대기 재시도가 아니라 명시적 실패로 처리한다.

### garbage temp/lock 처리

temp와 lock은 남을 수 있다. 다만 정식 읽기 경로에서는 무시되도록 설계했다.

- stale lock TTL: 15분
- temp dir cleanup TTL: 60분
- export temp dir cleanup TTL: 60분

따라서 중간에 죽어도 남는 것은 `.tmp` / `.lock` 계열이고, 정식 `state.json`이나 export metadata는 깨진 상태로 남지 않는다.

## legacy 파일 처리

기존 3파일은 초기 migration source로만 사용한다.

- `world-state.json`
- `npc-memory.json`
- `interaction-log.json`

새 canonical state는 `state.json`이다.

즉:

- 기존 파일이 있으면 첫 snapshot 생성 시 읽어서 migration
- 이후 읽기/쓰기의 기준은 `state.json`

## 검증

정적 검증:

```bash
npm run typecheck
npm run build
node --check scripts/collect-episodes.mjs
node --check scripts/replay-eval-cases.mjs
node --check scripts/smoke-episode.mjs
```

기능 검증:

- `SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke:episode`
  - 정상 진행
  - round progression 확인
  - resolution/export 확인

- 같은 `instanceId`에 동시 `interact` 2개 전송
  - 첫 요청: `200`
  - 두 번째 요청: `409`
  - 최종 world round: `1`
  - 즉, 한 요청만 commit됨

- 서로 다른 `instanceId` 병렬 replay 2개 동시 실행
  - `free_text_supervisor_blame_case`: `pass`
  - `director_followup_memory_case`: `pass`

- collector 1 episode 회귀
  - `blame_supervisor` 전략 1회 실행 성공
  - resolved: `마야 로웰`
  - final round: `4`
  - aggregate output 생성 확인

추가 확인:

- same-instance test dir에는 `.lock` 잔재 없이 `state.json`만 남았다.
- instance `.tmp` dir는 비어 있었고, `data/datasets/.tmp`에도 미완료 transaction 파일은 남지 않았다.

## 남은 한계

- 현재 정책은 same-instance mutation을 serialize하지 않고 `409`로 거절한다.
- 여러 머신이 서로 다른 로컬 filesystem을 사용하는 분산 환경까지 보장하는 구조는 아니다.
- read 요청은 lock 없이 마지막 committed snapshot을 읽는다. 즉, mutation 진행 중에는 최신 미커밋 상태가 아니라 마지막 정상 커밋 상태를 본다.
