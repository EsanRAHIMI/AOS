# Dokploy: gateway-api

| Setting | Value |
|---|---|
| App name | gateway-api |
| Domain | api.simorx.com |
| Port | 4101 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` |
| Build Type | **Dockerfile** |
| Docker File | `Dockerfile` |
| Docker Context Path | `.` |
| Docker Build Stage | `runtime` |
| Build-time Argument | `SERVICE_ID=gateway-api` |
| Health check | /health |

## Environment
Use `deployment/env/gateway-api.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://api.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
