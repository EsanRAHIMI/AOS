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
- `services/aos-agent-runtime` is a transitional consolidation candidate (K1, D-168) — NOT yet
  deployed. Production still runs `architect-agent`, `reviewer-agent`, `qa-agent`, and `report-agent`
  as four separate apps today. See `docs/deployment-plan.md` → "aos-agent-runtime cutover
  (transitional)" before creating anything for it in Dokploy.

## Creating a Service

1. New Dokploy application from the monorepo.
2. Set root directory to `services/<id>`.
3. Build command:
   `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/<id>... run build`
4. Start command:
   `pnpm --filter @factory/<id> run start`
5. Set domain and port from `docs/service-map.md`.
6. Fill env from `.env.example` and `deployment/env`.
7. Set health check path `/health`.
8. Deploy and verify all standard factory endpoints.

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
