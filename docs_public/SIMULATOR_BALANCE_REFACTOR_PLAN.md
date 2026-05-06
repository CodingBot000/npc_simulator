# Simulator Balance Refactor Plan

Last updated: 2026-05-06

이 문서는 현재 위험도 밸런스 구조를 유지하면서, 플레이어가 판을 조작하는 듯 보일 때 NPC들이 더 자주 플레이어를 의심하고 공격하도록 만드는 리팩토링 계획이다. 목표는 긴장감을 높이되, 무조건 플레이어만 때리는 억지스러운 보정은 피하는 것이다.

## 목표

- NPC들이 최근 플레이어 행동을 "합의 조작" 또는 "책임선 이동"으로 읽을 수 있게 한다.
- 플레이어가 낮은 후보들을 돌아가며 공격할 때, 일정 확률로 NPC가 "왜 계속 시선을 돌리냐"며 플레이어를 압박한다.
- 과집중된 후보 A는 자연스럽게 내려가되, 너무 느리게만 빠지지 않도록 한다.
- 기존 액션, NPC 편향, 라운드 구조는 최대한 유지하고, 새 밸런스 신호를 얇게 추가한다.
- Inspector와 event log에서 왜 플레이어가 공격받았는지 설명할 수 있게 한다.

## 설계 원칙

1. 강제보다 가중치로 처리한다.
   플레이어 공격을 확정하지 않고, 타깃 선택 weight를 올린다.

2. 수상함의 근거를 행동 패턴에서 만든다.
   단순히 "플레이어를 더 자주 때리자"가 아니라, 타깃 변경, 낮은 후보 공격, 책임 전가 반복, 후반 압박 같은 신호를 누적한다.

3. 후보 A의 감쇠와 플레이어 압박을 분리한다.
   A가 내려가는 속도 문제와 플레이어가 공격받지 않는 문제는 연결되어 있지만 같은 문제는 아니다.

4. 튜닝값은 시나리오 데이터로 둔다.
   코드 조건문에 박아두기보다 `ScenarioAutonomyConfig`에 가까운 설정으로 옮겨야 이후 시나리오별 조정이 쉽다.

5. 설명 가능한 결과만 만든다.
   NPC가 플레이어를 공격했을 때 event log와 inspector에서 이유가 보여야 한다.

## 제안 1: Player Suspicion Context 추가

새 계산 레이어를 만든다.

후보 파일명 예시:

- `backend/scripts/server/engine/npc-autonomy/player-suspicion.ts`
- 또는 `backend/scripts/server/engine/npc-autonomy/planner-context.ts`

이 레이어는 현재 턴과 최근 N턴을 보고 다음 값을 만든다.

```ts
interface PlayerSuspicionContext {
  score: number; // 0..100
  targetWeightMultiplier: number;
  deltaScale: number;
  reasons: string[];
}
```

초기 튜닝안은 다음과 같다.

| 신호 | 조건 | score 영향 |
| --- | --- | ---: |
| 공격성 | 최근 3턴 중 `make_case`, `expose`, `ally`, `deflect`가 2회 이상 | +15 |
| 타깃 회전 | 최근 4턴의 공격 타깃이 3명 이상 | +20 |
| 낮은 후보 공격 | 이번 타깃이 board 하위 2명 중 하나 | +15 |
| 책임 전가 | `deflect` 반복 또는 `player_blame_down` 반복 | +15 |
| 선두 방치 | 기존 leader가 130 이상인데 다른 낮은 후보를 공격 | +12 |
| 후반 압박 | 라운드가 minRoundsBeforeResolution 이상 | +8 |
| danger 분위기 | 최근 event tone이 danger | +8 |
| 플레이어가 너무 안전 | 플레이어 board rank가 3위 이하인데 공격성 신호가 있음 | +12 |

권장 multiplier:

```text
targetWeightMultiplier = 1.0 + min(score, 70) / 70 * 1.1
deltaScale = 1.0 + min(score, 70) / 70 * 0.35
```

즉 score가 높아도 플레이어 target weight는 최대 약 2.1배, 실제 delta는 최대 약 1.35배 정도로 제한한다. 이 정도면 빈도는 체감되지만, 매번 플레이어만 공격하는 구조는 피할 수 있다.

## 제안 2: 자율 phase 입력에 현재 플레이어 행동 요약 전달

현재 `simulateNpcAutonomyPhase`는 `requestNpcId`와 `recentEvents`만 받는다. 자율 플래너가 "이번 턴 플레이어가 누구를 어떻게 공격했는지"를 안정적으로 알기 어렵다.

`SimulateNpcAutonomyPhaseInput`에 다음 요약을 추가한다.

```ts
interface LastPlayerMoveContext {
  action: PlayerAction | null;
  targetNpcId: string | null;
  structuredImpactTags: ImpactTag[];
  pressureChanges: PressureChange[];
}
```

`applyInteractionTurnStateTransition`에서 `request.action`, `effectiveTargetNpcId`, `llmResult.structuredImpact.impactTags`, `pressureUpdate.pressureChanges`를 넘긴다.

이 변경으로 자율 플래너는 표시용 event tag가 아니라 실제 action id와 candidate id를 기준으로 밸런스 판단을 할 수 있다.

## 제안 3: 최근 플레이어 공격 히스토리 정규화

현재 interaction event tag는 `selectedActionLabel`, `targetLabel` 중심이라 밸런스 로직이 쓰기에는 약하다. 두 가지 중 하나를 선택한다.

1. event tag에 machine-readable tag 추가
   예: `player-action:deflect`, `player-target:doctor`, `impact:room_pressure_shift`

2. world state에 별도 balance history 추가
   예: `worldState.balanceRuntime.recentPlayerMoves`

권장안은 2번이다. event log는 사용자 표시용 성격이 강하고, 밸런스용 히스토리는 schema가 안정적이어야 한다.

예시:

```ts
interface BalanceRuntimeState {
  recentPlayerMoves: Array<{
    round: number;
    action: PlayerAction | null;
    targetNpcId: string | null;
    impactTags: ImpactTag[];
    targetPressureBefore: number | null;
    playerPressureBefore: number | null;
  }>;
}
```

초기에는 최근 5턴만 저장하면 충분하다. 마이그레이션 부담을 줄이려면 기존 world state에 optional field로 추가하고, 없으면 빈 배열로 취급한다.

## 제안 4: playerTargetPressureScale 리팩토링

현재 `playerTargetPressureScale(board)`는 플레이어 보드 순위만 본다.

현재 규칙:

```text
플레이어 1위: 0.58
플레이어 2위: 0.86
플레이어 3위 이하: 1.16
```

변경안:

```ts
function playerTargetPressureScale(params: {
  board: ConsensusBoardEntry[];
  suspicion: PlayerSuspicionContext;
}) {
  const rankScale = currentRankScale(params.board);
  const suspicionScale = params.suspicion.targetWeightMultiplier;
  const cap = playerIsLeader ? 1.0 : 2.2;

  return Math.min(rankScale * suspicionScale, cap);
}
```

의도:

- 플레이어가 이미 1위라면 과잉 dogpile을 막는다.
- 플레이어가 낮은 순위인데 계속 남을 몰면 "너무 안전하게 빠지려 한다"는 의심이 올라간다.
- 기존 board rank 기반 자연스러움은 유지한다.

적용 위치:

- `pickPileOnTarget`
- `pickRedirectTargets`

두 함수 모두 DEFAULT_PLAYER_ID 후보 weight에 이 scale을 곱한다.

## 제안 5: Overfocus redirect 타깃 선택 개선

현재 `planOverfocusRedirect`는 NPC leader가 과집중되면 가장 totalPressure가 낮은 후보에게 시선을 돌린다. 이 때문에 A가 270까지 오른 상황에서, 플레이어가 낮은 후보를 돌아가며 공격하면 overfocus redirect도 낮은 NPC를 향하기 쉽다.

변경안은 "가장 낮은 후보"가 아니라 "시선을 돌리기 쉬운 후보"를 고르는 것이다.

예시 scoring:

```text
redirectAppeal =
  lowPressureScore
  * actorBiasTargetScale
  * recentSuspicionScale
  * eventBiasTargetScale
```

플레이어 후보에는 `recentSuspicionScale`을 반영한다. 그러면 플레이어가 최근 여러 후보를 공격했고, 특히 낮은 후보만 찌르고 있다면 플레이어도 redirect 대상이 된다.

권장 튜닝:

- suspicion score 0-29: 기존처럼 낮은 NPC 우선
- suspicion score 30-54: 플레이어도 동급 후보로 진입
- suspicion score 55 이상: 플레이어가 낮은 NPC보다 약간 더 잘 선택됨

이렇게 하면 플레이어 공격 빈도는 올라가지만, 플레이어가 조용히 설득하거나 고백하는 플레이에서는 기존 흐름이 유지된다.

## 제안 6: player-specific rationale만 추가하고 move 종류는 유지

새 move `challenge_player`를 추가할 수도 있지만, 1차 리팩토링에서는 move 종류를 늘리지 않는 편이 낫다. 현재 `pile_on`과 `redirect`가 이미 플레이어를 타깃으로 받을 수 있기 때문이다.

대신 `stepRationale`과 `buildAutonomyStepSummary`에서 타깃이 DEFAULT_PLAYER_ID일 때 문장을 분기한다.

예시:

- `pile_on`: "서진호는 당신이 계속 책임선을 옮기는 방식 자체를 문제 삼는다."
- `redirect`: "마야 로웰은 한유리에게 몰리던 시선을, 판을 움직이는 당신 쪽으로 되돌린다."

이 변경은 수치 밸런스와 별개로 체감 긴장감을 크게 올린다. 플레이어가 공격받는 이유가 말로 드러나기 때문이다.

## 제안 7: 과집중 후보 감쇠를 약간 넓힌다

A가 270까지 오른 뒤 너무 천천히 내려가는 문제는 별도 보완이 필요하다.

현재 `redirect` secondary delta는 actor의 한 row만 낮춘다. A가 과집중 leader일 때만 아래 중 하나를 적용한다.

### 옵션 A: overfocus relief scale

overfocus redirect일 때 secondary target delta에만 1.3-1.5배를 적용한다.

장점:

- 구현이 작다.
- A가 자기방어를 강하게 하는 상황과 잘 맞는다.

단점:

- 여전히 한 평가자 row만 바뀌므로 total 감소 폭은 제한적이다.

### 옵션 B: consensus fatigue

과집중 leader가 이번 턴 직접 타깃이 아니고, 새 타깃이 생겼다면 일부 평가자의 leader judgement를 `blame -1`, `distrust -1` 정도 낮춘다.

장점:

- "방이 한 명만 보다가 피로해지고, 새 책임선에 일부 시선이 이동한다"는 자연스러운 흐름을 만든다.
- A total이 여러 평가자 합산으로 오른 경우에도 완만하게 빠진다.

단점:

- 전역 감쇠처럼 보이지 않게 조건과 cap을 조심해야 한다.

권장안은 B를 작게 넣는 것이다.

조건 예시:

```text
leader totalPressure >= 180
and current player target != leader
and current targetPressure increased
and leader was not attacked this turn
```

효과 예시:

```text
최대 2명의 evaluator row에서 leader blame -1, distrust -1
한 턴 총 감소량 cap: -8
```

이 정도면 A가 너무 빠르게 무너지지는 않지만, 270 같은 과집중 상태가 몇 턴 동안 같은 속도로만 버티는 문제는 줄어든다.

## 제안 8: 시나리오 event bias에 player-risk 연결

현재 round event에는 `player-risk` tag가 있지만 autonomy event bias에서 DEFAULT_PLAYER_ID target weight로 연결되어 있지 않다.

`underwaterAutonomyConfig.eventBiases`에 다음 계열을 추가한다.

```ts
{
  tag: "player-risk",
  targetWeights: {
    [DEFAULT_PLAYER_ID]: 1.28,
  },
  moveWeights: {
    pile_on: 1.08,
    redirect: 1.08,
  },
}
```

이 변경은 5라운드 이후 "보안 로그와 플레이어 리스크가 드러나는" 시나리오 맥락에서만 플레이어 압박을 올린다. 수상함 context와 함께 쓰면 너무 초반부터 플레이어가 억지로 맞는 문제를 피할 수 있다.

## 권장 구현 순서

1. `BalanceRuntimeState` 또는 `LastPlayerMoveContext` 중 최소 입력부터 추가한다.
2. `player-suspicion.ts`를 만들고 score/reason/multiplier를 계산한다.
3. `AutonomyPlannerInput`에 suspicion context를 포함한다.
4. `pickPileOnTarget`, `pickRedirectTargets`의 플레이어 weight에 suspicion multiplier를 적용한다.
5. `planOverfocusRedirect`의 primary target 선택을 "lowest pressure only"에서 weighted appeal로 바꾼다.
6. 플레이어 타깃 rationale과 event summary를 별도 문장으로 분기한다.
7. 필요하면 consensus fatigue를 작게 추가한다.
8. `player-risk` event bias를 scenario config에 연결한다.
9. Inspector에 suspicion score와 reasons를 노출한다.

## 테스트 계획

기존 자율 테스트는 `npm run test:autonomy`로 실행한다.

추가할 테스트:

| 테스트 | 기대 |
| --- | --- |
| 최근 4턴 중 타깃 3명 이상 공격 | suspicion score가 기준 이상으로 오른다. |
| 공격성 없이 appeal/confess 위주 | suspicion score가 낮게 유지된다. |
| 플레이어가 낮은 후보를 공격하고 기존 leader가 180 이상 | player target weight가 기존보다 오른다. |
| suspicion 낮은 overfocus | 기존처럼 낮은 NPC로 redirect 가능하다. |
| suspicion 높은 overfocus | 플레이어가 redirect 후보로 의미 있게 선택된다. |
| 플레이어 대상 pile_on | player judgement와 playerTrust/playerTension이 정상 반영된다. |
| player-risk round event | DEFAULT_PLAYER_ID target weight가 증가한다. |

확률 기반 테스트는 단일 seed 결과보다 여러 seed 분포를 보는 방식이 좋다. 예를 들어 500개 seed에서 플레이어 target 빈도가 기존 대비 1.5배 이상 증가하되, 100%에 고정되지 않는지 확인한다.

## 초기 튜닝 목표

실험 기준은 다음처럼 잡는다.

1. A가 250-300까지 오른 상태에서 플레이어가 3턴 연속 낮은 후보를 바꿔 공격한다.
2. 기존 leader A는 2-3턴 동안 25-45 정도 완만히 내려간다.
3. 플레이어는 같은 구간에서 최소 1회 이상 NPC 자율 공격 대상이 된다.
4. 플레이어가 `confess`나 `appeal`로 한 턴 숨을 고르면 suspicion 상승이 둔화된다.
5. 플레이어가 이미 board 1위이면 추가 dogpile은 cap으로 제한한다.

추천 수치:

| 항목 | 시작값 |
| --- | ---: |
| suspicion target weight 최대 배율 | 2.1 |
| suspicion delta 최대 배율 | 1.35 |
| suspicion 발동 기준 | 30 |
| 강한 발동 기준 | 55 |
| consensus fatigue 턴당 총 감소 cap | -8 |
| player-risk target weight | 1.28 |
| player-risk pile_on/redirect weight | 1.08 |

## 리스크와 완화

| 리스크 | 완화 |
| --- | --- |
| 플레이어가 매번 공격받는 느낌 | suspicion score threshold와 cap을 둔다. |
| 고백/호소 플레이가 무력해짐 | `confess`, `appeal`, `player_sympathy_up`은 suspicion을 낮추거나 상승을 중단한다. |
| 결말이 너무 빨라짐 | minRoundsBeforeResolution과 leadGapThreshold는 유지하고 deltaScale cap을 낮게 둔다. |
| 디버깅이 어려워짐 | inspector에 suspicion reasons와 applied multiplier를 기록한다. |
| 시나리오별 개성이 약해짐 | suspicion 신호별 weight를 scenario config로 분리한다. |

## 1차 완료 기준

- 플레이어가 타깃을 계속 바꾸는 행동이 NPC 자율 타깃 선택에 반영된다.
- 플레이어 공격 빈도가 늘지만, 낮은 suspicion 상태에서는 기존 분포와 크게 다르지 않다.
- A 과집중 상태가 몇 턴 동안 자연스럽게 완화된다.
- Inspector에서 "왜 이번에 플레이어가 의심받았는지"를 확인할 수 있다.
- `npm run test:autonomy`가 통과한다.
