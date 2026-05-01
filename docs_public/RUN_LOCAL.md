# Local Run Guide

This guide is safe to publish. It uses public templates and placeholders only.
Real API keys, database passwords, hosted model IDs, and hosted endpoint URLs are
supplied separately.

## Prerequisites

- Node.js and npm
- Java 21
- Docker Desktop, when using the bundled local PostgreSQL service
- Codex CLI login only when testing `LLM_PROVIDER_MODE=codex`

Install dependencies first:

```bash
npm install
```

Create a local env file from the public template:

```bash
cp .env.local.example .env
```

Keep real secrets in `.env.local` or your shell environment. Do not commit
`.env`, `.env.local`, or copied secret files.

## Basic Integrated Run

The integrated local script starts PostgreSQL with Docker, runs the Spring Boot
backend on the host, waits for backend health, then starts the Vite frontend.

```bash
./run-local-host.sh
```

Default URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://127.0.0.1:8080`
- Health check: `http://127.0.0.1:8080/actuator/health`

## OpenAI Mode

Use this mode when the structured interaction provider should call OpenAI.
`OPENAI_API_KEY` is required and must be provided separately.

```bash
LLM_PROVIDER_MODE=openai FINAL_REPLY_MODE=off ./run-local-host.sh
```

`FINAL_REPLY_MODE=off` is the simplest public local run because it does not
require a local or hosted Llama rewrite runtime.

## Codex CLI Mode

Use this mode for local CLI-auth testing. This is intended for local development,
not cloud deployment.

```bash
codex login
LLM_PROVIDER_MODE=codex FINAL_REPLY_MODE=off ./run-local-host.sh
```

No OpenAI API key is required for the structured interaction path in this mode,
but the machine must already be authenticated with Codex CLI.

## Optional Hosted Llama Final Reply

The final reply rewrite can be routed to a hosted Llama runtime. Hosted runtime
targets can incur cost, so public documentation does not include model IDs,
endpoint URLs, or served model names.

Use the Baseten helper only after receiving the runtime values out of band:

```bash
export BASETEN_API_KEY=<provided separately>
export FINAL_REPLY_REMOTE_MODEL_NAME=<provided separately>
export FINAL_REPLY_BASETEN_MODEL_ID=<provided separately>
# or:
# export FINAL_REPLY_BASETEN_MODEL_URL=<provided separately>

./run-local-baseten.sh
```

The trained reply model family is Llama 3.1 8B Instruct based. Runtime artifacts
and hosted target details are not included in this public guide.

## Backend Only

For API-only checks:

```bash
./run-local-host.sh --backend-only
```

If PostgreSQL is already running:

```bash
./run-local-host.sh --skip-postgres
```

