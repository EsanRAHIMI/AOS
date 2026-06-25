# Dokploy: dashboard-web

| Setting | Value |
|---|---|
| App name | dashboard-web |
| Domain | factory.simorx.com |
| Port | 4100 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/dashboard-web |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/dashboard-web... run build` |
| Start command | `pnpm --filter @factory/dashboard-web run start` |
| Health check | /health |

## Environment
Use `deployment/env/dashboard-web.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://factory.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
