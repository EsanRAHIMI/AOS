# Dokploy — report-agent

Independent Dokploy application (no Docker locally; Dokploy builds from GitHub).

| Setting | Value |
|---|---|
| App name | report-agent |
| Domain | https://reports.simorx.com |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/report-agent |
| Build command | pnpm install --frozen-lockfile && pnpm --filter @factory/report-agent... build |
| Start command | node services/report-agent/dist/index.js |
| Health check | /health |
| Internal port | 4114 |

## Required env
```
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=<shared internal token>
MONGODB_URI=<atlas uri>
MONGODB_DB_NAME=autonomous_os_kernel
SERVICE_ID=report-agent
SERVICE_NAME=report-agent
SERVICE_PORT=4114
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
