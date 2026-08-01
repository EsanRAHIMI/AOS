# Dokploy: event-bus-service

| Setting | Value |
|---|---|
| App name | event-bus-service |
| Domain | events.simorx.com |
| Port | 4111 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` (monorepo root) |
| Build Type | **Dockerfile** (not Nixpacks) |
| Docker File | `Dockerfile.event-bus-service` |
| Docker stage | `runtime` (if requested) |
| Health check | /health |

## Environment
Use the service's `.env.example`. `SERVICE_ID=event-bus-service` is baked into
the image; keep the same value in the runtime environment.

## Validation after deploy
1. `https://events.simorx.com/health` → `{ "status": "ok" }`
2. Service appears in the registry (`GET api.simorx.com/v1/services`).
3. Internal token accepted on `/.factory/manifest`.
