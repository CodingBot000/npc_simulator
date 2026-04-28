# OpenAI fast Judge LLM development plan

## Goal

Add a fast, low-cost OpenAI Judge LLM that classifies whether a generated NPC reply still matches the selected player action and target, without returning to brittle keyword-based validation.

The Judge is not a replacement for the safety validator. The safety validator blocks malformed or dangerous output. The Judge provides semantic telemetry and, later, can be used to trigger retry only when the signal is stable enough.

## Current problem

The previous validator tried to determine action meaning through fixed word fragments such as `같이`, `편`, `공조`, `기록`, or `책임`.

That approach failed because a valid Korean reply can express the same intent without those exact words. Example:

> 좋아, 서진호한테 책임을 몰자. 위험 보고를 받고도 실험을 멈추지 않은 건 그 사람이야.

This is semantically aligned with `ally`, but it can fail a fixed-token validator.

## Architecture decision

Use a small OpenAI model as a semantic classifier.

- Provider: OpenAI API, not Codex CLI.
- Default model: `gpt-4.1-nano`.
- Execution mode: observation-only first.
- Existing action definitions are the source of truth.
- Do not duplicate action categories in the Judge prompt.

The Judge will read the existing `PLAYER_ACTION_SPECS` entry for the selected action:

- `id`
- `label`
- `description`
- `canonicalIntent`
- `targetPolicy`
- `actionOnlyFrame` / `combinedBias`

This keeps the system scenario-extensible. If a future scenario adds or changes actions, the Judge follows the same action spec instead of requiring a second hardcoded classification map.

## Fast-response configuration

Recommended defaults:

```env
INTERACTION_JUDGE_MODE=on
INTERACTION_JUDGE_MODEL=gpt-4.1-nano
INTERACTION_JUDGE_TIMEOUT_MS=4000
INTERACTION_JUDGE_MAX_OUTPUT_TOKENS=96
INTERACTION_JUDGE_ENFORCEMENT=off
```

API parameters:

- `model`: `INTERACTION_JUDGE_MODEL`, default `gpt-4.1-nano`
- `temperature`: `0`
- `max_output_tokens`: `96`
- `text.format`: strict JSON schema
- timeout: `4000ms`

The Judge must remain best-effort and should never break the main game turn.

Implementation note: empirical smoke tests showed `gpt-5-nano` repeatedly returned `status=incomplete` with only a reasoning block and no parseable JSON at 128, 256, and 512 output tokens. For this short classifier path, `gpt-4.1-nano` produced valid strict JSON with a 96 token output budget and lower end-to-end latency.

## Judge input

Keep the input intentionally short:

```json
{
  "actionId": "ally",
  "actionLabel": "편들기",
  "actionDescription": "상대와 한편이 되어 다른 사람을 고립시키려 한다.",
  "canonicalIntent": "지금 상대와 한편이 되어 다른 사람을 고립시키려 한다.",
  "targetPolicy": "required",
  "targetLabel": "서진호",
  "inputMode": "action",
  "playerText": "편들기 - 공격타겟 : 서진호",
  "replyText": "좋아, 서진호한테 책임을 몰자..."
}
```

Do not include full scene state, full memory, or all retrieved evidence. This is a classifier, not another generator.

## Judge output

Strict JSON:

```json
{
  "aligned": true,
  "targetMaintained": true,
  "fatalMismatch": false,
  "confidence": 0.82,
  "reason": "서진호를 함께 몰아가는 공조 발화다."
}
```

Definitions:

- `aligned`: reply broadly preserves the selected action intent.
- `targetMaintained`: required target is not clearly lost or replaced.
- `fatalMismatch`: reply is clearly about a different action/target.
- `confidence`: 0 to 1.
- `reason`: one short Korean sentence for debugging. Keep it under 60 characters. It can be removed later for even lower token output.

## Integration flow

1. Generate the interaction with Codex/OpenAI/deterministic provider.
2. Run existing safety validator.
3. Run final reply rewrite if enabled.
4. Sanitize final reply.
5. Run Judge in observation mode.
6. Attach `replyJudge` to:
   - inspector
   - interaction log
   - world conversation NPC message
   - UI processing trace modal
7. Do not reject or rewrite based on Judge result in the first implementation.

## Trace and UI

Add trace stages:

- `reply_judge_request`
- `reply_judge_result`

The processing modal should show:

- model/source
- aligned / targetMaintained / fatalMismatch
- confidence
- reason
- skipped/failed state if Judge is off, missing API key, or timed out

## Enforcement policy

Initial mode:

```env
INTERACTION_JUDGE_ENFORCEMENT=off
```

In this mode, Judge output is telemetry only.

Future optional modes:

- `warn`: same as observation, but show warnings more prominently.
- `retry`: only trigger retry when `fatalMismatch=true` and `confidence >= threshold`.
- `reject`: not recommended until enough data is collected.

## Implementation steps

1. Add runtime contract type `InteractionJudgeResult`.
2. Add config block `appConfig.interactionJudge`.
3. Add `backend/scripts/server/judge/interaction-judge.ts`.
4. Build prompt from `PLAYER_ACTION_SPECS` and current `InteractionContract`.
5. Call OpenAI Responses API with strict JSON schema.
6. Add Judge result to `runInteractionTurn`.
7. Persist Judge result through interaction log, world snapshot, Spring mapper, and frontend types.
8. Render Judge details in the processing record modal.
9. Regenerate OpenAPI contracts.
10. Verify with typecheck and at least one isolated `/api/interact` smoke.

## Risk controls

- Judge timeout must be short.
- Judge failure must not fail the turn.
- Judge must not duplicate action definitions.
- Judge result must be telemetry until logs prove it is stable.

## Implementation result - 2026-04-29 01:50 KST

Implemented the observation-mode Judge path.

- Added `InteractionJudgeResult` to the runtime contract and regenerated OpenAPI artifacts.
- Added `backend/scripts/server/judge/interaction-judge.ts`.
- Integrated Judge execution after final reply rewrite and before world-state commit.
- Persisted Judge output through inspector, interaction log, world snapshot, Spring mapper, and frontend conversation messages.
- Added processing-modal display for Judge status, model, confidence, target retention, fatal mismatch, reason, and errors.
- Kept enforcement off by default: Judge telemetry does not reject, rewrite, or block the turn.
- `run-local-baseten.sh` enables Judge telemetry for local Baseten demo runs.

Smoke result:

- Endpoint: `POST /api/interact`
- Test action: `ally` / target `서진호`
- Final reply backend: Baseten Llama
- Judge backend: OpenAI `gpt-4.1-nano`
- Judge result: `aligned=true`, `targetMaintained=true`, `fatalMismatch=false`, `confidence=0.9`
- Judge duration: `1799ms`
- Main bottlenecks in the smoke remained Codex first pass (`67820ms`) and Baseten rewrite (`83927ms`), not Judge.

Verification:

- `npx tsc -p tsconfig.backend-scripts.json --noEmit`
- `npm --workspace frontend run typecheck`
- `cd backend && ./gradlew compileJava`
- `git diff --check`
