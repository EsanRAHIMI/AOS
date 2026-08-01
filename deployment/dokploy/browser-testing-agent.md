# Dokploy: browser-testing-agent

| Setting | Value |
|---|---|
| App name | browser-testing-agent |
| Domain | browser-testing.simorx.com |
| Port | 4116 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` (monorepo root) |
| Build Type | **Dockerfile** (not Nixpacks) |
| Docker File | `Dockerfile.browser-testing-agent` |
| Docker stage | `runtime` (if requested) |
| Health check | /health |

## Notes
- The image installs the lockfile-compatible Chromium build and its required
  system libraries. Normal source changes reuse this Docker layer.
- Optional S3 env (AWS_*) enables screenshot capture; absent ⇒ no-screenshot.
- Only internal/owned targets are allowed by default.

## Env
MONGODB_URI, MONGODB_DB_NAME, FACTORY_INTERNAL_TOKEN, SERVICE_* identity,
SERVICE_REGISTRY_URL, EVENT_BUS_URL, (optional) AWS_ACCESS_KEY_ID,
AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET, LOG_LEVEL.
