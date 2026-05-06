# Simulator Balance Structure

Last updated: 2026-05-06

이 문서는 현재 시뮬레이터의 위험도, 합의, NPC 자율 반응 밸런스가 어떤 구조로 움직이는지 정리한다. 분석 기준은 현재 소스 트리이며, 역사적 Next.js 문서나 이전 구조는 제외한다.

## 핵심 결론

현재 위험도는 자동으로 빠르게 감쇠하는 값이 아니다. 각 NPC가 각 후보를 어떻게 평가하는지 저장한 judgement matrix를 매 턴 조금씩 바꾸고, 후보별 총합을 보드에 보여준다.

따라서 어떤 캐릭터 A가 270까지 치솟은 뒤 더 이상 직접 공격받지 않아도 A가 천천히 내려갈 수는 있다. 하지만 내려가는 속도는 느리다. 특히 NPC 자율 턴의 `redirect`는 A를 향한 전체 여론을 한 번에 지우지 않고, 보통 한 NPC 평가자의 한 후보 row만 줄인다.

또한 현재 NPC 자율 타깃 선택은 "플레이어가 최근 여러 명을 돌아가며 공격했다"는 패턴을 강하게 기억하지 않는다. 플레이어는 후보 목록에 포함되어 있지만, 기본 가중치가 NPC보다 낮고, 현재 보드 순위와 NPC별 선호/보호 대상 영향이 더 크게 작동한다. 그래서 플레이어가 낮은 후보들을 돌아가며 때려도, NPC들은 자연스럽게 가장 낮거나 방금 책임선이 생긴 NPC 쪽으로 시선을 돌리는 경우가 많다.

## 관련 소스 지도

| 영역 | 파일 |
| --- | --- |
| 플레이어 액션 기본 위험도 | `backend/scripts/server/engine/action-rules.ts` |
| NPC별 반응 편향 | `backend/scripts/server/engine/bias-profiles.ts` |
| 라운드별 긴장도 배율 | `backend/scripts/server/engine/round-profiles.ts` |
| 위험도 조합 레이어 | `backend/scripts/server/engine/pressure-rules.ts` |
| 보드 산출, 압력 반영, 결말 판정 | `backend/scripts/server/engine/pressure-engine.ts` |
| LLM structuredImpact 보정 | `backend/scripts/server/engine/impact-rules.ts` |
| NPC 자율 턴 설정 | `backend/scripts/server/engine/npc-autonomy/config.ts` |
| NPC 자율 턴 플래너 | `backend/scripts/server/engine/npc-autonomy/planner.ts` |
| NPC 자율 턴 타깃 선택 | `backend/scripts/server/engine/npc-autonomy/planner-targets.ts` |
| 과집중 완화 redirect | `backend/scripts/server/engine/npc-autonomy/planner-overfocus.ts` |
| NPC 자율 턴 상태 반영 | `backend/scripts/server/engine/npc-autonomy/apply.ts` |
| 현재 시나리오 자율 설정 | `backend/scripts/server/scenario/underwater-sacrifice/autonomy.ts` |
| 초기 judgement 값 | `backend/scripts/server/scenario/underwater-sacrifice/judgements.ts` |

## 턴 처리 순서

1. 플레이어가 NPC 한 명에게 말하고, 선택 액션과 타깃이 API로 들어온다.
2. LLM 또는 fallback이 NPC 응답, 선택 행동, structuredImpact를 만든다.
3. 대화한 NPC의 플레이어 관계와 감정이 `nextSpeakerState`로 바뀐다.
4. 플레이어 액션과 structuredImpact가 `applyInteractionPressure`를 통해 judgement matrix에 반영된다.
5. 라운드가 1 증가하고, 해당 라운드 이벤트가 있으면 recent event에 들어간다.
6. `simulateNpcAutonomyPhase`가 NPC끼리의 후속 반응을 1-2 step 실행한다.
7. 최종 consensus board를 다시 만들고, 결말 조건을 확인한다.

중요한 점은 NPC 자율 턴이 플레이어 입력 뒤에 항상 후속으로 붙는다는 것이다. 사용자가 보는 위험도 변화는 "플레이어가 직접 만든 변화 + NPC들끼리 한두 번 주고받은 변화"가 합쳐진 결과다.

## 위험도 점수 공식

각 평가 row는 `evaluatorNpcId -> candidateId` 구조다. 예를 들어 "엔지니어가 감독관을 어떻게 보는가"가 하나의 row다.

각 row의 sacrificePreference는 다음 공식으로 계산된다.

```text
blame + distrust + hostility + dispensability - utility - sympathy
```

각 dimension은 업데이트 때 `0..40` 범위로 clamp된다. 후보의 board totalPressure는 모든 평가자의 sacrificePreference를 합산한 값이다. `topVotes`는 각 평가자가 가장 위험하다고 본 후보가 누구인지 센 값이다.

현재 UI 요약 기준은 다음과 같다.

| totalPressure | 요약 |
| ---: | --- |
| 180 이상 | 즉시 희생 가능성 매우 높음 |
| 130 이상 | 방 안의 시선이 빠르게 몰리는 중 |
| 90 이상 | 위험권 진입 |
| 90 미만 | 아직 결정적 고립은 아님 |

현재 초기 보드는 다음 구조다.

| 후보 | 초기 totalPressure | 초기 topVotes |
| --- | ---: | ---: |
| 당신 | 125 | 2 |
| 마야 로웰 | 121 | 1 |
| 서진호 | 103 | 1 |
| 한유리 | 39 | 0 |
| 박도현 | 37 | 0 |

초기 상태부터 플레이어는 이미 위험권 상단에 있다. 다만 이후 플레이어가 `confess`, `deflect` 등으로 자기 책임을 낮추거나, NPC들이 다른 후보에게 시선을 돌리면 상대적으로 플레이어가 잘 맞지 않는 상태가 생긴다.

## 플레이어 액션 기본 효과

플레이어 액션은 먼저 `ACTION_PRESSURE_RULES`의 기본 delta를 만든다. 이후 NPC별 편향, 라운드 배율, 현재 보드 momentum, structuredImpact가 추가로 섞인다.

| 액션 | 플레이어 기본 변화 | 타깃 기본 변화 | 현재 의미 |
| --- | --- | --- | --- |
| `make_case` | distrust +1 | blame +6, dispensability +8, hostility +2 | 타깃을 논리로 희생 후보화한다. |
| `expose` | distrust +1, hostility +1 | blame +10, distrust +12, hostility +4 | 타깃에게 가장 강한 직접 공격이다. |
| `appeal` | sympathy +2, distrust -1 | sympathy +6, utility +2, blame -2 | 타깃을 살리는 방향으로도 작동한다. |
| `ally` | sympathy +1, distrust +1 | hostility +8, blame +4, sympathy -2 | 상대와 한편이 되어 제3자를 고립시킨다. |
| `deflect` | blame -4, distrust -3 | blame +8, distrust +7, hostility +2 | 플레이어 책임을 타깃에게 옮긴다. |
| `stall` | distrust +3, hostility +1 | 없음 | 시간 끌기는 플레이어만 의심받는다. |
| `confess` | blame +3, distrust -6, sympathy +5 | 없음 | 책임은 조금 오르지만 불신과 고립감은 낮출 수 있다. |

이 기본 효과는 모든 평가자에게 그대로 들어가지 않는다. 예를 들어 감독관은 폭로와 책임 전가에 더 민감하고, 의사는 고백과 감정 호소에 더 크게 반응한다. 라운드가 후반으로 갈수록 `stall`, `expose`, `deflect`, `confess`의 배율도 달라진다.

## structuredImpact의 역할

LLM 응답은 `structuredImpact.impactTags`를 함께 반환한다. 이 값은 플레이어 액션 규칙 위에 한 번 더 얹히는 보정이다.

예시는 다음과 같다.

| impact tag | 대상 | 위험도 변화 |
| --- | --- | --- |
| `player_distrust_up` | 플레이어 | distrust +3 |
| `player_blame_up` | 플레이어 | blame +4 |
| `player_blame_down` | 플레이어 | blame -5 |
| `player_sympathy_up` | 플레이어 | sympathy +4 |
| `target_blame_up` | 선택 타깃 | blame +5 |
| `target_blame_high_up` | 선택 타깃 | blame +8, distrust +2 |
| `target_distrust_up` | 선택 타깃 | distrust +5 |
| `room_pressure_shift` | 선택 타깃 | blame +2, distrust +2 |

현재 structuredImpact는 "이번 턴의 말"을 해석한다. 최근 몇 턴 동안 플레이어가 타깃을 계속 바꿨는지, 고립이 낮은 사람만 골라 공격했는지 같은 장기 패턴은 별도 모델로 강하게 누적하지 않는다.

## NPC 자율 턴 구조

현재 수중 희생 시나리오는 NPC 자율 턴이 켜져 있고, 매 플레이어 턴 뒤 최소 1 step, 최대 2 step 실행된다.

기본 move weight는 다음과 같다.

| move | 기본 weight | 의미 |
| --- | ---: | --- |
| `pile_on` | 1.12 | 특정 후보의 책임선을 조금 더 민다. |
| `shield` | 1.15 | 특정 후보를 바로 버리기 어렵게 만든다. |
| `redirect` | 1.34 | 한쪽에 몰린 시선을 다른 후보로 옮긴다. |
| `freeze` | 0.68 | 판단을 세게 밀지 않고 숨을 고른다. |

2번째 자율 step이 붙을 확률은 다음 요소로 증가한다.

| 요소 | 영향 |
| --- | ---: |
| 기본 second step chance | 0.14 |
| 후반 라운드 | +0.16 |
| 1위와 2위 격차가 24 이하 | +0.20 |
| 최근 event tone이 danger | +0.18 |
| 최근 event tone이 warning | 약 +0.12 |

라운드 volatility는 초반 0.9, 중반 1.0, 후반 1.12다. 후반에는 NPC 자율 delta가 조금 더 강해진다.

## NPC 자율 move가 실제로 바꾸는 양

NPC 자율 턴은 플레이어 액션보다 훨씬 작은 단위로 움직인다.

| move | primary target 변화 | secondary target 변화 |
| --- | --- | --- |
| `pile_on` | blame +1..2, distrust +1..2, hostility +0..1 | 없음 |
| `shield` | blame -(2..3), distrust -(2..3), utility +(1..3), sympathy +(1..3) | 없음 |
| `redirect` | 새 타깃 blame +(1..2), distrust +(1..2), hostility +(0..1) | 기존 타깃 blame -(2..3), distrust -(2..3) |
| `freeze` | judgement 변화 없음 | 없음 |

이 delta는 한 step의 actor NPC가 가진 한 평가 row에만 적용된다. 그래서 board total 기준으로 보면 변화가 작다. 예를 들어 A가 여러 NPC 평가자의 합산으로 270까지 올랐다면, A 본인이 한 번 `redirect`로 자기 책임을 피하더라도 A 전체 total은 보통 4-6 정도만 줄어든다. A가 계속 공격받지 않더라도 빠르게 270에서 130으로 떨어지는 구조는 아니다.

## 과집중 redirect 규칙

`planOverfocusRedirect`는 NPC 후보 중 한 명에게 시선이 과하게 몰렸을 때 강제로 먼저 실행된다.

현재 조건은 다음과 같다.

```text
NPC leader totalPressure >= 135
and (
  leader와 runner-up 격차 >= 36
  or leader topVotes >= 2 and 격차 >= 18
)
```

이 조건을 만족하면 leader 본인이 actor가 되어 `redirect`를 시도한다. secondary target은 leader 자신이고, primary target은 현재 board에서 가장 안전해 보이는 후보, 즉 totalPressure가 가장 낮은 후보가 된다.

이 구조 때문에 사용자가 관찰한 현상이 자연스럽게 나온다.

- A가 270까지 오르면 과집중 redirect가 발동한다.
- A는 더 이상 직접 공격받지 않아도 자기 책임선을 다른 후보로 밀면서 조금 내려간다.
- 그런데 플레이어가 여전히 100 안팎이고, 박도현/한유리 같은 후보가 30-80대라면 "가장 안전해 보이는 후보"는 플레이어가 아니라 낮은 NPC가 된다.
- 그래서 NPC끼리의 합의가 오히려 낮은 NPC들을 돌아가며 건드리고, 플레이어에게는 공격 빈도가 낮게 보일 수 있다.

## 플레이어가 자율 타깃으로 잡히는 방식

플레이어는 NPC 자율 타깃 후보에 들어간다. 하지만 기본 가중치가 NPC보다 낮게 시작한다.

| move | 플레이어 기본 weight | NPC 기본 weight |
| --- | ---: | ---: |
| `pile_on` | 0.20 | 0.25 |
| `redirect`의 새 타깃 | 0.16 | 0.18 |

그 뒤 다음 보정이 붙는다.

- 플레이어가 현재 board 1위면 `playerTargetPressureScale = 0.58`.
- 플레이어가 2위면 `0.86`.
- 플레이어가 3위 이하이면 `1.16`.
- 해당 actor의 `initialTargets`에 플레이어가 있으면 약 `1.2` 배가 붙는다.
- NPC별 선호 타깃, 보호 타깃, 최근 event tag bias가 추가로 곱해진다.

현재 초기 `initialTargets`에서 플레이어를 직접 포함하는 NPC는 서진호와 마야 로웰이다. 박도현은 director/supervisor를, 한유리는 director를 우선 본다. 또 현재 autonomy event bias에는 `player-risk` tag가 별도 target weight로 연결되어 있지 않다.

즉 플레이어를 공격하는 길은 이미 있지만, "최근 플레이어가 수상하게 타깃을 계속 바꾸고 있다"는 맥락을 크게 증폭하는 별도 레이어는 없다.

## 현재 밸런스의 장점

- 위험도 변화의 출처가 플레이어 액션, NPC 편향, 라운드, structuredImpact, NPC 자율 턴으로 나뉘어 있어 원인 추적이 쉽다.
- NPC 자율 턴이 작은 delta로 움직여서 갑작스러운 판세 뒤집기가 적다.
- 과집중 redirect가 있어 한 명에게 너무 일찍 게임이 끝나는 상황을 늦춘다.
- 플레이어도 후보로 들어가 있으므로 시스템상 플레이어 희생 결말이 가능하다.

## 현재 밸런스의 한계

- 과집중된 A를 낮추는 속도가 느리다. 대부분 한 평가자의 한 row만 움직이기 때문이다.
- 플레이어가 낮은 후보들을 돌아가며 공격하는 패턴이 "수상한 agenda"로 충분히 누적되지 않는다.
- `playerTargetPressureScale`은 board 순위만 본다. 플레이어의 최근 공격성, 타깃 변경 빈도, 낮은 후보만 찌르는 행동은 보지 않는다.
- overfocus redirect의 primary target은 거의 "가장 낮은 totalPressure"로 결정된다. 플레이어가 그보다 높으면 플레이어가 아니라 낮은 NPC에게 시선이 간다.
- recent event bias는 tag 기반인데, 현재 interaction event tag는 안정적인 action id나 target id보다 표시용 label에 가깝다. 장기 밸런스 판단 재료로 쓰기 어렵다.
- structuredImpact가 이번 턴의 말에는 반응하지만, 여러 턴에 걸친 플레이어 전략성은 별도 점수로 모델링하지 않는다.

## 밸런스 관점의 문제 정의

원하는 경험은 "플레이어가 판을 너무 노골적으로 조작하면 NPC들이 자연스럽게 플레이어를 의심하고, 때로는 플레이어를 직접 공격한다"에 가깝다.

현재 구현은 "보드에 이미 생긴 책임선"과 "NPC 개인 선호"에 더 충실하다. 그래서 플레이어가 새 타깃을 계속 만들면 시스템은 새 타깃들의 위험도를 올리고, 과집중 leader는 낮은 후보 쪽으로 redirect한다. 이 자체는 일관적이지만, 플레이어가 판을 조작하는 주체로 읽히는 긴장감은 부족하다.

다음 리팩토링은 플레이어를 억지로 자주 때리게 만드는 것보다, 플레이어의 행동 패턴이 충분히 수상할 때 NPC 자율 타깃 선택과 delta에 자연스럽게 반영되도록 만드는 방향이 적합하다.
