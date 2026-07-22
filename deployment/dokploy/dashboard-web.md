# Dokploy: dashboard-web

| Setting | Value |
|---|---|
| App name | dashboard-web |
| Domain | factory.simorx.com |
| Port | 4100 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` (monorepo root — الزامی) |
| Build Type | **Dockerfile** (نه Nixpacks) |
| Dockerfile path | `deployment/docker/Dockerfile.dashboard-web` |
| Docker stage | `runtime` (اگر Dokploy پرسید) |
| Health check | `/` یا `/login` |

> مسیر بالا `SERVICE_ID=dashboard-web` را در خود image می‌پزد.
> Envهای Dokploy معمولاً فقط هنگام **اجرا** تزریق می‌شوند، نه هنگام build —
> برای همین Build Arg لازم نیست اگر از این Dockerfile اختصاصی استفاده کنی.

## Environment (runtime — حداقل)

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

## چرا Dockerfile؟

Nixpacks روی cold build حدود ۸+ دقیقه فقط برای unpack کردن nixpkgs صرف می‌کند؛
بعد `next build` روی هاست کوچک اغلب timeout یا OOM می‌شود.

## Validation after deploy

1. `https://factory.simorx.com/` یا `/login` لود شود.
2. Gateway از داشبورد در دسترس باشد (`FACTORY_API_URL`).
3. Redeploy قبلی برای rollback.
