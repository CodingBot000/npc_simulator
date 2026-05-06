# Environment And Deployment Guide

This repository separates real env files from commit-safe templates.

## What Is Committed

Commit-safe templates:

- `.env.example`: index only
- `.env.local.example`: root local monorepo/compose template
- `.env.prod.example`: root production-like compose template
- `frontend/.env.example`: frontend env index
- `frontend/.env.local.example`: frontend local template
- `frontend/.env.prod.example`: frontend production template
- `backend/.env.example`: backend env index
- `backend/.env.local.example`: backend local template
- `backend/.env.prod.example`: backend production template

Deployment/build files that should stay committed:

- `docker-compose.local.yml`
- `docker-compose.yml`
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `.dockerignore`
- `backend/.dockerignore`
- `run-local-host.sh`
- `run-local-baseten.sh`

These files contain wiring and defaults only. Real credentials must be injected
through ignored env files or platform secret managers.

## What Must Not Be Committed

Ignored local/secret files:

- `.env`
- `.env.local`
- `.env.backup-*`
- `frontend/.env`
- `frontend/.env.local`
- `backend/.env`
- `backend/.env.local`
- provider keys, DB passwords, private PEM files
- generated data/artifact directories such as `data/`, `outputs/`, `artifacts/`, `backend/storage/`

Docker build context also excludes env files, so local secrets should not be
copied into images.

## Normal Local Layout

It is normal to have both root `.env.local` and `frontend/.env.local`, but they
mean different things.

| File | Owner | Purpose |
|---|---|---|
| `.env` | root | Local compose/run umbrella env. Usually copied from `.env.local.example`. |
| `.env.local` | root/backend scripts | Personal local secrets and server fallback values. Node backend config may read this only in local mode. |
| `frontend/.env.local` | frontend only | Vite-only browser config. Only `VITE_*` keys are allowed. |
| `backend/.env` | none by default | Not automatically loaded by Spring Boot in this repo. Prefer root `.env`, shell env, or platform env. |

Recommended rule:

- Keep backend secrets in root `.env.local` or platform secrets.
- Keep frontend env limited to `VITE_API_BASE_URL` and other public `VITE_*` values.
- Do not duplicate backend secrets into `frontend/.env.local`.

## Local Integrated Run

For normal local development:

```bash
cp .env.local.example .env
# Put real OPENAI_API_KEY or other secrets in .env.local, not in committed files.
./run-local-host.sh
```

`run-local-host.sh` loads root `.env` and then root `.env.local`. It exports the
result to Spring Boot, Node workers, and Vite.

For local Docker:

```bash
cp .env.local.example .env
docker compose -f docker-compose.local.yml up --build
```

`docker-compose.local.yml` reads root `.env` by Docker Compose convention and
passes only selected values into containers.

## Frontend-Only Local Run

If running the frontend directly without `run-local-host.sh`:

```bash
cp frontend/.env.local.example frontend/.env.local
npm --workspace frontend run dev
```

Only browser-facing keys belong in this file:

```dotenv
# Leave blank to use the Vite dev proxy for a local backend.
# Set to a full URL only when testing against a remote backend.
VITE_API_BASE_URL=
VITE_SHOW_INTERACTION_FAILURE_DEBUG=true
```

The dev proxy targets `http://127.0.0.1:${BACKEND_PORT:-8080}` by default.
Set `BACKEND_PORT` or `NPC_SIMULATOR_DEV_PROXY_TARGET` in the shell when the
local backend is listening somewhere else.

## Backend-Only Local Run

Spring Boot does not automatically load `backend/.env`. For backend-only runs,
either export environment variables in the shell or use the root script.

Reference template:

```bash
less backend/.env.local.example
```

If you choose to source a backend env file manually, keep it ignored and never
commit it.

## Separated Production Deploy

For separated frontend/backend deployment units:

- Use `frontend/.env.prod.example` for frontend build/platform env.
- Use `backend/.env.prod.example` for backend platform env/secrets.
- Do not rely on root `.env.local`; cloud mode does not read it.

Frontend production:

```dotenv
VITE_API_BASE_URL=https://api.example.com
VITE_SHOW_INTERACTION_FAILURE_DEBUG=false
```

Backend production essentials:

```dotenv
NPC_SIMULATOR_DEPLOYMENT_MODE=cloud
SPRING_PROFILES_ACTIVE=prod
SPRING_DATASOURCE_URL=jdbc:postgresql://db.example.internal:5432/npc_simulator
SPRING_DATASOURCE_USERNAME=npc_simulator
SPRING_DATASOURCE_PASSWORD=replace_me
SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=8
SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=2
SPRING_DATASOURCE_HIKARI_CONNECTION_TIMEOUT_MS=5000
SPRING_DATASOURCE_HIKARI_IDLE_TIMEOUT_MS=30000
SPRING_DATASOURCE_HIKARI_MAX_LIFETIME_MS=1800000
SPRING_DATASOURCE_HIKARI_LEAK_DETECTION_THRESHOLD_MS=30000
NPC_SIMULATOR_DB_POOL_MAX=2
NPC_SIMULATOR_DB_IDLE_TIMEOUT_MS=30000
NPC_SIMULATOR_DB_CONNECT_TIMEOUT_MS=5000
NPC_SIMULATOR_CORS_ALLOWED_ORIGINS=https://app.example.com
LLM_PROVIDER_MODE=openai
OPENAI_API_KEY=replace_me
FINAL_REPLY_MODE=off
FINAL_REPLY_BACKEND=off
FINAL_REPLY_TIMEOUT_MS=180000
```

If hosted final reply rewrite is enabled, configure one of the remote backends in
the backend env only:

- Baseten: `FINAL_REPLY_BACKEND=baseten`, `FINAL_REPLY_BASETEN_*`, `BASETEN_API_KEY`
- RunPod: `FINAL_REPLY_BACKEND=runpod`, `FINAL_REPLY_RUNPOD_ENDPOINT_ID`, `FINAL_REPLY_RUNPOD_ENDPOINT_MODE`, `RUNPOD_API_KEY`
- Together: `FINAL_REPLY_BACKEND=together`, `FINAL_REPLY_REMOTE_MODEL_NAME`, `TOGETHER_API_KEY`

## Provider Split

Two separate switches exist:

- `LLM_PROVIDER_MODE=codex|openai|deterministic`
  - structured interaction engine
  - returns reply draft, selected action, structured impact, intent
- `FINAL_REPLY_BACKEND=off|codex|openai_api|local_llama|local_qwen|promoted|together|runpod|baseten`
  - optional final `reply.text` rewrite backend

Production/cloud constraints:

- `LLM_PROVIDER_MODE=codex` is not allowed in cloud mode.
- `FINAL_REPLY_BACKEND=codex` is not allowed in cloud mode.
- Local artifact paths such as `LOCAL_REPLY_LLAMA_RUNTIME_PATH` are local-first
  and should stay disabled in production unless the backend image or mounted
  storage contains the artifact.

## Practical Rules

- Browser-facing values belong in frontend env only.
- DB credentials and provider secrets belong in backend env only.
- Root `.env` is a local compose convenience file.
- Root `.env.local` is a local secret/override file.
- `backend/.env` is not a first-class runtime file unless explicitly sourced.
- Keep examples complete enough to copy, but keep real secrets out of git.
