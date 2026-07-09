# Environment Variables

Each service validates env at startup through `shared/src/env`. Invalid env must
fail fast with a readable error. Real secrets are never committed.

## Shared Service Env

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production` |
| `FACTORY_ENV` | `local`, `staging`, or `production` |
| `SERVICE_ID`, `SERVICE_NAME`, `SERVICE_DOMAIN`, `SERVICE_PORT` | service identity |
| `FACTORY_INTERNAL_TOKEN` | service-to-service auth |
| `FACTORY_ADMIN_TOKEN` | privileged gateway/dashboard auth |
| `SERVICE_REGISTRY_URL` | registry base URL |
| `EVENT_BUS_URL` | event bus base URL |
| `LOG_LEVEL` | pino log level |

## Data and Assets

| Var | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_DB_NAME` | persistent state |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | file asset service |
| `CLOUDFRONT_DOMAIN` | optional public asset delivery |

## Intelligence and Voice

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | real LLM/realtime providers |
| `LLM_DEFAULT_PROVIDER` | default provider selection |
| `LLM_MAX_COST_PER_TASK_USD` | per-task budget gate |
| `LLM_SAFE_MODE_FALLBACK` | force deterministic fallback |
| `VOICE_*` | realtime voice model/session settings |
| `TAVILY_API_KEY` | Phase AG — real web search grounding for `internet-research-service` (`shared/src/research`). Optional: unset falls back to LLM-recall/curated knowledge, honestly marked via `sourceMode: 'llm_only' \| 'curated_fallback'` on every research record, never silently upgraded to "real". |

## Delivery and Operations

| Var | Purpose |
|---|---|
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_DEFAULT_BRANCH` | real PR delivery |
| `DOKPLOY_BASE_URL`, `DOKPLOY_API_TOKEN` | Dokploy diagnostics/execution |
| `CODE_WORKSPACE_ROOT` | isolated checkout for code operator work |
| `WORKSPACE_ROOT`, `SERVICES_ROOT`, `REPO_SERVICES_ROOT` | validation/generation roots |
| `ALLOW_BUILD_VALIDATION` | opt-in build validation |

## Dashboard

| Var | Purpose |
|---|---|
| `FACTORY_API_URL` | gateway URL |
| `DASHBOARD_SESSION_SECRET` | signed session cookies |
| `DASHBOARD_*_PASSWORD_HASH` | login credentials |
| `DASHBOARD_*_ROLE` | owner/operator/viewer role mapping |

## Future Env Direction

- Move user auth to OIDC/OAuth2/JWT and persistent per-user RBAC.
- Add tenant, organization, and public-service identity provider configuration.
- Add connector consent and permission scopes per tenant/user.
- Add Redis URL when distributed rate limits/safe mode/session invalidation are implemented.
- Add NATS/Redis Streams URL if event bus becomes multi-instance.
- Add connector-specific env only after read-only connector contracts are documented.
