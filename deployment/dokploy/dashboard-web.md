# Dokploy: dashboard-web

| Setting | Value |
|---|---|
| App name | dashboard-web |
| Domain | `factory.simorx.com` (control room) **and** `simorx.com` + `www.simorx.com` (Jarvis home) |
| Port | 4100 |
| Repository | github.com/EsanRAHIMI/AOS |
| Root directory | `/` (monorepo root — الزامی) |
| Build Type | **Dockerfile** (نه Nixpacks) |
| Docker File | `Dockerfile.dashboard-web` |
| Docker stage | `runtime` (اگر Dokploy پرسید) |
| Health check | `/` یا `/login` |

> فایل بالا `SERVICE_ID=dashboard-web` را در خود image می‌پزد.
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
# Shared login cookie across factory.* and apex Jarvis home:
DASHBOARD_COOKIE_DOMAIN=.simorx.com
# Hosts that serve Jarvis at `/` (comma-separated):
JARVIS_PUBLIC_HOSTS=simorx.com,www.simorx.com
ROOT_DOMAIN=simorx.com
```

## چرا Dockerfile؟

Nixpacks روی cold build حدود ۸+ دقیقه فقط برای unpack کردن nixpkgs صرف می‌کند؛
بعد `next build` روی هاست کوچک اغلب timeout یا OOM می‌شود.

## Validation after deploy

1. در Dokploy برای `dashboard-web` دامنهٔ دوم اضافه کنید:
   - **Service Name:** همان سرویس `dashboard-web` / compose service (حتماً انتخاب شود)
   - Host: `simorx.com` (و در صورت نیاز `www.simorx.com`)
   - Path: `/`
   - **Container Port:** همان پورتی که process داخل کانتینر listen می‌کند — در این پروژه معمولاً **`4100`** (نه 3000)
   - HTTPS: on
   - سپس **Redeploy** (فقط افزودن Domain کافی نیست؛ image باید کد middleware/apex را داشته باشد)
2. DNS: رکورد A/AAAA یا CNAME برای `@` و `www` به همان سرور Dokploy.
3. Env پیشنهادی:
   ```bash
   DASHBOARD_COOKIE_DOMAIN=.simorx.com
   JARVIS_PUBLIC_HOSTS=simorx.com,www.simorx.com
   ROOT_DOMAIN=simorx.com
   ```
4. `https://simorx.com/` بعد از لاگین باید استیج Jarvis را نشان دهد (نه Command Universe).
5. `https://factory.simorx.com/` همچنان اتاق کنترل بماند.

## Validation checklist

1. `https://factory.simorx.com/` یا `/login` لود شود.
2. Gateway از داشبورد در دسترس باشد (`FACTORY_API_URL`).
3. Redeploy قبلی برای rollback.
