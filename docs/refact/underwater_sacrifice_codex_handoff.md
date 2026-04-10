# Underwater Sacrifice Codex Handoff

## 용도

이 문서는 새 Codex 세션에 그대로 넘길 수 있는 요청 문장과 작업 규칙을 담는다.

## 먼저 읽을 문서

새 세션은 아래 문서를 순서대로 읽어야 한다.

1. `/Users/switch/Development/Web/npc_simulator/docs/refact/underwater_sacrifice_scenario_spec.md`
2. `/Users/switch/Development/Web/npc_simulator/docs/refact/underwater_sacrifice_reimplementation_plan.md`
3. `/Users/switch/Development/Web/npc_simulator/docs/refact/phase1_theme_separation_plan.md`

그리고 코드 작성 전 반드시 아래 Next 문서를 읽어야 한다.

1. `/Users/switch/Development/Web/npc_simulator/node_modules/next/dist/docs/01-app/index.md`
2. `/Users/switch/Development/Web/npc_simulator/node_modules/next/dist/docs/01-app/04-glossary.md`

## 새 Codex 세션에 줄 요청 문장

```text
`docs/refact/underwater_sacrifice_scenario_spec.md` 와
`docs/refact/underwater_sacrifice_reimplementation_plan.md` 를 기준으로
이 프로젝트를 재구현해줘.

목표는 `중세 퀘스트형 NPC 시뮬레이터`가 아니라
`침수 중인 해저연구소의 밀실 생존 협상 시뮬레이터`다.

반드시 만족할 것:
- 플레이어는 자신이 아닌 다른 사람을 희생 대상으로 고립시킬 수 있어야 한다
- NPC 4명은 강한 편향을 유지해야 한다
- 최소 턴 전에는 종료되지 않아야 한다
- 최소 턴 후에는 합의 또는 희생 지수 임계치로 종료될 수 있어야 한다
- 퀘스트 대신 consensus/pressure 구조를 사용해야 한다
- inspector는 왜 특정 인물이 희생 대상으로 몰리는지 설명해야 한다

구현 전에는 Next.js 16 로컬 문서를 읽어라.
질문은 최소화하고 수직 슬라이스부터 완성해라.
LLM mock은 금지한다. provider abstraction, file-based store, reset, inspector는 유지해라.
기존 medieval 전용 ID와 규칙은 필요하면 과감히 폐기해라.
phase 단위로 진행하고 검증 결과를 남겨라.
같거나 유사한 실패가 3회 연속이면 즉시 중단하고 blocker note를 남겨라.
```

## 세션 운영 규칙

- 한 번에 전체를 다 마감하려 하지 말고 phase 단위로 진행한다.
- 동작하는 수직 슬라이스를 먼저 만든다.
- theme copy만 바꾸는 얕은 수정은 금지한다.
- `quest-engine`을 살리기 위해 억지 우회하지 않는다.
- `scenario` 레이어는 더 강하게 사용한다.
- 기존 파일 저장 구조는 가능하면 유지하되 의미를 새 게임에 맞게 바꾼다.

## 구현 성공 체크리스트

- 첫 화면이 해저연구소 협상 게임으로 읽히는가
- NPC 4명이 서로 다른 편향을 유지하는가
- 플레이어가 대상 지정 행동을 할 수 있는가
- 희생 압력이 누적되는가
- 최소 턴 이전엔 즉시 종료가 막히는가
- 최소 턴 이후 특정 인물에게 압력이 몰리면 종료가 나는가
- reset이 새 scenario seed를 복원하는가
- 감독자 모드가 `왜 누구를 버리려 하는가`를 설명하는가

## 구현자가 빠지기 쉬운 함정

- medieval 문구만 바꾸고 퀘스트 루프를 유지하는 것
- 편향보다 일반적 합리성을 우선시켜 NPC를 비슷하게 만드는 것
- 플레이어가 누구를 겨냥하는지 불분명한 행동 UI
- 종료 조건이 없어 끝이 흐려지는 것
- inspector가 단순 로그 나열에 그치는 것

## 최종적으로 보여야 하는 플레이 감각

- 누군가의 비밀이 공개되면 방 안의 공기가 바뀐다
- 한 명을 살리려는 말이 다른 한 명을 더 고립시킬 수 있다
- 정직하게 해도 되고 조작해도 되지만, 둘 다 대가가 있다
- 마지막엔 `누가 옳은가`보다 `누가 버려지기 쉬운가`가 승패를 가른다
