# Dokploy: file-asset-service

| Setting | Value |
|---|---|
| App name | file-asset-service |
| Domain | assets.simorx.com |
| Port | 4112 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/file-asset-service |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/file-asset-service... run build` |
| Start command | `pnpm --filter @factory/file-asset-service run start` |
| Health check | /health |

## Environment
Use `deployment/env/file-asset-service.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://assets.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
