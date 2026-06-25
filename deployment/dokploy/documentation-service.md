# Dokploy: documentation-service

| Setting | Value |
|---|---|
| App name | documentation-service |
| Domain | docs.simorx.com |
| Port | 4110 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/documentation-service |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/documentation-service... run build` |
| Start command | `pnpm --filter @factory/documentation-service run start` |
| Health check | /health |

## Environment
Use `deployment/env/documentation-service.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://docs.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
