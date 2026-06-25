# Dokploy: builder-agent

| Setting | Value |
|---|---|
| App name | builder-agent |
| Domain | builder.simorx.com |
| Port | 4104 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/builder-agent |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/builder-agent... run build` |
| Start command | `pnpm --filter @factory/builder-agent run start` |
| Health check | /health |

## Environment
Use `deployment/env/builder-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://builder.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
