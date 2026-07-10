# راهنمای اجرا — لوکال و Dokploy

پروژه: **Autonomous OS Kernel** · دامنه: `simorx.com`

---

## بخش ۱ — لوکال

### نصب (یک‌بار)

```bash
corepack enable
pnpm install
cp .env.example .env       # مقادیر واقعی را پر کن
```

### اجرا (هر بار)

```bash
pnpm dev:all
```

`dev:all` خودکار این کارها را انجام می‌دهد:

1. `sync:env` — کپی `.env` روت به ۱۵ سرویس + پورت و URL لوکال
2. `build:deps` — build کردن `shared` و `service-kit`
3. اجرای همزمان همه سرویس‌ها (ترتیب = ترتیب بخش ۲)

فقط env را عوض کردی؟ `pnpm sync:env` کافی است.

### آدرس‌های لوکال

| # | سرویس | پورت |
|---|---|---:|
| 1 | service-registry | 4108 |
| 2 | event-bus-service | 4111 |
| 3 | gateway-api | 4101 |
| 4 | orchestrator-agent | 4102 |
| 5 | architect-agent | 4103 |
| 6 | builder-agent | 4104 |
| 7 | devops-agent | 4105 |
| 8 | memory-agent | 4109 |
| 9 | documentation-service | 4110 |
| 10 | internet-research-service | 4115 |
| 11 | file-asset-service | 4112 |
| 12 | monitor-agent | 4113 |
| 13 | browser-testing-agent | 4116 |
| 14 | code-operator-agent | 4122 |
| 15 | dashboard-web | **4100** ← داشبورد |

- داشبورد: http://localhost:4100
- API: http://localhost:4101

### تست سلامت (لوکال)

```bash
curl http://localhost:4108/health   # registry
curl http://localhost:4101/health   # gateway
curl http://localhost:4101/v1/services
```

### خطاهای رایج

| خطا | راه‌حل |
|---|---|
| `service-kit/dist/index.js` | `pnpm run build:deps` |
| `Missing root .env` | `cp .env.example .env` و مقادیر را پر کن |
| یک سرویس crash کرد | بقیه بالا می‌مانند؛ لاگ همان سرویس را ببین |

---

## بخش ۲ — Dokploy (عمومی)

هر سرویس = **یک Application جدا** در Dokploy.

| تنظیم | مقدار (همه سرویس‌ها) |
|---|---|
| Repository | monorepo روی GitHub |
| Build context | روت repo |
| Health check | `/health` |

`FACTORY_INTERNAL_TOKEN` در **همه** سرویس‌ها باید **یکسان** باشد.

**ترتیب deploy:** از شماره ۱ شروع کن، به ترتیب برو جلو. (همان ترتیب `pnpm dev:all` در لوکال)

---

## ۱. service-registry

**کار:** ثبت و کشف سرویس‌ها — همه سرویس‌ها اینجا خودشان را معرفی می‌کنند.

| دامنه | پورت |
|---|---|
| registry.simorx.com | 4108 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/service-registry` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/service-registry... run build` |
| Start | `pnpm --filter @factory/service-registry run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=service-registry
SERVICE_NAME=Service Registry
SERVICE_DOMAIN=https://registry.simorx.com
SERVICE_PORT=4108

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel
LOG_LEVEL=info
```

**تست:** `curl https://registry.simorx.com/health`

---

## ۲. event-bus-service

**کار:** پخش رویدادهای real-time (SSE) — داشبورد و سرویس‌ها از اینجا live update می‌گیرند.

| دامنه | پورت |
|---|---|
| events.simorx.com | 4111 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/event-bus-service` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/event-bus-service... run build` |
| Start | `pnpm --filter @factory/event-bus-service run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=event-bus-service
SERVICE_NAME=Event Bus Service
SERVICE_DOMAIN=https://events.simorx.com
SERVICE_PORT=4111

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel
LOG_LEVEL=info
```

**تست:** `curl https://events.simorx.com/health`

---

## ۳. gateway-api

**کار:** دروازه HTTP — API عمومی، پروکسی به orchestrator، احراز هویت admin.

| دامنه | پورت |
|---|---|
| api.simorx.com | 4101 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/gateway-api` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/gateway-api... run build` |
| Start | `pnpm --filter @factory/gateway-api run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

# K1 Real Auth (D-164/D-165) — واقعی، DB-backed کاربر و session.
# FACTORY_OWNER_PASSWORD_HASH را با «node scripts/hash-password.mjs '<password>'»
# بساز؛ اگر خالی بماند، owner هیچ credential واقعی نمی‌گیرد (هرگز پسورد ساختگی
# چاپ نمی‌شود). این hash باید دقیقاً همان مقداری باشد که در DASHBOARD_ADMIN_
# PASSWORD_HASH هم استفاده می‌شود تا bridge دو سیستم فعال شود — یک hash، دو env var.
# جزئیات کامل: docs/security-and-permissions.md بخش «K1 Real Auth».
FACTORY_ALLOW_LEGACY_ROLE_AUTH=true
FACTORY_OWNER_EMAIL=
FACTORY_OWNER_PASSWORD_HASH=

SERVICE_ID=gateway-api
SERVICE_NAME=Gateway API
SERVICE_DOMAIN=https://api.simorx.com
SERVICE_PORT=4101

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com
ORCHESTRATOR_AGENT_URL=https://orchestrator.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel
LOG_LEVEL=info
```

**تست:** `curl https://api.simorx.com/health`

**پس از دیپلوی، owner/operator/viewer را provision کن (D-165):**

```bash
FACTORY_API_URL=https://api.simorx.com FACTORY_ADMIN_TOKEN=<token> \
  node scripts/provision-gateway-user.mjs --email operator@company.com \
  --password-hash "$(node scripts/hash-password.mjs '<password>')" --role operator
```

کامل: `docs/security-and-permissions.md` بخش «K1 Real Auth» و «Provisioning».

---

## ۴. orchestrator-agent

**کار:** مغز مرکزی — دریافت task، برنامه‌ریزی، هماهنگی بین agentها.

| دامنه | پورت |
|---|---|
| orchestrator.simorx.com | 4102 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/orchestrator-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/orchestrator-agent... run build` |
| Start | `pnpm --filter @factory/orchestrator-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=orchestrator-agent
SERVICE_NAME=Orchestrator Agent
SERVICE_DOMAIN=https://orchestrator.simorx.com
SERVICE_PORT=4102

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

ARCHITECT_AGENT_URL=https://architect.simorx.com
BUILDER_AGENT_URL=https://builder.simorx.com
DEVOPS_AGENT_URL=https://devops.simorx.com
MEMORY_AGENT_URL=https://memory.simorx.com
DOCUMENTATION_SERVICE_URL=https://docs.simorx.com
MONITOR_AGENT_URL=https://monitor.simorx.com
BROWSER_TESTING_AGENT_URL=https://browser-testing.simorx.com
FILE_ASSET_SERVICE_URL=https://assets.simorx.com

LOG_LEVEL=info
```

**تست:** `curl https://orchestrator.simorx.com/health`

---

## ۵. architect-agent

**کار:** طراحی معماری و طرح فنی قبل از build.

| دامنه | پورت |
|---|---|
| architect.simorx.com | 4103 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/architect-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/architect-agent... run build` |
| Start | `pnpm --filter @factory/architect-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=architect-agent
SERVICE_NAME=Architect Agent
SERVICE_DOMAIN=https://architect.simorx.com
SERVICE_PORT=4103

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

LOG_LEVEL=info
```

**تست:** `curl https://architect.simorx.com/health`

---

## ۶. builder-agent

**کار:** تولید و ویرایش کد.

| دامنه | پورت |
|---|---|
| builder.simorx.com | 4104 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/builder-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/builder-agent... run build` |
| Start | `pnpm --filter @factory/builder-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=builder-agent
SERVICE_NAME=Builder Agent
SERVICE_DOMAIN=https://builder.simorx.com
SERVICE_PORT=4104

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

LOG_LEVEL=info
```

**تست:** `curl https://builder.simorx.com/health`

---

## ۷. devops-agent

**کار:** deploy، CI/CD، عملیات GitHub و Dokploy.

| دامنه | پورت |
|---|---|
| devops.simorx.com | 4105 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/devops-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/devops-agent... run build` |
| Start | `pnpm --filter @factory/devops-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=devops-agent
SERVICE_NAME=DevOps Agent
SERVICE_DOMAIN=https://devops.simorx.com
SERVICE_PORT=4105

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_DEFAULT_BRANCH=main
DOKPLOY_BASE_URL=
DOKPLOY_API_TOKEN=

LOG_LEVEL=info
```

**تست:** `curl https://devops.simorx.com/health`

---

## ۸. memory-agent

**کار:** حافظه بلندمدت و نگهداری context بین taskها.

| دامنه | پورت |
|---|---|
| memory.simorx.com | 4109 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/memory-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/memory-agent... run build` |
| Start | `pnpm --filter @factory/memory-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=memory-agent
SERVICE_NAME=Memory Agent
SERVICE_DOMAIN=https://memory.simorx.com
SERVICE_PORT=4109

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

LOG_LEVEL=info
```

**تست:** `curl https://memory.simorx.com/health`

---

## ۹. documentation-service

**کار:** مستندسازی خودکار خروجی‌ها و تصمیم‌ها.

| دامنه | پورت |
|---|---|
| docs.simorx.com | 4110 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/documentation-service` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/documentation-service... run build` |
| Start | `pnpm --filter @factory/documentation-service run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=documentation-service
SERVICE_NAME=Documentation Service
SERVICE_DOMAIN=https://docs.simorx.com
SERVICE_PORT=4110

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel
LOG_LEVEL=info
```

**تست:** `curl https://docs.simorx.com/health`

---

## ۱۰. internet-research-service

**کار:** تحقیق زنده روی اینترنت برای Jarvis/operator — جستجوی واقعی وب (Tavily) وقتی
`TAVILY_API_KEY` روی همین سرویس تنظیم شده باشد؛ در غیر این صورت با `sourceMode: llm_only`
یا `curated_fallback` صادقانه اعلام می‌کند که نتیجه از جستجوی زنده نیست.

| دامنه | پورت |
|---|---:|
| research.simorx.com | 4115 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/internet-research-service` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/internet-research-service... run build` |
| Start | `pnpm --filter @factory/internet-research-service run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=internet-research-service
SERVICE_NAME=Internet Research Service
SERVICE_DOMAIN=https://research.simorx.com
SERVICE_PORT=4115

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

# بدون این کلید هم کار می‌کند (LLM recall/curated fallback صادقانه)، اما جستجوی
# واقعی وب فقط وقتی روشن است که این کلید روی همین سرویس (نه gateway-api) ست شده باشد.
# بعد از تنظیم/تغییر این کلید، سرویس باید ری‌استارت شود.
TAVILY_API_KEY=

OPENAI_API_KEY=
ANTHROPIC_API_KEY=

LOG_LEVEL=info
```

**تست:** `curl https://research.simorx.com/health`

**نکتهٔ مهم لوکال:** این سرویس باید در `scripts/local-services.mjs` باشد تا هم `pnpm dev:all`
واقعاً آن را اجرا کند و هم `pnpm sync:env` برایش `.env` بسازد — وگرنه gateway-api هنگام
تلاش برای تحقیق زنده با خطای `service_unreachable`/`fetch failed` مواجه می‌شود، نه به این
دلیل که مسیر کد اشتباه است، بلکه چون هیچ پردازه‌ای روی پورت 4115 گوش نمی‌دهد.

---

## ۱۱. file-asset-service

**کار:** آپلود و مدیریت فایل/asset روی S3.

| دامنه | پورت |
|---|---|
| assets.simorx.com | 4112 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/file-asset-service` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/file-asset-service... run build` |
| Start | `pnpm --filter @factory/file-asset-service run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=file-asset-service
SERVICE_NAME=File Asset Service
SERVICE_DOMAIN=https://assets.simorx.com
SERVICE_PORT=4112

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=

LOG_LEVEL=info
```

**تست:** `curl https://assets.simorx.com/health`

---

## ۱۲. monitor-agent

**کار:** health scan دوره‌ای، ثبت incident، ساخت repair task.

| دامنه | پورت |
|---|---|
| monitor.simorx.com | 4113 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/monitor-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/monitor-agent... run build` |
| Start | `pnpm --filter @factory/monitor-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=monitor-agent
SERVICE_NAME=Monitor Agent
SERVICE_DOMAIN=https://monitor.simorx.com
SERVICE_PORT=4113

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

MONITOR_INTERVAL_MS=60000

LOG_LEVEL=info
```

**تست:** `curl https://monitor.simorx.com/health`

---

## ۱۳. browser-testing-agent

**کار:** تست مرورگر/HTTP روی targetهای داخلی.

| دامنه | پورت |
|---|---|
| browser-testing.simorx.com | 4116 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/browser-testing-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/browser-testing-agent... run build` |
| Start | `pnpm --filter @factory/browser-testing-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=browser-testing-agent
SERVICE_NAME=Browser Testing Agent
SERVICE_DOMAIN=https://browser-testing.simorx.com
SERVICE_PORT=4116

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=

LOG_LEVEL=info
```

**تست:** `curl https://browser-testing.simorx.com/health`

---

## ۱۴. code-operator-agent

**کار:** جستجو/ویرایش/typecheck/build/git/PR روی workspace کد (شاخه‌های ایزوله). جزئیات کامل:
`deployment/dokploy/code-operator-agent.md` و `services/code-operator-agent/.env.example`.

| دامنه | پورت |
|---|---:|
| code.simorx.com | 4122 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/code-operator-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/code-operator-agent... run build` |
| Start | `pnpm --filter @factory/code-operator-agent run start` |

**تست:** `curl https://code.simorx.com/health`

---

## ۱۵. dashboard-web

**کار:** داشبورد Next.js — UI کنترل، مانیتورینگ، تأیید انسان.

| دامنه | پورت |
|---|---|
| factory.simorx.com | 4100 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/dashboard-web` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/dashboard-web... run build` |
| Start | `pnpm --filter @factory/dashboard-web run start` |

**Environment**

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

# session cookie signing — بدون این، در production هم به‌طور خاموش روی یک
# secret نامعتبر و توسعه‌ای fallback می‌کند. حتماً یک مقدار تصادفی قوی بگذار.
DASHBOARD_SESSION_SECRET=

# ورود owner. حتماً همان hash که به FACTORY_OWNER_PASSWORD_HASH گیت‌وی داده‌ای
# را اینجا هم بگذار (فرمت scrypt یکسان است در هر دو سرویس) — یک hash، دو env
# var — وگرنه bridge به session واقعی گیت‌وی (D-165) هرگز فعال نمی‌شود و ورود
# owner همیشه روی مسیر قدیمی x-factory-role باقی می‌ماند.
DASHBOARD_ADMIN_EMAIL=
DASHBOARD_ADMIN_PASSWORD_HASH=

# اختیاری — operator/viewer اضافه. پس از ست‌کردن این دو، باید با همان ایمیل/
# hash روی گیت‌وی هم provision شوند: scripts/provision-gateway-user.mjs.
DASHBOARD_OPERATOR_EMAIL=
DASHBOARD_OPERATOR_PASSWORD_HASH=
DASHBOARD_VIEWER_EMAIL=
DASHBOARD_VIEWER_PASSWORD_HASH=
```

**تست:** باز کردن https://factory.simorx.com

**نکته امنیتی:** در `NODE_ENV=production`، اگر `DASHBOARD_ADMIN_EMAIL`/`DASHBOARD_ADMIN_PASSWORD_HASH`
ست نشوند، هیچ‌کس نمی‌تواند وارد داشبورد شود (لاگین‌های دمو فقط در dev فعال‌اند) — این عمداً است، نه باگ.

---

## خلاصه — دامنه‌ها، health و کار هر سرویس

ترتیب deploy و health check (کپی‌پیست):

```bash
# ۱ — service-registry — ثبت و کشف سرویس‌ها
curl https://registry.simorx.com/health

# ۲ — event-bus-service — رویدادهای real-time (SSE)
curl https://events.simorx.com/health

# ۳ — gateway-api — دروازه HTTP و API عمومی
curl https://api.simorx.com/health

# ۴ — orchestrator-agent — مغز مرکزی، برنامه‌ریزی taskها
curl https://orchestrator.simorx.com/health

# ۵ — architect-agent — طراحی معماری
curl https://architect.simorx.com/health

# ۶ — builder-agent — تولید و ویرایش کد
curl https://builder.simorx.com/health

# ۷ — devops-agent — deploy و CI/CD
curl https://devops.simorx.com/health

# ۸ — memory-agent — حافظه بلندمدت
curl https://memory.simorx.com/health

# ۹ — documentation-service — مستندسازی خودکار
curl https://docs.simorx.com/health

# ۱۰ — internet-research-service — تحقیق زنده (Tavily وقتی کلید ست شده)
curl https://research.simorx.com/health

# ۱۱ — file-asset-service — فایل و asset روی S3
curl https://assets.simorx.com/health

# ۱۲ — monitor-agent — health scan و incident
curl https://monitor.simorx.com/health

# ۱۳ — browser-testing-agent — تست مرورگر/HTTP
curl https://browser-testing.simorx.com/health

# ۱۴ — code-operator-agent — عملیات روی کد (workspace ایزوله)
curl https://code.simorx.com/health

# ۱۵ — dashboard-web — داشبورد کنترل (UI)
curl https://factory.simorx.com/health
```

| # | سرویس | دامنه | پورت | کار |
|---|---|---|---:|---|
| 1 | service-registry | registry.simorx.com | 4108 | ثبت سرویس‌ها |
| 2 | event-bus-service | events.simorx.com | 4111 | رویداد live |
| 3 | gateway-api | api.simorx.com | 4101 | API عمومی |
| 4 | orchestrator-agent | orchestrator.simorx.com | 4102 | هماهنگی agentها |
| 5 | architect-agent | architect.simorx.com | 4103 | طراحی فنی |
| 6 | builder-agent | builder.simorx.com | 4104 | ساخت کد |
| 7 | devops-agent | devops.simorx.com | 4105 | deploy |
| 8 | memory-agent | memory.simorx.com | 4109 | حافظه |
| 9 | documentation-service | docs.simorx.com | 4110 | مستندات |
| 10 | internet-research-service | research.simorx.com | 4115 | تحقیق زنده |
| 11 | file-asset-service | assets.simorx.com | 4112 | فایل/S3 |
| 12 | monitor-agent | monitor.simorx.com | 4113 | مانیتورینگ |
| 13 | browser-testing-agent | browser-testing.simorx.com | 4116 | تست UI |
| 14 | code-operator-agent | code.simorx.com | 4122 | عملیات کد |
| 15 | dashboard-web | factory.simorx.com | 4100 | داشبورد |

پاسخ سالم: `{"status":"ok"}`

**بررسی کل سیستم:**
```bash
curl https://api.simorx.com/v1/services
```
باید همه ۱۵ سرویس در لیست باشند.

---

## یادآوری سریع

**لوکال**
```bash
cp .env.example .env && pnpm dev:all
# داشبورد: http://localhost:4100
```

**Dokploy**
- Build path: `/` (روت monorepo)
- `SERVICE_ID` در env هر Application
- `nixpacks.toml` در روت → build/start خودکار با pnpm
- `FACTORY_INTERNAL_TOKEN` یکسان در همه سرویس‌ها

**Phase 10** — env جدید لازم نیست؛ فقط redeploy: `dashboard-web`، `gateway-api`، `orchestrator-agent`

