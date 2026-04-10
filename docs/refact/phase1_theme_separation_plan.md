# Phase 1 Theme Separation Plan

## Summary

- 대상 문서 경로는 `docs/refact/phase1_theme_separation_plan.md`로 둔다.
- 이번 단계 목표는 `스토리/설정/문구의 1차 분리`다. 구현 범위는 `scenario 레이어 도입`, `seed 단일 소스화`, `프롬프트와 테마성 UI 카피 분리`로 제한한다.
- 이번 단계에서는 `퀘스트/파장 규칙 데이터화`, `액션 체계 변경`, `비주얼 테마 분리`, `다국어`, `환경변수 기반 시나리오 전환`을 하지 않는다.
- 사용자 체감 동작은 유지한다. 기본 시나리오는 기존 중세 MMORPG 시나리오 하나만 유지한다.

## Key Changes

### 1. Scenario 레이어 도입

- `src/server/scenario/types.ts`에 `ScenarioDefinition`, `ScenarioPrompt`, `ScenarioPresentation`, `ScenarioSeeds` 타입을 추가한다.
- `src/server/scenario/medieval.ts`에 현재 중세 설정을 하나의 상수 시나리오로 옮긴다.
- `src/server/scenario/index.ts`는 `getCurrentScenario()`만 노출하고, 현재는 항상 `medieval`을 반환한다.

### 2. Seed 소스 단일화

- 현재 `src/server/seeds/npcs.ts`, `src/server/seeds/quests.ts`, `src/server/seeds/world.ts`에 흩어진 seed 데이터를 `medieval` scenario의 `seeds` 아래로 옮긴다.
- 기존 저장 계층과 reset 흐름을 크게 흔들지 않기 위해 `src/server/seeds/world.ts`는 호환 래퍼로 남긴다.
- `createSeedWorldState`, `createSeedMemoryFile`, `createSeedInteractionLog`는 현재 시나리오를 읽어 seed를 만든다.
- `data/*.json`의 런타임 저장 포맷은 유지한다. persisted schema migration은 하지 않는다.

### 3. Prompt 분리

- `src/server/engine/intent.ts`의 하드코딩된 `fantasy village NPC` 문구는 제거한다.
- 시스템 프롬프트는 `scenario.prompt.systemContext`와 기존의 공통 규칙 문장을 합쳐서 만든다.
- `replyGuidance`는 현재의 “간결하고 생생하게, social play/questing/bargaining/rumor gathering에 유용하게” 같은 테마 힌트를 담는 필드로 둔다.

### 4. Theme성 UI 카피 분리

- `WorldSnapshot`에 `scenarioId`, `presentation`을 추가한다.
- `buildWorldSnapshot()`이 현재 scenario의 `scenarioId`와 `presentation`을 포함해 반환하게 바꾼다.
- 클라이언트는 아래 문구만 `presentation`에서 읽는다.
  - 상단 앱 타이틀
  - NPC 목록 subtitle
  - 상호작용 패널 subtitle
  - 입력창 placeholder

### 5. 비범위 고정

- `src/server/engine/quest-engine.ts`와 `src/server/engine/relationship.ts`의 하드코딩 규칙은 이번 단계에서 유지한다.
- 따라서 `innkeeper`, `guard`, `guild_clerk`, `lost-cargo` 같은 medieval 전용 ID 의존성은 남는다.
- 이번 단계의 결과는 “설정과 seed의 분리 1차 완료”이지 “스토리/룰 완전 분리”가 아니다.
