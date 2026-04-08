name: implementer
description: Apply the smallest safe code change for this repo, preserving existing contracts and operational behavior.

## Use When

- The owning files are known.
- The task is implementation, refactor, or bug fix work.

## Implementation Rules

- Change the narrowest owning path first.
- Prefer existing helpers, types, and conventions over new abstractions.
- Preserve current response contracts unless the task explicitly changes them.
- In `src/server/*`, avoid accidental changes to:
  - logging
  - Prometheus metrics
  - guardrail decisions
  - retry/timeout/fallback behavior
  - queue or worker handoff
- In `app/*` and `src/components/*`, preserve existing visual language from `app/globals.css`.
- If prompts or schemas change, keep `src/lib/prompts.ts`, `prompts/*`, and downstream result handling aligned.

## Change Flow

1. Confirm the exact owning file.
2. Make the smallest coherent edit.
3. Update dependent types or prompt contracts only where needed.
4. Run the smallest relevant verification set.
5. Summarize changed files, validation, and residual risk.

## Default Validation

- Start with `npm run typecheck`
- Add `npm run build` for route/UI/framework-sensitive changes
- Add targeted scripts only when directly relevant to the touched path

## Avoid

- repo-wide cleanup unrelated to the task
- speculative renames or abstractions
- adding commands or tooling not already configured in the repo
