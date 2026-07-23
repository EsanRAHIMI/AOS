# Dokploy — aos-agent-runtime (K1 Consolidation Prep, D-168/D-172)

Hosts seven workers in one process on their historical ports/domains.
See `docs/deployment-plan.md` for cutover status before repointing production DNS.

## Why the last deploy failed

Dokploy was on **Nixpacks**, and Env vars are **runtime-only**. Build ran:

```text
SERVICE_ID: Missing SERVICE_ID — set it in Dokploy Environment Settings
```

Fix: switch this app to the baked Dockerfile below (same pattern as dashboard-web).

## Dokploy app settings

| Setting | Value |
|---|---|
| App name | `aos-agent-runtime` |
| Repository | `github.com/EsanRAHIMI/AOS` |
| Root directory | `/` (monorepo root — الزامی) |
| Build Type | **Dockerfile** (نه Nixpacks) |
| Dockerfile path | `deployment/docker/Dockerfile.aos-agent-runtime` |
| Docker stage | `runtime` (اگر پرسید) |
| Health check | `/health` on any worker port (e.g. 4103) |
| **Exposed ports** | **4103, 4106, 4107, 4109, 4110, 4114, 4115** — all from one container |

## Workers in this container

| Worker | serviceId | Domain | Port |
|---|---|---|---|
| Architect Agent | `architect-agent` | `architect.simorx.com` | 4103 |
| Reviewer Agent | `reviewer-agent` | `reviewer.simorx.com` | 4106 |
| QA Agent | `qa-agent` | `qa.simorx.com` | 4107 |
| Memory Agent | `memory-agent` | `memory.simorx.com` | 4109 |
| Documentation Service | `documentation-service` | `docs.simorx.com` | 4110 |
| Report Agent | `report-agent` | `reports.simorx.com` | 4114 |
| Internet Research | `internet-research-service` | `research.simorx.com` | 4115 |

## Required environment (runtime)

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

LOG_LEVEL=info
```

`SERVICE_ID` در runtime برای لاگ/هویت پردازه است؛ خودِ image موقع build از قبل
`aos-agent-runtime` را bake کرده است.

## Cutover (خلاصه)

1. Deploy این app به‌عنوان app جدید — سرویس‌های قدیمی را قطع نکن.
2. Verify با `scripts/aos-agent-runtime-cutover-verify.mjs`.
3. یک‌به‌یک دامنه را به پورت متناظر روی همین container بکش.
4. فقط بعد از سبز شدن verify، appهای قدیمی را stop کن.

جزئیات rollback در ادامهٔ همین فایل / `docs/deployment-plan.md`.
