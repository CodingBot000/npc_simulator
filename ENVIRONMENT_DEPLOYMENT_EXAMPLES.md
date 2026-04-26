# Environment And Deployment Examples

This repository currently uses three env ownership layers:

- `.env.example`: local `docker-compose` umbrella env
- `frontend/.env.example`: frontend runtime env
- `backend/.env.example`: backend runtime env

Actual `.env`, `.env.local`, and secret-bearing files are intentionally not edited by these examples.

## Final reply split (stage 1)

Two separate switches now exist:

- `LLM_PROVIDER_MODE=codex|openai|deterministic`
  - decides the structured interaction engine
  - returns `reply`, `selectedAction`, `structuredImpact`, `intent`
- `FINAL_REPLY_BACKEND=off|codex|openai_api|local_llama|local_qwen|promoted|together|runpod`
  - only rewrites `reply.text` at the end

Current stage-1 limitation:

- `together` and `runpod` are supported as final reply backends
- they are **not** yet promoted to full structured providers
- cloud runtime rejects `LLM_PROVIDER_MODE=codex` and `FINAL_REPLY_BACKEND=codex`

## 1. Local frontend + local docker backend + local Postgres

Use the root compose env as the main source:

```dotenv
NPC_SIMULATOR_DEPLOYMENT_MODE=local
VITE_API_BASE_URL=http://localhost:8080
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/npc_simulator
SPRING_PROFILES_ACTIVE=local
LLM_PROVIDER_MODE=codex
FINAL_REPLY_MODE=off
FINAL_REPLY_BACKEND=off
NPC_SIMULATOR_ROOT=.
NPC_SIMULATOR_WORKDIR=.
NPC_SIMULATOR_SCRIPTS_ROOT=./backend/scripts
NPC_SIMULATOR_NODE_BIN_DIR=./node_modules/.bin
NPC_SIMULATOR_DATA_ROOT=./data
NPC_SIMULATOR_OUTPUTS_ROOT=./outputs
```

Notes:

- Frontend browser talks to `http://localhost:8080`
- Backend may use local CLI-oriented provider flows
- Local final reply testing can mix:
  - `LLM_PROVIDER_MODE=codex` + `FINAL_REPLY_BACKEND=local_llama`
  - `LLM_PROVIDER_MODE=codex` + `FINAL_REPLY_BACKEND=openai_api`
  - `LLM_PROVIDER_MODE=openai` + `FINAL_REPLY_BACKEND=together`
- Backend may fall back to `PROJECT_ROOT/.env.local` for missing server env values only in local mode
- Local reply / shadow compare artifact paths may stay enabled locally

## 2. Local frontend + cloud backend + cloud Postgres

Frontend local env:

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

Backend cloud env:

```dotenv
NPC_SIMULATOR_DEPLOYMENT_MODE=cloud
BACKEND_PORT=8080
BACKEND_STORAGE_ROOT=/srv/npc-simulator/storage
SPRING_PROFILES_ACTIVE=prod
SPRING_DATASOURCE_URL=jdbc:postgresql://db.example.internal:5432/npc_simulator
SPRING_DATASOURCE_USERNAME=npc_simulator
SPRING_DATASOURCE_PASSWORD=replace_me
NPC_SIMULATOR_ROOT=/workspace
NPC_SIMULATOR_WORKDIR=/workspace
NPC_SIMULATOR_SCRIPTS_ROOT=/workspace/backend/scripts
NPC_SIMULATOR_NODE_BIN_DIR=/workspace/node_modules/.bin
NPC_SIMULATOR_DATA_ROOT=/workspace/data
NPC_SIMULATOR_OUTPUTS_ROOT=/workspace/outputs
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
LLM_PROVIDER_MODE=openai
FINAL_REPLY_MODE=auto
FINAL_REPLY_BACKEND=together
FINAL_REPLY_REMOTE_PROVIDER=together
FINAL_REPLY_REMOTE_MODEL_NAME=meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
OPENAI_API_KEY=replace_me
TOGETHER_API_KEY=replace_me
SHADOW_COMPARE_ENABLED=false
```

Notes:

- `http://localhost:3000` must remain in backend CORS while local browser access is needed
- Cloud runtime bridge requests fail fast if `LLM_PROVIDER_MODE=codex` or `FINAL_REPLY_BACKEND=codex`
- Final reply rewrite should use API/hosted model backends in cloud
- Local artifact-based inference is kept off by default in cloud unless the server image explicitly includes those artifacts

## 3. Cloud frontend + cloud backend + cloud Postgres

Frontend cloud env:

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

Backend cloud env:

```dotenv
NPC_SIMULATOR_DEPLOYMENT_MODE=cloud
BACKEND_PORT=8080
BACKEND_STORAGE_ROOT=/srv/npc-simulator/storage
SPRING_PROFILES_ACTIVE=prod
SPRING_DATASOURCE_URL=jdbc:postgresql://db.example.internal:5432/npc_simulator
SPRING_DATASOURCE_USERNAME=npc_simulator
SPRING_DATASOURCE_PASSWORD=replace_me
NPC_SIMULATOR_ROOT=/workspace
NPC_SIMULATOR_WORKDIR=/workspace
NPC_SIMULATOR_SCRIPTS_ROOT=/workspace/backend/scripts
NPC_SIMULATOR_NODE_BIN_DIR=/workspace/node_modules/.bin
NPC_SIMULATOR_DATA_ROOT=/workspace/data
NPC_SIMULATOR_OUTPUTS_ROOT=/workspace/outputs
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=https://app.example.com
LLM_PROVIDER_MODE=openai
FINAL_REPLY_MODE=auto
FINAL_REPLY_BACKEND=runpod
FINAL_REPLY_REMOTE_PROVIDER=runpod:replace_endpoint_id
FINAL_REPLY_REMOTE_MODEL_NAME=meta-llama/Meta-Llama-3.1-8B-Instruct
FINAL_REPLY_RUNPOD_ENDPOINT_ID=replace_endpoint_id
OPENAI_API_KEY=replace_me
RUNPOD_API_KEY=replace_me
SHADOW_COMPARE_ENABLED=false
```

Notes:

- Frontend and backend are fully separate deployment units
- Browser CORS should point only at the deployed frontend domain
- Cloud mode resolves server env from process/platform injection only and does not read `.env.local`
- Cloud runtime bridge requests fail fast if `LLM_PROVIDER_MODE=codex` or `FINAL_REPLY_BACKEND=codex`
- Current backend image still runs Node bridge/scripts from the packaged workspace, but the Java side now reads explicit runtime layout envs (`NPC_SIMULATOR_*_ROOT`, `NPC_SIMULATOR_NODE_BIN_DIR`, `NPC_SIMULATOR_WORKDIR`) instead of assuming only a repo-root layout
- Training / review artifact execution remains local-first for now

## Practical rules

- Browser-facing values belong in frontend env only
- DB credentials and provider secrets belong in backend env only
- Root `.env` is a local compose convenience file, not the source for separated cloud deploys
- `contracts/` is the API contract source of truth
- `shared/simulator-rules/` is only for environment-independent rules and value sets
