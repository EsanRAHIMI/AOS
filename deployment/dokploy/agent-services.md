# Dokploy: Agent Services (shared pattern)

orchestrator-agent, architect-agent, builder-agent, devops-agent, memory-agent
(and Phase 2: reviewer, qa, monitor, report) all deploy identically.

| Setting | Value |
|---|---|
| Root directory | services/<agent-id> |
| Build context | repo root |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/<agent-id>... run build` |
| Start command | `pnpm --filter @factory/<agent-id> run start` |
| Health check | /health |
| Domain / Port | see service-map.md |

Env (each agent): MONGODB_URI, MONGODB_DB_NAME, FACTORY_INTERNAL_TOKEN,
SERVICE_* identity, SERVICE_REGISTRY_URL, EVENT_BUS_URL, OPENAI_API_KEY,
ANTHROPIC_API_KEY, LOG_LEVEL.
