# Dokploy: service-registry

| Setting | Value |
|---|---|
| App name | service-registry |
| Domain | registry.simorx.com |
| Port | 4108 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` |
| Build Type | **Dockerfile** |
| Docker File | `Dockerfile` |
| Docker Context Path | `.` |
| Docker Build Stage | `runtime` |
| Build-time Argument | `SERVICE_ID=service-registry` |
| Health check | /health |

## Environment
Use `deployment/env/service-registry.env.example` (or the service's `.env.example`).

## Validation after deploy
1. `https://registry.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
