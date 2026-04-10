# Refactor Docs

## 목적

이 폴더는 현재 `npc_simulator`를 기존 중세 마을형 NPC 시뮬레이터에서
`침수 중인 해저연구소 생존 협상 시뮬레이터`로 재구현하기 위한 문서를 모아둔 곳이다.

이번 재구현의 핵심은 단순한 테마 교체가 아니다.

- `허브형 대화`를 `밀실형 다자 협상`으로 바꾼다.
- `퀘스트 진행`을 `희생 대상 압력 축적`으로 바꾼다.
- `관계 변화`는 유지하되, 결과를 `동맹 / 책임 전가 / 고립` 중심으로 재정의한다.
- `감독자 모드`는 유지하되, 설명 대상이 `왜 이런 답을 했는가`에서
  `왜 누구를 희생 대상으로 밀고 있는가`까지 확장된다.

## 읽는 순서

1. `underwater_sacrifice_scenario_spec.md`
   - 제품 콘셉트, 캐릭터, 규칙, 점수 체계, 턴 구조, 엔딩 정의
2. `underwater_sacrifice_reimplementation_plan.md`
   - 현재 저장소를 어떤 식으로 고쳐야 하는지에 대한 구현 지시
3. `underwater_sacrifice_codex_handoff.md`
   - 새 Codex 세션에 바로 넘길 수 있는 요청 문장과 실행 규칙

## 기존 문서와의 관계

- `phase1_theme_separation_plan.md`
  - 기존 중세 시나리오를 전제로 한 1차 theme separation 문서다.
  - 이번 문서 세트는 그 다음 단계로, 실제 플레이 구조까지 바꾸는 재구현 지시서다.
  - 구현 시에는 `phase1`을 참고할 수 있지만, 우선순위는 이번 문서 세트가 더 높다.

## 현재 저장소 기준 주의사항

- 프로젝트는 `Next.js 16.2.2`, `React 19.2.4`, `TypeScript` 기반이다.
- 코드 작성 전에는 반드시 아래 문서를 먼저 읽는다.
  - `node_modules/next/dist/docs/01-app/index.md`
  - `node_modules/next/dist/docs/01-app/04-glossary.md`
- 이번 재구현은 기존 medieval 전용 규칙을 억지로 유지하지 않는다.
  - 필요하면 `quest-engine` 계층을 제거하거나 `resolution-engine`으로 바꿔도 된다.
  - 단, `file-based store`, `reset`, `world snapshot`, `inspector`의 장점은 유지한다.
