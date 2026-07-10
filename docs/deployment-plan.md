# Deployment Plan

AOS deploys as one Dokploy application per service. The monorepo remains the
source; each app builds its own workspace package plus shared dependencies.

## Deployment Order

1. Managed dependencies: MongoDB Atlas, AWS S3/CloudFront, DNS, GitHub repo, Redis (optional —
   see below).
2. `service-registry`
3. `event-bus-service`
4. `gateway-api`
5. Core agents: `orchestrator-agent`, `architect-agent`, `builder-agent`, `devops-agent`
6. Knowledge/ops: `memory-agent`, `documentation-service`, `monitor-agent`, `report-agent`
7. Quality/research: `reviewer-agent`, `qa-agent`, `internet-research-service`, `browser-testing-agent`
8. Assets and operator services: `file-asset-service`, `voice-operator-agent`, `code-operator-agent`
9. `dashboard-web`

## Per-App Pattern

- Repository: monorepo.
- Root directory: `services/<id>`.
- Build from repo root so pnpm workspace dependencies resolve.
- Build command:
  `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/<id>... run build`
- Start command:
  `pnpm --filter @factory/<id> run start`
- Health path: `/health`.
- Domain and port: from `shared/src/constants/index.ts`.
- Env: service `.env.example` plus `deployment/env/*.env.example`.

## Required Gates

Before marking a deploy healthy:

- `/health` is ok.
- `/.factory/manifest`, `/status`, `/capabilities` respond.
- Token-guarded routes reject missing/invalid tokens.
- Service appears in registry.
- Gateway/dashboard can read it.
- Events are flowing.
- No new security or monitor incident is open.

## Redis Backbone (K1, D-167)

`REDIS_URL` is **optional**. Unset (the default) means `gateway-api` and `event-bus-service` each
run in local/single-instance mode — identical to Phase 1 behavior, safe to deploy exactly as before.
Set it only when running more than one replica of `gateway-api` and/or `event-bus-service` behind a
load balancer, so event fan-out and mutation rate limits stay correct across instances:

- Provision one reachable Redis instance (Dokploy-managed Redis, a managed cloud Redis, or
  self-hosted — any standard Redis 6+ works; no special modules required).
- Set the **same** `REDIS_URL` on both `gateway-api` and `event-bus-service` — they share one
  backbone. Other services do not read `REDIS_URL`.
- No further Dokploy configuration is required — the app-level services connect to it directly like
  any other managed dependency (same pattern as `MONGODB_URI`).
- Rollback: unset `REDIS_URL` and redeploy — both services fall back to local behavior with no code
  changes and no data loss (Redis here holds no durable state, only fan-out/rate-limit signal).
- Verify with `REDIS_URL=<url> node scripts/redis-two-instance-check.mjs` before relying on it in
  production with multiple replicas — see the script's own header comment for details.

## Production Hardening Path

- OIDC/OAuth2 login and per-user RBAC.
- Tenant-aware data isolation checks before enabling multiple users.
- ~~Redis for distributed rate limiting and safe-mode propagation.~~ Done for event fan-out and
  rate limits (D-167, see above). Safe-mode *enforcement* was already Mongo-backed/cross-instance-
  correct before this; Redis now also gives faster cross-instance safe-mode *notification* via the
  same event fan-out.
- Redis Streams or a real task queue (BullMQ or equivalent) behind `POST /v1/tasks` — deliberately
  deferred (D-167): the current Redis work covers pub/sub fan-out only, not a durable/replayable
  queue, which is a larger, separate step.
- Redis-backed cross-instance session invalidation (revoke-everywhere) — not yet built.
- OpenTelemetry traces and metrics.
- Backup drills, secret rotation drills, rollback rehearsal.
