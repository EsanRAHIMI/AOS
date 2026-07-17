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

1. `sync:env` — کپی `.env` روت به ۱۹ سرویس production + پورت و URL لوکال
2. `build:deps` — build کردن `shared` و `service-kit`
3. اجرای همزمان همه سرویس‌ها (ترتیب = ترتیب بخش ۲)

منبع ترتیب/پورت: `scripts/local-services.mjs` (باید با این فایل هم‌خوان بماند).
نقشهٔ کامل: `docs/service-map.md`.

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
| 8 | reviewer-agent | 4106 |
| 9 | qa-agent | 4107 |
| 10 | memory-agent | 4109 |
| 11 | documentation-service | 4110 |
| 12 | internet-research-service | 4115 |
| 13 | file-asset-service | 4112 |
| 14 | monitor-agent | 4113 |
| 15 | report-agent | 4114 |
| 16 | browser-testing-agent | 4116 |
| 17 | voice-operator-agent | 4121 |
| 18 | code-operator-agent | 4122 |
| 19 | dashboard-web | **4100** ← داشبورد |

`aos-agent-runtime` کاندید consolidation است و در `dev:all` نیست — بخش ۲۰.

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
| Build context | **روت repo** (نه `services/<id>`) — `pnpm --filter` به workspace نیاز دارد |
| Root directory | در جداول زیر: `services/<id>` (هویت Application) |
| Health check | `/health` برای backendها؛ برای `dashboard-web` صفحهٔ `/` یا `/login` (مسیر `/health` UI است، JSON liveness نیست) |

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

# K1 Redis Backbone (D-167) — اختیاری. خالی = fan-out فقط داخل همین یک process
# (رفتار Phase 1، بدون تغییر). وقتی بیش از یک instance از event-bus-service پشت
# یک load balancer اجرا می‌شود، REDIS_URL را ست کن تا رویدادها بین همه‌ی
# instanceها sync شوند (Redis pub/sub) — بدون آن، کلاینتی که به instance B وصل
# است رویدادی را که به instance A رسیده هرگز نمی‌بیند. جزئیات:
# docs/service-communication-protocol.md بخش «Event Fan-Out».
REDIS_URL=
REDIS_KEY_PREFIX=factory:
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
# اختیاری — پین مستقیم به research (لوکال در sync:env ست می‌شود؛ در production
# معمولاً از registry resolve می‌شود).
# INTERNET_RESEARCH_SERVICE_URL=https://research.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

# kill-switch اولیه؛ مقدار زنده در system_settings از داشبورد هم قابل تغییر است.
AUTONOMY_SAFE_MODE=false

# اختیاری — اجرای عملیات تأییدشده از طریق Dokploy API (Phase 16)
DOKPLOY_BASE_URL=
DOKPLOY_API_TOKEN=
DOKPLOY_PROJECT_ID=
DOKPLOY_ENVIRONMENT_ID=

LOG_LEVEL=info

# K1 Redis Backbone (D-167) — اختیاری. خالی = rate limit فقط داخل همین یک
# process (رفتار قدیمی، بدون تغییر — هر instance شمارنده‌ی جدا دارد). با بیش
# از یک instance از gateway-api پشت یک load balancer، REDIS_URL را ست کن تا
# محدودیت نرخ بین همه‌ی instanceها مشترک شود؛ باید دقیقاً همان مقدار
# REDIS_URL سرویس event-bus-service باشد (یک Redis مشترک برای کل backbone).
REDIS_URL=
REDIS_KEY_PREFIX=factory:

# K1 BullMQ (D-173/D-174) — فقط وقتی REDIS_URL ست باشد اثر دارد.
# AGENT_DISPATCH_MODE=http (پیش‌فرض) = همه dispatchها HTTP، بدون تغییر.
AGENT_QUEUE_MAX_ATTEMPTS=3
AGENT_QUEUE_BACKOFF_MS=2000
AGENT_QUEUE_CONCURRENCY=4
AGENT_QUEUE_TIMEOUT_MS=30000
AGENT_DISPATCH_MODE=http
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
REVIEWER_AGENT_URL=https://reviewer.simorx.com
QA_AGENT_URL=https://qa.simorx.com
MEMORY_AGENT_URL=https://memory.simorx.com
DOCUMENTATION_SERVICE_URL=https://docs.simorx.com
INTERNET_RESEARCH_SERVICE_URL=https://research.simorx.com
MONITOR_AGENT_URL=https://monitor.simorx.com
REPORT_AGENT_URL=https://reports.simorx.com
BROWSER_TESTING_AGENT_URL=https://browser-testing.simorx.com
FILE_ASSET_SERVICE_URL=https://assets.simorx.com

# K1 BullMQ (D-173/D-174) — اختیاری. خالی REDIS_URL = فقط HTTP.
REDIS_URL=
AGENT_QUEUE_MAX_ATTEMPTS=3
AGENT_QUEUE_BACKOFF_MS=2000
AGENT_QUEUE_CONCURRENCY=4
AGENT_QUEUE_TIMEOUT_MS=30000
AGENT_DISPATCH_MODE=http

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

## ۸. reviewer-agent

**کار:** بررسی مستقل کد/معماری/امنیت — قبل از QA در pipeline.

| دامنه | پورت |
|---|---|
| reviewer.simorx.com | 4106 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/reviewer-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/reviewer-agent... run build` |
| Start | `pnpm --filter @factory/reviewer-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=reviewer-agent
SERVICE_NAME=Reviewer Agent
SERVICE_DOMAIN=https://reviewer.simorx.com
SERVICE_PORT=4106

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic
LLM_ALLOWED_PROVIDERS=anthropic,openai
LLM_MAX_COST_PER_TASK_USD=0.5
LLM_MAX_TOKENS_PER_TASK=120000
LLM_DAILY_COST_LIMIT_USD=20
LLM_SAFE_MODE_FALLBACK=true

LOG_LEVEL=info
```

**تست:** `curl https://reviewer.simorx.com/health`

---

## ۹. qa-agent

**کار:** تأیید پذیرش در برابر goal و evidence.

| دامنه | پورت |
|---|---|
| qa.simorx.com | 4107 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/qa-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/qa-agent... run build` |
| Start | `pnpm --filter @factory/qa-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=qa-agent
SERVICE_NAME=QA Agent
SERVICE_DOMAIN=https://qa.simorx.com
SERVICE_PORT=4107

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic
LLM_ALLOWED_PROVIDERS=anthropic,openai
LLM_MAX_COST_PER_TASK_USD=0.5
LLM_MAX_TOKENS_PER_TASK=120000
LLM_DAILY_COST_LIMIT_USD=20
LLM_SAFE_MODE_FALLBACK=true

LOG_LEVEL=info
```

**تست:** `curl https://qa.simorx.com/health`

---

## ۱۰. memory-agent

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

## ۱۱. documentation-service

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

## ۱۲. internet-research-service

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
LLM_DEFAULT_PROVIDER=anthropic
LLM_ALLOWED_PROVIDERS=anthropic,openai
LLM_MAX_COST_PER_TASK_USD=0.5
LLM_MAX_TOKENS_PER_TASK=120000
LLM_DAILY_COST_LIMIT_USD=20
LLM_SAFE_MODE_FALLBACK=true

LOG_LEVEL=info
```

**تست:** `curl https://research.simorx.com/health`

**نکتهٔ مهم لوکال:** این سرویس باید در `scripts/local-services.mjs` باشد تا هم `pnpm dev:all`
واقعاً آن را اجرا کند و هم `pnpm sync:env` برایش `.env` بسازد — وگرنه gateway-api هنگام
تلاش برای تحقیق زنده با خطای `service_unreachable`/`fetch failed` مواجه می‌شود، نه به این
دلیل که مسیر کد اشتباه است، بلکه چون هیچ پردازه‌ای روی پورت 4115 گوش نمی‌دهد.

---

## ۱۳. file-asset-service

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

## ۱۴. monitor-agent

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

## ۱۵. report-agent

**کار:** گزارش‌های اجرایی/هوش سیستم (executive / intelligence reports).

| دامنه | پورت |
|---|---|
| reports.simorx.com | 4114 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/report-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/report-agent... run build` |
| Start | `pnpm --filter @factory/report-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=report-agent
SERVICE_NAME=Report Agent
SERVICE_DOMAIN=https://reports.simorx.com
SERVICE_PORT=4114

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic
LLM_ALLOWED_PROVIDERS=anthropic,openai
LLM_MAX_COST_PER_TASK_USD=0.5
LLM_MAX_TOKENS_PER_TASK=120000
LLM_DAILY_COST_LIMIT_USD=20
LLM_SAFE_MODE_FALLBACK=true

LOG_LEVEL=info
```

**تست:** `curl https://reports.simorx.com/health`

---

## ۱۶. browser-testing-agent

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

## ۱۷. voice-operator-agent

**کار:** orchestration نشست صدا (realtime) — خودش مستقیم mutate نمی‌کند؛ از طریق gateway.

| دامنه | پورت |
|---|---|
| voice.simorx.com | 4121 |

**Dokploy**

| فیلد | مقدار |
|---|---|
| Root directory | `services/voice-operator-agent` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/voice-operator-agent... run build` |
| Start | `pnpm --filter @factory/voice-operator-agent run start` |

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=voice-operator-agent
SERVICE_NAME=Voice Operator Agent
SERVICE_DOMAIN=https://voice.simorx.com
SERVICE_PORT=4121

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

# اختیاری — بدون این‌ها dock روی text + browser voice می‌ماند
VOICE_PROVIDER=openai
VOICE_MODEL=gpt-realtime
VOICE_NAME=alloy
VOICE_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
VOICE_SESSION_SECRET=
VOICE_SESSION_MAX_SECONDS=600
VOICE_REQUIRE_PUSH_TO_TALK=true

LOG_LEVEL=info
```

**تست:** `curl https://voice.simorx.com/health`

جزئیات بیشتر: `deployment/dokploy/voice-operator-agent.md`

---

## ۱۸. code-operator-agent

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

**Volume:** یک volume پایدار روی `/workspace` mount کن و یک‌بار repo را clone کن
(`git clone … /workspace/autonomous-os-kernel`). Agent فقط داخل همین checkout، روی شاخهٔ ایزوله کار می‌کند — هرگز روی دایرکتوری live production.

**Environment**

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=code-operator-agent
SERVICE_NAME=Code Operator Agent
SERVICE_DOMAIN=https://code.simorx.com
SERVICE_PORT=4122

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

# الزامی برای ابزارهای کد — بدون آن همهٔ code tools با not_configured جواب می‌دهند.
CODE_WORKSPACE_ROOT=/workspace/autonomous-os-kernel

# اختیاری — commit/push/PR
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=autonomous-os-kernel
GITHUB_DEFAULT_BRANCH=main

# حدود workspace (Phase Y)
WORKSPACE_MAX_ITERATIONS=10
WORKSPACE_MAX_MINUTES=45
WORKSPACE_MAX_FILES_CHANGED=80
WORKSPACE_REQUIRE_APPROVAL_BEFORE_MIGRATION=true
WORKSPACE_ALLOW_AUTOFIX=true
WORKSPACE_ALLOW_NEW_SERVICE=true
WORKSPACE_ALLOW_EXISTING_SERVICE_EVOLUTION=true

LOG_LEVEL=info
```

**تست:** `curl https://code.simorx.com/health`

---

## ۱۹. dashboard-web

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

## ۲۰. aos-agent-runtime (کاندید consolidation — هنوز production نیست)

**وضعیت:** `BLOCKED_ON_MANUAL_DEPLOYMENT` (D-168/D-169/D-172). این یک Application جدا در Dokploy
نیست که امروز ترافیک بگیرد؛ کاندید جایگزینی چند agent مستقل است.

**جایگزین می‌کند (فقط بعد از cutover تأییدشده):**

| Worker | serviceId | دامنه | پورت |
|---|---|---|---:|
| Architect | `architect-agent` | architect.simorx.com | 4103 |
| Reviewer | `reviewer-agent` | reviewer.simorx.com | 4106 |
| QA | `qa-agent` | qa.simorx.com | 4107 |
| Report | `report-agent` | reports.simorx.com | 4114 |

Batch 2A (کد، بدون cutover spec): Memory، Documentation، Internet Research.

**مهم:** تا قبل از cutover، همان ۱۹ سرویس بالا (شماره ۱–۱۹) را جداگانه deploy کن.
`aos-agent-runtime` را در `pnpm dev:all` هم اضافه نکن — با `architect-agent` روی پورت
4103 تداخل دارد (`EADDRINUSE`).

**Dokploy** (فقط وقتی آمادهٔ cutover هستی)

| فیلد | مقدار |
|---|---|
| Root directory | `services/aos-agent-runtime` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/aos-agent-runtime... run build` |
| Start | `pnpm --filter @factory/aos-agent-runtime run start` |
| Ports | **هر چهار پورت** 4103, 4106, 4107, 4114 از یک container |
| Health | `/health` روی یکی از همین پورت‌ها (مثلاً 4103) |

**Environment** (اتحاد env سرویس‌های worker — secret جدید لازم نیست):

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=
FACTORY_ADMIN_TOKEN=

SERVICE_ID=aos-agent-runtime
SERVICE_NAME=AOS Agent Runtime
SERVICE_PORT=4199

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

# Batch 2A — فقط اگر worker تحقیق داخل همین process روشن باشد
TAVILY_API_KEY=

# اختیاری — صف BullMQ برای workerها (D-173)
REDIS_URL=
REDIS_KEY_PREFIX=factory:
AGENT_QUEUE_MAX_ATTEMPTS=3
AGENT_QUEUE_BACKOFF_MS=2000
AGENT_QUEUE_CONCURRENCY=4
AGENT_QUEUE_TIMEOUT_MS=30000

LOG_LEVEL=info
```

**لوکال (آزمایشی):** اول `architect-agent` / `reviewer-agent` / `qa-agent` / `report-agent`
را متوقف کن، env را از `services/aos-agent-runtime/.env.example` بساز (این سرویس در
`pnpm sync:env` / `dev:all` نیست)، بعد:

```bash
cd services/aos-agent-runtime && pnpm dev
```

**Cutover / verify / rollback:** `deployment/dokploy/aos-agent-runtime.md` و
`scripts/aos-agent-runtime-cutover-verify.mjs`

---

## خلاصه — دامنه‌ها، health و کار هر سرویس

ترتیب deploy و health check (کپی‌پیست) — ۱۹ سرویس production:

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

# ۸ — reviewer-agent — review مستقل
curl https://reviewer.simorx.com/health

# ۹ — qa-agent — پذیرش و evidence
curl https://qa.simorx.com/health

# ۱۰ — memory-agent — حافظه بلندمدت
curl https://memory.simorx.com/health

# ۱۱ — documentation-service — مستندسازی خودکار
curl https://docs.simorx.com/health

# ۱۲ — internet-research-service — تحقیق زنده (Tavily وقتی کلید ست شده)
curl https://research.simorx.com/health

# ۱۳ — file-asset-service — فایل و asset روی S3
curl https://assets.simorx.com/health

# ۱۴ — monitor-agent — health scan و incident
curl https://monitor.simorx.com/health

# ۱۵ — report-agent — گزارش اجرایی/هوش
curl https://reports.simorx.com/health

# ۱۶ — browser-testing-agent — تست مرورگر/HTTP
curl https://browser-testing.simorx.com/health

# ۱۷ — voice-operator-agent — نشست صدا
curl https://voice.simorx.com/health

# ۱۸ — code-operator-agent — عملیات روی کد (workspace ایزوله)
curl https://code.simorx.com/health

# ۱۹ — dashboard-web — داشبورد کنترل (UI)
# مسیر /health در dashboard صفحهٔ UI است، نه JSON liveness — صفحهٔ اصلی را باز کن:
# https://factory.simorx.com   یا   https://factory.simorx.com/login
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
| 8 | reviewer-agent | reviewer.simorx.com | 4106 | review |
| 9 | qa-agent | qa.simorx.com | 4107 | QA |
| 10 | memory-agent | memory.simorx.com | 4109 | حافظه |
| 11 | documentation-service | docs.simorx.com | 4110 | مستندات |
| 12 | internet-research-service | research.simorx.com | 4115 | تحقیق زنده |
| 13 | file-asset-service | assets.simorx.com | 4112 | فایل/S3 |
| 14 | monitor-agent | monitor.simorx.com | 4113 | مانیتورینگ |
| 15 | report-agent | reports.simorx.com | 4114 | گزارش |
| 16 | browser-testing-agent | browser-testing.simorx.com | 4116 | تست UI |
| 17 | voice-operator-agent | voice.simorx.com | 4121 | صدا |
| 18 | code-operator-agent | code.simorx.com | 4122 | عملیات کد |
| 19 | dashboard-web | factory.simorx.com | 4100 | داشبورد |

پاسخ سالم backendها: `{"status":"ok"}` — برای dashboard صفحهٔ لاگین/خانه کافی است.

**بررسی کل سیستم:**
```bash
curl https://api.simorx.com/v1/services
```
باید همه ۱۹ سرویس production در لیست باشند (`aos-agent-runtime` تا قبل از cutover جدا حساب نمی‌شود).

---

## یادآوری سریع

**لوکال**
```bash
cp .env.example .env && pnpm sync:env && pnpm dev:all
# داشبورد: http://localhost:4100
```

**Dokploy**
- Build path: `/` (روت monorepo)
- `SERVICE_ID` در env هر Application
- `nixpacks.toml` در روت → build/start خودکار با pnpm
- `FACTORY_INTERNAL_TOKEN` یکسان در همه سرویس‌ها
- نقشه سرویس‌ها: `docs/service-map.md`

**Phase 10** — env جدید لازم نیست؛ فقط redeploy: `dashboard-web`، `gateway-api`، `orchestrator-agent`

