# Dokploy — internet-research-service

Independent Dokploy application (no Docker locally; Dokploy builds from GitHub).

| Setting | Value |
|---|---|
| App name | internet-research-service |
| Domain | https://research.simorx.com |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/internet-research-service |
| Build command | pnpm install --frozen-lockfile && pnpm --filter @factory/internet-research-service... build |
| Start command | node services/internet-research-service/dist/index.js |
| Health check | /health |
| Internal port | 4115 |

## Required env
```
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=<shared internal token>
MONGODB_URI=<atlas uri>
MONGODB_DB_NAME=autonomous_os_kernel
SERVICE_ID=internet-research-service
SERVICE_NAME=internet-research-service
SERVICE_PORT=4115
SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com
# Optional — enables real LLM reasoning (else deterministic fallback):
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic
LLM_ALLOWED_PROVIDERS=anthropic,openai
LLM_MAX_COST_PER_TASK_USD=0.5
LLM_MAX_TOKENS_PER_TASK=120000
LLM_DAILY_COST_LIMIT_USD=20
LLM_SAFE_MODE_FALLBACK=true
```

## Validate after deploy
`GET /health` ok → appears in registry → `/.factory/manifest` requires the internal token (must NOT be public).
