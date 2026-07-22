# Dokploy: dashboard-web

| Setting | Value |
|---|---|
| App name | dashboard-web |
| Domain | factory.simorx.com |
| Port | 4100 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` (monorepo root — الزامی) |
| Build Type | **Dockerfile** (نه Nixpacks) |
| Dockerfile path | `Dockerfile` |
| Docker stage | `runtime` (اگر Dokploy پرسید) |
| Health check | `/` یا `/login` |

## Environment (حداقل)

```env
NODE_ENV=production
FACTORY_ENV=production
SERVICE_ID=dashboard-web
SERVICE_NAME=Dashboard Web
SERVICE_PORT=4100
FACTORY_API_URL=https://api.simorx.com
FACTORY_ADMIN_TOKEN=
EVENT_BUS_URL=https://events.simorx.com
FACTORY_INTERNAL_TOKEN=
DASHBOARD_SESSION_SECRET=
DASHBOARD_ADMIN_EMAIL=
DASHBOARD_ADMIN_PASSWORD_HASH=
```

`SERVICE_ID=dashboard-web` هم برای **build** و هم برای **runtime** لازم است
(Docker build-arg از همین env خوانده می‌شود).

## چرا Dockerfile؟

Nixpacks روی cold build حدود ۸+ دقیقه فقط برای unpack کردن nixpkgs صرف می‌کند؛
بعد `next build` روی هاست کوچک اغلب timeout یا OOM می‌شود. ایمیج رسمی
`node:22-bookworm-slim` این هزینه را حذف می‌کند.

## Validation after deploy

1. `https://factory.simorx.com/` یا `/login` لود شود.
2. Gateway از داشبورد در دسترس باشد (`FACTORY_API_URL`).
3. Redeploy قبلی برای rollback.
