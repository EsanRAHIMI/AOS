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

## aos-agent-runtime cutover (transitional, D-168/D-169)

**Status: BLOCKED_ON_MANUAL_DEPLOYMENT.** This sandbox has no network path to
Dokploy (confirmed by a direct reachability check, not assumed) and,
independent of that, actually deploying and cutting production over is an
irreversible action requiring explicit human execution regardless of
credential availability. See decision-log D-169. The exact Dokploy app spec
is `deployment/dokploy/aos-agent-runtime.md`; the owner-run verification
script is `scripts/aos-agent-runtime-cutover-verify.mjs` (already proven
correct against real running instances in this sandbox); the rollback
runbook is `scripts/aos-agent-runtime-rollback.md`.

**Current production topology is unchanged by this section existing.**
`architect-agent`, `reviewer-agent`, `qa-agent`, and `report-agent` remain
four separate, live Dokploy apps today, deployed exactly per the sections
above. `services/aos-agent-runtime` is a parallel, characterization-tested
replacement candidate — code-complete, not deployed, carrying zero
production traffic. This section documents the cutover steps for when a
human decides to perform it; it is not a record of something already done.

**Before cutover:** confirm `pnpm --filter @factory/aos-agent-runtime test`
and `pnpm --filter @factory/aos-agent-runtime typecheck` are green (they
were at commit time — see decision-log D-168), and that
`scripts/redis-two-instance-check.mjs`-style manual verification isn't
needed here (this consolidation has no Redis dependency).

**Cutover steps (manual, human-executed, one Dokploy app at a time):**
1. Create one new Dokploy app: root directory `services/aos-agent-runtime`,
   build command `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/aos-agent-runtime... run build`,
   start command `pnpm --filter @factory/aos-agent-runtime run start`.
2. Give it the union of env vars the 4 original services' `.env.example`
   files declare (they're identical in shape — `MONGODB_URI`,
   `FACTORY_INTERNAL_TOKEN`, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, etc.) —
   see `services/aos-agent-runtime/.env.example` and its README.
3. Expose all 4 ports (4103, 4106, 4107, 4114) from this one container/app
   in Dokploy, each still routed to its historical domain
   (`architect.simorx.com`, `reviewer.simorx.com`, `qa.simorx.com`,
   `reports.simorx.com`) — no DNS changes.
4. Deploy. Verify all 4 ports' `/health`, `/.factory/manifest` respond
   correctly (each with its OWN serviceId — see
   `services/aos-agent-runtime/test/characterization.consolidated.test.ts`
   for the exact proof this must match).
5. Once verified reachable and healthy, stop and delete the 4 original
   Dokploy apps (`architect-agent`, `reviewer-agent`, `qa-agent`,
   `report-agent`). Do this only after step 4 is confirmed — do not delete
   the old apps preemptively.
6. Update `docs/service-map.md`'s "Current truth" count and table, and this
   file's "Deployment Order" section, to reflect the new reality — those
   edits belong in the cutover PR, not before.

**Rollback:** redeploy the 4 original Dokploy apps from their last-known
commit (their code is untouched by this consolidation — the folders still
exist, still build, still pass their own baseline characterization tests)
and delete/stop the `aos-agent-runtime` app. No data migration is involved
either direction — all 4 workers write to the same Mongo collections
(`llm_traces`, `evidence_records`, `qa_reports`, `review_reports`,
`intelligence_reports`, `agent_runs`) regardless of which deployable
produced them.

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
