# Dokploy: devops-agent

| Setting | Value |
|---|---|
| App name | devops-agent |
| Domain | devops.simorx.com |
| Port | 4105 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/devops-agent |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/devops-agent... run build` |
| Start command | `pnpm --filter @factory/devops-agent run start` |
| Health check | /health |

## Environment
Use `deployment/env/devops-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://devops.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
