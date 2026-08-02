# Dokploy: orchestrator-agent

| Setting | Value |
|---|---|
| App name | orchestrator-agent |
| Domain | orchestrator.simorx.com |
| Port | 4102 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` |
| Build Type | **Dockerfile** |
| Docker File | `Dockerfile` |
| Docker Context Path | `.` |
| Docker Build Stage | `runtime` |
| Build-time Argument | `SERVICE_ID=orchestrator-agent` |
| Health check | /health |

## Environment
Use `deployment/env/orchestrator-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://orchestrator.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
