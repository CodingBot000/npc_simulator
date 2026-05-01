# Deployment Handoff

This document is public-safe. Replace placeholders with real values only in a
private handoff note, secret manager, or deployment environment.

## Topology

The project can run as:

- Single-host Docker Compose: frontend and backend on the same server.
- Split deployment: Vite frontend and Spring Boot backend on separate cloud
  targets.

For split deployment, the frontend talks to the backend through
`VITE_API_BASE_URL`, and the backend allows browser origins through
`NPC_SIMULATOR_CORS_ALLOWED_ORIGINS`.

The production database is an external managed PostgreSQL instance. The backend
owns schema migration and applies Flyway migrations on startup.

## Placeholders

- Server host: `<SERVER_HOST>`
- SSH user: `<SSH_USER>`
- SSH key path: `<SSH_KEY_PATH>`
- Application directory: `<APP_DIR>`
- Public app domain: `<APP_DOMAIN>`
- Backend API origin: `<API_ORIGIN>`

## Server Access

```bash
ssh -i <SSH_KEY_PATH> <SSH_USER>@<SERVER_HOST>
```

Keep SSH keys outside the repository.

## Environment

Create a private `.env` on the server from `.env.prod.example`, then fill values
from the private handoff:

```bash
cp .env.prod.example .env
```

Required production values include:

- `SPRING_DATASOURCE_URL`
- `SPRING_DATASOURCE_USERNAME`
- `SPRING_DATASOURCE_PASSWORD`
- `NPC_SIMULATOR_CORS_ALLOWED_ORIGINS`
- `VITE_API_BASE_URL`
- `OPENAI_API_KEY`, when `LLM_PROVIDER_MODE=openai`
- Hosted final-reply credentials and target values, when
  `FINAL_REPLY_BACKEND` is enabled

Do not commit `.env` or any file containing real secrets, IPs, hosted endpoint
URLs, model IDs, or passwords.

## Upload And Start

One generic deployment flow is:

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'node_modules' \
  --exclude 'backend/storage' \
  -e "ssh -i <SSH_KEY_PATH>" \
  ./ <SSH_USER>@<SERVER_HOST>:<APP_DIR>/

ssh -i <SSH_KEY_PATH> <SSH_USER>@<SERVER_HOST>
cd <APP_DIR>
docker compose config --quiet
docker compose up -d --build frontend backend
```

If the deployment uses a managed database, confirm that the server can reach the
database endpoint before starting the backend.

## Smoke Checks

```bash
curl -fsS https://<APP_DOMAIN>/
curl -fsS <API_ORIGIN>/actuator/health
curl -fsS <API_ORIGIN>/api/system/info
```

Then open `https://<APP_DOMAIN>` in a browser and run one interaction from the
main conversation screen.

## Hosted Llama Note

Hosted final-reply rewrite can use a Llama 3.1 8B Instruct based runtime.
Actual hosted model IDs, endpoint URLs, served names, and API keys are supplied
privately because calls may incur cost.

