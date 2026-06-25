# Dokploy: service-registry

| Setting | Value |
|---|---|
| App name | service-registry |
| Domain | registry.simorx.com |
| Port | 4108 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/service-registry |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/service-registry... run build` |
| Start command | `pnpm --filter @factory/service-registry run start` |
| Health check | /health |

## Environment
Use `deployment/env/service-registry.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://registry.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
