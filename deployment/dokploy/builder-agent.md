# Dokploy: builder-agent

| Setting | Value |
|---|---|
| App name | builder-agent |
| Domain | builder.simorx.com |
| Port | 4104 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` |
| Build Type | **Dockerfile** |
| Docker File | `Dockerfile.builder-agent` |
| Docker Context Path | `.` |
| Docker Build Stage | `runtime` |
| Health check | /health |

## Environment
Use the service's `.env.example`. No Build-time Argument is required.

## Validation after deploy
1. `https://builder.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
