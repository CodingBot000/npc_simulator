# Environment And Deployment Examples

This repository currently uses three env ownership layers:

- `.env.example`: local `docker-compose` umbrella env
- `frontend/.env.example`: frontend runtime env
- `backend/.env.example`: backend runtime env

Actual `.env`, `.env.local`, and secret-bearing files are intentionally not edited by these examples.

## 1. Local frontend + local docker backend + local Postgres

Use the root compose env as the main source:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/npc_simulator
SPRING_PROFILES_ACTIVE=local
LLM_PROVIDER_MODE=codex
NPC_SIMULATOR_ROOT=.
```

Notes:

- Frontend browser talks to `http://localhost:8080`
- Backend may use local CLI-oriented provider flows
- Local reply / shadow compare artifact paths may stay enabled locally

## 2. Local frontend + cloud backend + cloud Postgres

Frontend local env:

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

Backend cloud env:

```dotenv
BACKEND_PORT=8080
BACKEND_STORAGE_ROOT=/srv/npc-simulator/storage
SPRING_PROFILES_ACTIVE=prod
SPRING_DATASOURCE_URL=jdbc:postgresql://db.example.internal:5432/npc_simulator
SPRING_DATASOURCE_USERNAME=npc_simulator
SPRING_DATASOURCE_PASSWORD=replace_me
NPC_SIMULATOR_ROOT=/workspace
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
LLM_PROVIDER_MODE=openai
OPENAI_API_KEY=replace_me
LOCAL_REPLY_ADAPTER_MODE=off
SHADOW_COMPARE_ENABLED=false
```

Notes:

- `http://localhost:3000` must remain in backend CORS while local browser access is needed
- Cloud backend should not rely on local CLI auth as its primary runtime path
- Local artifact-based inference is kept off by default in cloud

## 3. Cloud frontend + cloud backend + cloud Postgres

Frontend cloud env:

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

Backend cloud env:

```dotenv
BACKEND_PORT=8080
BACKEND_STORAGE_ROOT=/srv/npc-simulator/storage
SPRING_PROFILES_ACTIVE=prod
SPRING_DATASOURCE_URL=jdbc:postgresql://db.example.internal:5432/npc_simulator
SPRING_DATASOURCE_USERNAME=npc_simulator
SPRING_DATASOURCE_PASSWORD=replace_me
NPC_SIMULATOR_ROOT=/workspace
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=https://app.example.com
LLM_PROVIDER_MODE=openai
OPENAI_API_KEY=replace_me
LOCAL_REPLY_ADAPTER_MODE=off
SHADOW_COMPARE_ENABLED=false
```

Notes:

- Frontend and backend are fully separate deployment units
- Browser CORS should point only at the deployed frontend domain
- Current backend image still needs `NPC_SIMULATOR_ROOT=/workspace` because the Spring backend runs Node-based bridge code from the workspace layout
- Training / review artifact execution remains local-first for now

## Practical rules

- Browser-facing values belong in frontend env only
- DB credentials and provider secrets belong in backend env only
- Root `.env` is a local compose convenience file, not the source for separated cloud deploys
- `contracts/` is the API contract source of truth
- `shared/simulator-rules/` is only for environment-independent rules and value sets
