# Dokploy: documentation-service

| Setting | Value |
|---|---|
| App name | documentation-service |
| Domain | docs.simorx.com |
| Port | 4110 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` |
| Build Type | **Dockerfile** |
| Docker File | `Dockerfile` |
| Docker Context Path | `.` |
| Docker Build Stage | `runtime` |
| Build-time Argument | `SERVICE_ID=documentation-service` |
| Health check | /health |

## Environment
Use `deployment/env/documentation-service.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://docs.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
