# Dokploy: file-asset-service

| Setting | Value |
|---|---|
| App name | file-asset-service |
| Domain | assets.simorx.com |
| Port | 4112 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` (monorepo root) |
| Build Type | **Dockerfile** (not Nixpacks) |
| Docker File | `Dockerfile.file-asset-service` |
| Docker stage | `runtime` (if requested) |
| Health check | /health |

## Environment
Use the service's `.env.example`. `SERVICE_ID=file-asset-service` is already
baked into the image; keep the same value in the runtime environment.

## Validation after deploy
1. `https://assets.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
