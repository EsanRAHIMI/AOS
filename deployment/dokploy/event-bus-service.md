# Dokploy: event-bus-service

| Setting | Value |
|---|---|
| App name | event-bus-service |
| Domain | events.simorx.com |
| Port | 4111 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/event-bus-service |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/event-bus-service... run build` |
| Start command | `pnpm --filter @factory/event-bus-service run start` |
| Health check | /health |

## Environment
Use `deployment/env/event-bus-service.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://events.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
