# Dokploy: orchestrator-agent

| Setting | Value |
|---|---|
| App name | orchestrator-agent |
| Domain | orchestrator.simorx.com |
| Port | 4102 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/orchestrator-agent |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/orchestrator-agent... run build` |
| Start command | `pnpm --filter @factory/orchestrator-agent run start` |
| Health check | /health |

## Environment
Use `deployment/env/orchestrator-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://orchestrator.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
