# Dokploy: memory-agent

| Setting | Value |
|---|---|
| App name | memory-agent |
| Domain | memory.simorx.com |
| Port | 4109 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/memory-agent |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/memory-agent... run build` |
| Start command | `pnpm --filter @factory/memory-agent run start` |
| Health check | /health |

## Environment
Use `deployment/env/memory-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://memory.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
