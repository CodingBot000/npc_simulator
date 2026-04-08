name: planner
description: Define scope, identify impacted files, and break work into concrete steps for this repository.

## Use When

- The task spans multiple areas such as `app/api`, `src/server`, `src/lib`, `workers`, `scripts`, or `db/migrations`.
- The owning path is not obvious.
- The request can affect contracts, observability, guardrails, queues, or workers.

## Repo-Specific Planning Checklist

1. Find the entrypoint.
   - UI route: `app/page.tsx` or `src/components/*`
   - API route: `app/api/*/route.ts`
   - Server logic: `src/server/*`
   - Shared prompt/type code: `src/lib/*` or `prompts/*`
   - Worker path: `workers/*`
2. Identify adjacent impact files.
   - Types: `src/lib/types.ts`
   - Prompts/contracts: `src/lib/prompts.ts`, `prompts/*`
   - Routing: `src/server/routing/request-router.ts`
   - Simulation orchestration: `src/server/agent/simulation-service.ts`
   - Logging/metrics: `src/server/logging/*`, `src/server/monitoring/prometheus.ts`
   - Guardrails: `src/server/guardrail/*`, `src/guardrail/*`
3. Mark invariants to preserve.
   - existing API response shape
   - structured LLM schema/prompt compatibility
   - log and metric emission
   - failure-path behavior for timeout/retry/fallback code
4. Break work into the smallest meaningful steps.
5. Pick validation based on the changed surface.

## Validation Mapping

- Always consider `npm run typecheck`
- Use `npm run build` when App Router, route handlers, or framework boundaries changed
- Use `npm run verify:monitoring` when monitoring or metrics behavior changed
- Use guardrail eval scripts only when guardrail logic, thresholds, or calibration changed
- Use worker commands only when worker code or queue behavior changed

## Output

- scope summary
- owning files
- likely secondary impact files
- step-by-step execution order
- concrete validation list
- open questions only if they block safe implementation
