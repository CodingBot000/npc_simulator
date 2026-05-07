# Environment Reference

This document describes what each deployment unit needs. Real values are
delivered separately through `.env`, platform variables, or a secret manager.

## Ownership Rule

- Frontend env is browser-facing. Only `VITE_*` values belong there.
- Backend env owns database credentials, provider secrets, runtime paths, and
  model configuration.
- Root `.env` is an umbrella file for local scripts or single-host Docker
  Compose only.

## Frontend Variables

| Key | Required | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | optional locally, yes for split deploy | Backend API origin reachable from the user's browser. Leave blank in Vite local dev to use the same-origin dev proxy. |
| `VITE_SHOW_INTERACTION_FAILURE_DEBUG` | optional | Enables additional browser-side debug detail. |

Frontend env must not contain database credentials, OpenAI keys, Baseten keys,
RunPod keys, Together keys, SSH paths, or backend storage paths.

Vite local dev server proxy settings are server-side only. Use `BACKEND_PORT`
or `NPC_SIMULATOR_DEV_PROXY_TARGET` in the shell/root local env when the local
backend is not on `http://127.0.0.1:8080`.

## Backend Core Variables

| Key | Required | Description |
| --- | --- | --- |
| `SPRING_PROFILES_ACTIVE` | yes | `local` for local development, `prod` for production-like deploys. |
| `BACKEND_PORT` | yes | HTTP port used by Spring Boot. |
| `BACKEND_STORAGE_ROOT` | yes | Writable backend storage path. |
| `SPRING_DATASOURCE_URL` | yes | JDBC URL for PostgreSQL. |
| `SPRING_DATASOURCE_USERNAME` | yes | PostgreSQL user. |
| `SPRING_DATASOURCE_PASSWORD` | yes | PostgreSQL password. |
| `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE` | recommended | Java backend Hikari max connections. Initial small deploy default is `8`. |
| `SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE` | recommended | Java backend Hikari idle connection floor. Initial default is `2`. |
| `SPRING_DATASOURCE_HIKARI_CONNECTION_TIMEOUT_MS` | recommended | Max wait for a Java DB connection before failing. Initial default is `5000`. |
| `SPRING_DATASOURCE_HIKARI_IDLE_TIMEOUT_MS` | recommended | Idle connection retirement time. Initial default is `30000`. |
| `SPRING_DATASOURCE_HIKARI_MAX_LIFETIME_MS` | recommended | Maximum Java connection lifetime. Initial default is `1800000`. |
| `SPRING_DATASOURCE_HIKARI_LEAK_DETECTION_THRESHOLD_MS` | recommended | Hikari leak detection threshold. Initial default is `30000`. |
| `NPC_SIMULATOR_DB_POOL_MAX` | recommended | Max PostgreSQL connections per Node worker process. Initial small deploy default is `2`. |
| `NPC_SIMULATOR_DB_IDLE_TIMEOUT_MS` | recommended | Node PostgreSQL pool idle timeout. Initial default is `30000`. |
| `NPC_SIMULATOR_DB_CONNECT_TIMEOUT_MS` | recommended | Node PostgreSQL connection timeout. Initial default is `5000`. |
| `NPC_SIMULATOR_CORS_ALLOWED_ORIGINS` | yes | Comma-separated browser origins allowed to call the backend. |
| `NPC_SIMULATOR_DEPLOYMENT_MODE` | yes | `local` or `cloud`. |
| `NPC_SIMULATOR_ADMIN_TOKEN` | cloud admin operations only | Shared token for direct review admin API calls. Do not expose it to frontend env. |

## Public Review Access

Public deployments intentionally expose review read/status endpoints but keep
review mutation and execution endpoints locked.

Public read endpoints:

- `GET /api/review`
- `GET /api/review/finalize`
- `GET /api/review/training`
- `GET /api/review/pipeline`

Local backends allow review writes without a token for development. Cloud/prod
backends require `X-NPC-ADMIN-TOKEN: <NPC_SIMULATOR_ADMIN_TOKEN>` for direct
admin calls to review mutation, training, finalize, promotion, and pipeline
execution endpoints.

Never place `NPC_SIMULATOR_ADMIN_TOKEN` in frontend env, Vite env, browser
runtime config, localStorage, or committed documentation.

## Runtime Layout Variables

| Key | Required | Description |
| --- | --- | --- |
| `NPC_SIMULATOR_ROOT` | yes | Repository/runtime root. |
| `NPC_SIMULATOR_WORKDIR` | yes | Working directory for Node worker execution. |
| `NPC_SIMULATOR_SCRIPTS_ROOT` | yes | Backend Node scripts root. |
| `NPC_SIMULATOR_NODE_BIN_DIR` | yes | Directory containing Node CLI binaries such as `tsx`. |
| `NPC_SIMULATOR_DATA_ROOT` | yes | Data directory used by runtime scripts. |
| `NPC_SIMULATOR_OUTPUTS_ROOT` | yes | Output/artifact directory. |
| `NPC_SIMULATOR_BRIDGE_ENABLED` | yes | Enables Java-to-Node bridge execution. |
| `NPC_SIMULATOR_BRIDGE_TIMEOUT_SECONDS` | yes | Worker timeout budget. |

## Structured Interaction Provider

| Key | Required | Description |
| --- | --- | --- |
| `LLM_PROVIDER_MODE` | yes | `openai` for API mode, `codex` for local CLI-auth mode. |
| `OPENAI_API_KEY` | when OpenAI mode | Required when `LLM_PROVIDER_MODE=openai`. |
| `INTERACTION_MODEL` | yes | Primary structured interaction model. |
| `INTERACTION_FALLBACK_MODEL` | optional | Fallback structured interaction model. |

`LLM_PROVIDER_MODE=codex` is for local development only. Cloud deployments
should use API-based providers.

Default OpenAI-family model aliases now prefer `gpt-5-nano` for both OpenAI
API and Codex CLI authenticated paths. Raise only specific stages to a larger
model when schema adherence or final writing quality requires it.

## OpenAI Responses Tuning

| Key | Required | Description |
| --- | --- | --- |
| `OPENAI_PROMPT_CACHE_PREFIX` | optional | Stable cache namespace, default `npc-simulator:v1`. Bump when prompt policy changes. |
| `OPENAI_PROMPT_CACHE_RETENTION` | optional | `in_memory` by default, or `24h` for supported extended caching. |
| `OPENAI_USAGE_LOG_ENABLED` | optional | Logs usage, cache hit, retry count, latency, and estimated `gpt-5-nano` cost. |
| `OPENAI_RETRY_MAX_ATTEMPTS` | optional | Retry count for 429, 5xx, and network timeouts only; capped at 2. |
| `OPENAI_RETRY_BASE_DELAY_MS` | optional | Exponential backoff base delay with jitter. |
| `OPENAI_INTERACTION_REASONING_EFFORT` | optional | Default `minimal`. Applied to OpenAI API and Codex CLI for GPT-5 models. |
| `OPENAI_INTERACTION_TEXT_VERBOSITY` | optional | Default `low`. |
| `OPENAI_INTERACTION_MAX_OUTPUT_TOKENS` | optional | Default `900`. |
| `OPENAI_INTERACTION_JUDGE_REASONING_EFFORT` | optional | Default `minimal`. |
| `OPENAI_INTERACTION_JUDGE_TEXT_VERBOSITY` | optional | Default `low`. |
| `OPENAI_INTERACTION_JUDGE_MAX_OUTPUT_TOKENS` | optional | Default `400`. |
| `OPENAI_EVAL_JUDGE_REASONING_EFFORT` | optional | Default `minimal`. |
| `OPENAI_EVAL_JUDGE_TEXT_VERBOSITY` | optional | Default `low`. |
| `OPENAI_EVAL_JUDGE_MAX_OUTPUT_TOKENS` | optional | Default `1200`. |
| `OPENAI_FINAL_REPLY_REASONING_EFFORT` | optional | Default `low`. |
| `OPENAI_FINAL_REPLY_TEXT_VERBOSITY` | optional | Default `medium`. |

## Interaction Judge

| Key | Required | Description |
| --- | --- | --- |
| `INTERACTION_JUDGE_MODE` | optional | `on` or `off`. |
| `INTERACTION_JUDGE_MODEL` | when enabled | Judge model. |
| `INTERACTION_JUDGE_TIMEOUT_MS` | when enabled | Judge timeout in milliseconds. |
| `INTERACTION_JUDGE_MAX_OUTPUT_TOKENS` | when enabled | Judge output budget. |
| `INTERACTION_JUDGE_ENFORCEMENT` | optional | Whether judge results enforce behavior. |
| `INTERACTION_JUDGE_CONFIDENCE_THRESHOLD` | optional | Confidence threshold for judge checks. |

## Final Reply Rewrite

| Key | Required | Description |
| --- | --- | --- |
| `FINAL_REPLY_MODE` | yes | `off` for disabled, `on` for enabled. |
| `FINAL_REPLY_BACKEND` | yes | `off`, `local_llama`, `baseten`, `runpod`, or another supported backend. |
| `FINAL_REPLY_MAX_TOKENS` | optional | Rewrite token budget. |
| `FINAL_REPLY_TIMEOUT_MS` | optional | Remote final reply timeout. Defaults to `180000` so hosted rewrite falls back before a long browser wait. |
| `FINAL_REPLY_PROMPT_FORMAT` | optional | Prompt shape for final reply rewrite. |

For a hosted Llama final reply backend:

| Key | Required | Description |
| --- | --- | --- |
| `BASETEN_API_KEY` | when Baseten backend | Baseten API key, supplied privately. |
| `FINAL_REPLY_REMOTE_MODEL_NAME` | when hosted backend | Hosted served model name, supplied privately. |
| `FINAL_REPLY_BASETEN_MODEL_ID` | Baseten option | Hosted model ID, supplied privately. |
| `FINAL_REPLY_BASETEN_MODEL_URL` | Baseten option | Hosted endpoint URL, supplied privately. |
| `RUNPOD_API_KEY` | when RunPod backend | RunPod API key, supplied privately. |
| `FINAL_REPLY_RUNPOD_ENDPOINT_ID` | RunPod option | RunPod endpoint ID, supplied privately. |
| `FINAL_REPLY_RUNPOD_ENDPOINT_MODE` | RunPod option | `queue_vllm` for RunPod serverless queue endpoints, or `load_balancer_vllm` for RunPod load-balancer OpenAI-compatible endpoints. |

The public model family is Llama 3.1 8B Instruct based. Hosted target details
are intentionally omitted from public documentation because remote calls can
incur cost.

## Local Artifact Variables

| Key | Required | Description |
| --- | --- | --- |
| `CANONICAL_MODEL_FAMILY` | optional | Canonical model-family label. |
| `LOCAL_REPLY_MODEL_FAMILY` | optional | Local reply runtime family. |
| `LOCAL_REPLY_LLAMA_RUNTIME_PATH` | local Llama only | Local runtime artifact path. |
| `LOCAL_REPLY_MAX_TOKENS` | optional | Local rewrite output budget. |
| `SHADOW_COMPARE_ENABLED` | optional | Enables local shadow comparison. |

Local artifacts are not required for the default public local run when
`FINAL_REPLY_MODE=off`.
