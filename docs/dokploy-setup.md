# Dokploy Setup

Dokploy is the production deployment layer. AOS never assumes uncontrolled host
access; it plans, verifies, and records deployment work through explicit targets,
diagnostics, checklists, and approvals.

## Prerequisites

- DNS for `*.simorx.com` points to the Dokploy host.
- MongoDB Atlas and AWS S3 are configured.
- GitHub repo is available to Dokploy.
- Shared secrets are generated: `FACTORY_INTERNAL_TOKEN`, `FACTORY_ADMIN_TOKEN`,
  dashboard session secret, provider keys as needed.
- Redis is optional (K1 Redis Backbone, D-167) — only needed when running more than one replica of
  `gateway-api` or `event-bus-service`. See `docs/deployment-plan.md` → "Redis Backbone" for the
  full setup and rollback notes.
- `services/aos-agent-runtime` is a transitional consolidation candidate (K1, D-168/D-172) — NOT yet
  deployed, now hosting 7 workers across two batches. Batch 1 (architect/reviewer/qa/report, D-168)
  has a full cutover spec but is `BLOCKED_ON_MANUAL_DEPLOYMENT` (D-169/D-171). Batch 2A
  (memory-agent/documentation-service/internet-research-service, D-172) is code-level only — no
  cutover spec exists for it yet. Production still runs all 7 original services as separate apps
  today. See `docs/deployment-plan.md` → "aos-agent-runtime cutover (transitional)" before creating
  anything for it in Dokploy.

## Creating a Service

1. New Dokploy application from the monorepo (**Root Directory = `/`**).
2. **Build Type = Dockerfile**, Dockerfile path `Dockerfile` (preferred).
   Nixpacks is fallback-only — cold nixpkgs bootstrap is very slow and often times out.
3. Set env `SERVICE_ID=<id>` (required at build + runtime), plus domain/port from `docs/service-map.md`.
4. Fill remaining env from `.env.example` and `deployment/env`.
5. Set health check (`/health` for APIs; `/` or `/login` for `dashboard-web`).
6. Deploy and verify.

## Calibration

Run Dokploy diagnostics before relying on API execution. Unsupported or drifting
API shapes must become `manual_required`, not success. AOS can still provide
exact manual steps and re-verify after the human completes them.

## Rollback

- Code rollback: redeploy previous successful commit/build for the affected service.
- Env rollback: restore previous env and redeploy.
- Workspace promotion rollback: use the generated rollback plan and preserved snapshot branch.
- Protected core rollback requires owner review.

## Safety

Safe mode blocks mutation/deploy/repair/governance actions. Reads, monitoring,
reports, and recommendations continue.
