# Cloud Run Deployment Handoff

This handoff covers the Spring Boot API on Google Cloud Run. The current API
service is `npc-simulator-api` in `asia-northeast3`. Keep the project ID and
runtime secrets in the deployment environment, not in this repository.

The React and Vite frontend uses `VITE_API_BASE_URL` to reach the API. The
backend allows browser origins through
`NPC_SIMULATOR_CORS_ALLOWED_ORIGINS`. The backend owns schema migration and
applies Flyway migrations on startup against managed PostgreSQL.

## Build and Deploy

Build the backend image from the repository root. The Cloud Build config uses
the backend Dockerfile, and `.gcloudignore` excludes local data and virtualenvs.

```bash
PROJECT_ID="$(gcloud config get-value project)"
REGION=asia-northeast3
SERVICE=npc-simulator-api
GIT_SHA="$(git rev-parse --short HEAD)"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/portfolio/$SERVICE:$GIT_SHA"

gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --config=deploy/cloudrun/cloudbuild.yaml \
  --substitutions="_IMAGE=$IMAGE" \
  .

gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$IMAGE" \
  --update-env-vars=LLM_PROVIDER_MODE=openai
```

Keep `OPENAI_API_KEY` and database credentials in Cloud Run secret references.
The backend defaults OpenAI model calls to `gpt-6-luna`. The frontend deployment
must set `VITE_API_BASE_URL` to the Cloud Run API URL.

## Environment and Access

Required backend settings include:

- `SPRING_DATASOURCE_URL`
- `SPRING_DATASOURCE_USERNAME`
- `SPRING_DATASOURCE_PASSWORD`
- `NPC_SIMULATOR_CORS_ALLOWED_ORIGINS`
- `LLM_PROVIDER_MODE=openai`
- `OPENAI_API_KEY`
- `NPC_SIMULATOR_ADMIN_TOKEN`, for private direct review admin calls
- `VITE_API_BASE_URL` on the frontend host

Never put database credentials, provider keys, or admin tokens in frontend
environment variables or committed files.

## Public Review Policy

The public portfolio deployment keeps review list/status pages readable, but it
does not allow browser users to mutate review data or launch training/pipeline
jobs.

Allowed without admin token:

- `GET /api/review`
- `GET /api/review/finalize`
- `GET /api/review/training`
- `GET /api/review/pipeline`

Locked on cloud/prod unless a private `X-NPC-ADMIN-TOKEN` header is supplied:

- `PATCH /api/review`
- `POST /api/review/finalize`
- `POST /api/review/training`
- `POST /api/review/training/evaluate`
- `POST /api/review/training/decision`
- `POST /api/review/training/promote`
- `POST /api/review/pipeline/*`

Do not put the admin token in frontend environment variables. For direct admin
requests, use a private API client and send the token in the request header.

## Smoke Checks

```bash
curl -fsS "$API_URL/actuator/health"
curl -fsS "$API_URL/api/system/info"
```

Confirm health is `UP`, deployment mode is `cloud`, and the OpenAI provider is
configured. A live interaction can incur model usage charges.

## Hosted Llama Note

Hosted final-reply rewrite can use a Llama 3.1 8B Instruct based runtime.
Actual hosted model IDs, endpoint URLs, served names, and API keys are supplied
privately because calls may incur cost.
