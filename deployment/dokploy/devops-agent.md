# Dokploy: devops-agent

| Setting | Value |
|---|---|
| App name | devops-agent |
| Domain | devops.simorx.com |
| Port | 4105 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` |
| Build Type | **Dockerfile** |
| Docker File | `Dockerfile` |
| Docker Context Path | `.` |
| Docker Build Stage | `runtime` |
| Build-time Argument | `SERVICE_ID=devops-agent` |
| Health check | /health |

## Environment
Use `deployment/env/devops-agent.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://devops.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
