# Dokploy: gateway-api

| Setting | Value |
|---|---|
| App name | gateway-api |
| Domain | api.simorx.com |
| Port | 4101 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/gateway-api |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/gateway-api... run build` |
| Start command | `pnpm --filter @factory/gateway-api run start` |
| Health check | /health |

## Environment
Use `deployment/env/gateway-api.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://api.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
