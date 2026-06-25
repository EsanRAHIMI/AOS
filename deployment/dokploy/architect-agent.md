# Dokploy: architect-agent

| Setting | Value |
|---|---|
| App name | architect-agent |
| Domain | architect.simorx.com |
| Port | 4103 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/architect-agent |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/architect-agent... run build` |
| Start command | `pnpm --filter @factory/architect-agent run start` |
| Health check | /health |

## Environment
Use `deployment/env/architect-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://architect.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
