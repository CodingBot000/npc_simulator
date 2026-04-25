# backend/scripts Layer Rules

`backend/scripts` is split by responsibility. Do not reintroduce a generic `shared` bucket.

## Directory ownership

- `contracts/`
  - API and review contract types only.
  - Source of truth for backend-facing DTO aliases.
  - No runtime logic, no DB logic, no provider logic.
- `domain/`
  - Backend-only domain types.
  - Use for concepts that are not API DTOs and not persistence records.
- `persistence/`
  - File/DB persisted shapes.
  - Use for saved world state, memory files, logs, runtime persistence state.
- `provider/`
  - LLM provider input/output types and provider interface shapes.
  - Do not put storage or scenario logic here.
- `support/`
  - Backend-only pure constants and helpers.
  - Keep this side-effect free.
- `server/`
  - Main runtime implementation.
  - API, engine, providers, scenarios, seeds, store, config live here.
- `runtime/`, `review/`, `api/`
  - Entry points and worker-facing orchestration.
- `*.ts` at `backend/scripts/` root
  - Top-level worker and orchestration entry points.
  - May depend on `runtime/`, `review/`, `api/`, and `server/`.

## Allowed dependency direction

- `contracts` -> `@contracts/*` only
- `domain` -> `contracts`, `@sim-shared/*`
- `persistence` -> `contracts`, `domain`, `@sim-shared/*`
- `provider` -> `contracts`, `domain`, `@sim-shared/*`
- `support` -> `@sim-shared/*`
- `server` -> may depend on all layers above
- `runtime`, `review`, `api` -> may depend on the layers above and `server`
- root `*.ts` entry points -> may depend on the layers above, `server`, and orchestration layers

Lower layers must not import from higher layers.

## Import rules

- Use aliases, not deep relative paths:
  - `@backend-contracts/api`
  - `@backend-contracts/review`
  - `@backend-domain`
  - `@backend-persistence`
  - `@backend-provider`
  - `@backend-support/constants`
  - `@backend-support/utils`
- Do not add a new catch-all alias or facade file.
- If a new type seems reusable, place it by meaning, not by convenience.

## Placement guide

- API request/response shape: `contracts`
- Saved file/DB record shape: `persistence`
- Provider request/response or provider interface: `provider`
- Backend-only business concept: `domain`
- Pure helper/constant: `support`
- Feature logic, orchestration, env handling, I/O: `server`

## Guardrails

- Do not make `support` depend on `server`.
- Do not make `contracts` depend on backend runtime code.
- Do not move frontend concerns into `backend/scripts`.
- When in doubt, keep the narrower dependency scope.
