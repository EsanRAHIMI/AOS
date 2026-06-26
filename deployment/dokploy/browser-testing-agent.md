# Dokploy: browser-testing-agent

| Setting | Value |
|---|---|
| App name | browser-testing-agent |
| Domain | browser-testing.simorx.com |
| Port | 4116 |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/browser-testing-agent |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/browser-testing-agent... run build` |
| Start command | `pnpm --filter @factory/browser-testing-agent run start` |
| Health check | /health |

## Notes
- For real browsers, add `playwright-core` and run `npx playwright install chromium`
  in the image build (otherwise it uses the HTTP fallback).
- Optional S3 env (AWS_*) enables screenshot capture; absent ⇒ no-screenshot.
- Only internal/owned targets are allowed by default.

## Env
MONGODB_URI, MONGODB_DB_NAME, FACTORY_INTERNAL_TOKEN, SERVICE_* identity,
SERVICE_REGISTRY_URL, EVENT_BUS_URL, (optional) AWS_ACCESS_KEY_ID,
AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET, LOG_LEVEL.
