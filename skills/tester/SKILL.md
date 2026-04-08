name: tester
description: Choose and run the smallest executable validation set that matches the changed area in this repo.

## Use When

- A task is implemented and needs verification.
- The changed path affects runtime behavior, contracts, or operations.

## Baseline Facts

- `package.json` has `build` and `typecheck`
- `package.json` does not define a lint script
- `package.json` does not define a repo-wide automated test runner
- Validation in this repo is command selection plus targeted scripts and manual checks

## Validation Selection

### Always consider

- `npm run typecheck`

### Add when relevant

- `npm run build`
  - for `app/*`, `src/components/*`, route handlers, or Next.js boundary changes
- `npm run verify:monitoring`
  - for monitoring or metric emission changes
- `npm run eval:guardrail`
- `npm run eval:guardrail-calibration`
- `npm run eval:guardrail-thresholds`
  - only for guardrail logic, calibration, threshold, or evaluation changes
- `npm run run:simulate`
  - for simulation pipeline or API behavior checks when required inputs are available
- `npm run run:reeval` or `npm run re-eval:online-anomalies`
  - for reevaluation or anomaly-processing changes
- `npm run worker:log`, `npm run worker:drift`, `npm run worker:eval`
  - only when worker execution itself is part of the changed behavior

## Manual Checks

- `POST /api/simulate` for end-to-end simulation behavior
- `GET /api/metrics` for metrics exposure
- browser check of `app/page.tsx` flows for UI work

## Output

- commands run
- command results
- manual checks performed
- checks not run and why
- remaining risk tied to env, model access, database, or worker availability
