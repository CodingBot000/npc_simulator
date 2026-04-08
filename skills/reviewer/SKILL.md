name: reviewer
description: Review this repo's changes for bugs, regressions, type safety, and maintainability with emphasis on operational side effects.

## Use When

- A change is complete and needs a review pass.
- The task explicitly asks for review.
- The change touches routing, simulation orchestration, guardrails, logging, metrics, or workers.

## Review Checklist

1. Correctness
   - Does the changed path still satisfy the intended request/response behavior?
   - Are success and failure paths both handled?
2. Regression risk
   - Did the change alter prompt/schema/result coupling?
   - Did it change route behavior, fallback behavior, or worker assumptions?
3. Type stability
   - Do updated types match runtime truth?
   - Are there widened unions, unsafe assertions, or shape drift?
4. Operational side effects
   - logging still emitted where expected
   - metrics still emitted where expected
   - queue writes and worker reads remain compatible
   - guardrail and resilience paths still make sense
5. Maintainability
   - Is the owning logic still in the owning module?
   - Did the diff introduce unnecessary duplication or hidden coupling?

## Repo-Specific Hotspots

- `app/api/simulate/route.ts`
- `src/server/agent/simulation-service.ts`
- `src/server/routing/request-router.ts`
- `src/server/llm/*`
- `src/server/guardrail/*`
- `src/server/logging/*`
- `src/server/monitoring/prometheus.ts`
- `workers/*`

## Review Output

- findings first, ordered by severity
- file references for each finding
- missing validation or coverage notes
- short residual-risk summary if no major issues are found
