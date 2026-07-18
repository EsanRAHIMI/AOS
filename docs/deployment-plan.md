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

## BullMQ Task Queue (K1, D-173)

`REDIS_URL` (the same variable used by the Redis Backbone above) is **optional** here too. Unset (the
default) means `aos-agent-runtime`'s 7 workers run exactly as before D-173 — HTTP `/.factory/task` only,
identical behavior, zero new required infrastructure. Set it to additionally queue-enable all 7 workers
in parallel with HTTP (both paths work simultaneously; nothing is removed):

- Provision one reachable Redis instance — the same instance already used for the Redis Backbone can be
  reused (BullMQ uses its own dedicated connection with different settings, but the same server is fine).
- Set `REDIS_URL` on the `aos-agent-runtime` app. Optionally tune `AGENT_QUEUE_MAX_ATTEMPTS` (default 3),
  `AGENT_QUEUE_BACKOFF_MS` (default 2000), `AGENT_QUEUE_CONCURRENCY` (default 4),
  `AGENT_QUEUE_TIMEOUT_MS` (default 30000) — all optional, all have safe defaults.
- Rollback: unset `REDIS_URL` and redeploy — `aos-agent-runtime` falls back to HTTP-only with no code
  changes and no data loss (`agent_job_runs` holds no state anything else depends on).
- Verify with `REDIS_URL=<url> MONGODB_URI=<uri> node scripts/agent-queue-verify.mjs` before relying on
  the queue path in production — see the script's own header comment for the full 15-point check it
  performs against real Redis + real Mongo (extended with a D-174 dispatch-mode section below).

## BullMQ Producer Adoption (K1, D-174)

D-173 above built the queue backbone and consumer side only — `gateway-api` and `orchestrator-agent`
still dispatched every task over HTTP regardless of `REDIS_URL`. D-174 makes those two services'
dispatch paths mode-aware via `AGENT_DISPATCH_MODE` (`http` default | `queue_with_http_fallback` |
`queue_only` — see `docs/environment-variables.md`), so real task traffic can actually move onto BullMQ.

**Recommended rollout order, one step at a time, re-verifying after each:**

1. Deploy this code with `AGENT_DISPATCH_MODE` unset (`http`) on both `gateway-api` and
   `orchestrator-agent` — byte-identical to pre-D-174 behavior, safe to ship with zero risk. Confirms
   nothing regressed before touching dispatch mode at all.
2. Confirm `REDIS_URL` is set and `scripts/agent-queue-verify.mjs`'s D174.* checks pass against the
   real Redis + Mongo this deployment uses (do this before step 3, not after).
3. Set `AGENT_DISPATCH_MODE=queue_with_http_fallback` on `orchestrator-agent` first (it has more
   dispatch call sites — the architect/qa/reviewer/report/memory/documentation-service/
   internet-research-service delegations in `pipeline.ts` — and every one keeps working via automatic
   HTTP fallback + an `agent.dispatch.degraded` event if anything about the queue path misbehaves).
   Watch the dashboard's `/events` feed for that event type; it should not appear under normal
   operation once Redis is healthy.
4. Set `AGENT_DISPATCH_MODE=queue_with_http_fallback` on `gateway-api` (its 4 gateway→orchestrator-agent
   forward points — `POST /v1/tasks` and 3 internal triggers).
5. After an observation period with no unexpected `agent.dispatch.degraded` events and no
   `Task.status`/`AgentJobRun.status` inconsistencies (spot-check via `GET /v1/agent-jobs/:jobRunId`
   against a task's own timeline), optionally move to `queue_only` on one service at a time — this
   removes the HTTP safety net, so only do this once the queue path has real operational history.
- **Rollback:** set `AGENT_DISPATCH_MODE=http` (or unset it) and redeploy — no code change, no data
  migration; `agent_job_runs` rows already written are simply not read by the HTTP path, and vice
  versa. Safe to roll back independently per-service (gateway-api and orchestrator-agent do not have
  to be in the same mode).
- **DLQ operations:** `gateway-api`'s `GET /v1/agent-jobs/dead-letters?serviceId=`,
  `GET /v1/agent-jobs/:jobRunId`, `POST /v1/agent-jobs/:jobRunId/replay`,
  `POST /v1/agent-jobs/:jobRunId/cancel` (owner/operator role required — `manage_agent_jobs`
  permission, blocked in safe mode, every action audited). No new Dokploy app or infrastructure
  request is needed — this is a route group on the existing `gateway-api` app.

### K1 BullMQ — Local Real-Infra Verification (D-175)

The sandbox this project is normally developed in has no path to real Redis/Mongo (see D-175) — run
these on your own machine before relying on the queue path anywhere. Uses a disposable Mongo database
name (`agent_queue_verify`) on your real cluster so nothing touches production data; the script deletes
every row it inserts on exit either way.

```bash
# 1. Real Redis via Docker Desktop (already running per your setup)
docker run -d --name aos-redis -p 6379:6379 redis:7-alpine
docker exec aos-redis redis-cli ping   # expect: PONG

# 2. Point REDIS_URL + AGENT_DISPATCH_MODE at it, then re-sync into every service's local .env
#    (edit the root .env — never .env.example — then:)
pnpm sync:env

# 3. Run the real-Redis BullMQ integration tests (5 tests, shared/test/queue.bullmq-integration.contract.test.ts)
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @factory/shared test

# 4. Run the 20-point real Redis + real Mongo verification script
REDIS_URL=redis://127.0.0.1:6379 \
MONGODB_URI="<your real MONGODB_URI from .env>" \
MONGODB_DB_NAME=agent_queue_verify \
node scripts/agent-queue-verify.mjs

# 5. Full E2E flow: start the real stack, then create a task through gateway-api and watch it
#    move through the queue.
pnpm dev:all   # starts every LOCAL_SERVICES entry (service-registry, event-bus, gateway-api,
               # orchestrator-agent, etc.) per scripts/local-services.mjs, in order

# In a second terminal, with aos-agent-runtime NOT started via dev:all by default (see the
# LOCAL_SERVICES comment in scripts/local-services.mjs — it shares ports with the 4 standalone
# agents it's meant to replace). To exercise the real BullMQ worker path, stop architect-agent
# first, then:
cd services/aos-agent-runtime && pnpm dev

# Create a task and watch it move through the queue:
curl -X POST http://localhost:4101/v1/tasks \
  -H "Content-Type: application/json" \
  -H "x-factory-admin-token: <FACTORY_ADMIN_TOKEN>" \
  -d '{"serviceId":"architect-agent","goal":"design something","input":{}}'
# -> note the returned jobRunId, then:
curl http://localhost:4101/v1/agent-jobs/<jobRunId> -H "x-factory-admin-token: <FACTORY_ADMIN_TOKEN>"
# status should move queued -> claimed -> running -> succeeded; check GET /v1/events for the
# AGENT_JOB_* trail and confirm no unexpected agent.dispatch.degraded.
```

**Required test cases to exercise manually against this real stack** (per the owner's own checklist —
none of these were run in the sandbox this pass, D-175): successful queued execution; two workers
racing the same job (start `aos-agent-runtime` twice with different `SERVICE_PORT`s pointed at the same
queue) never double-execute; a handler that fails once then succeeds proves retry; a handler slower
than `AGENT_QUEUE_TIMEOUT_MS` proves timeout-as-failure; a handler that always fails proves dead-letter
after `AGENT_QUEUE_MAX_ATTEMPTS`; `GET /v1/agent-jobs/dead-letters` proves DLQ inspection;
`POST /v1/agent-jobs/:jobRunId/replay` proves replay-to-success; enqueuing the same
`serviceId`+`taskId` twice proves idempotency (second call returns `duplicate:true`, no second
execution); `POST /v1/agent-jobs/:jobRunId/cancel` on a still-`queued` job proves cancellation;
stopping the Redis container mid-run proves `queue_with_http_fallback` degrades to HTTP with a visible
`agent.dispatch.degraded` event (never a silent fallback); and cross-checking a task's `Task.status`
against its `AgentJobRun.status` at every stage proves the two never contradict each other.

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
- ~~Redis Streams or a real task queue (BullMQ or equivalent) behind `POST /v1/tasks`.~~ Done (D-173
  backbone + D-174 producer adoption, see above) — `AGENT_DISPATCH_MODE` still defaults to `http`
  until the rollout steps above are executed against real infrastructure.
- Queue-enable the remaining isolated services (`builder-agent`, `devops-agent`, `monitor-agent`,
  `browser-testing-agent`) — deliberately deferred past D-174; each needs its own
  security-isolation-aware queue design (D-170), not a blind migration.
- Redis-backed cross-instance session invalidation (revoke-everywhere) — not yet built.
- OpenTelemetry traces and metrics.
- Backup drills, secret rotation drills, rollback rehearsal.

---

## K2 Jarvis — deployment additions (D-177/D-178)

K2 adds **no new deployable**. It runs inside the existing `gateway-api` +
`dashboard-web` + Mongo + Redis. New/optional infrastructure and env:

### New collections (created on first write; add compound indexes led by scope)
`agent_loop_runs`, `agent_loop_steps`, `tool_invocations`,
`agent_approval_checkpoints`, `reflection_lessons`, `jarvis_sessions`,
`jarvis_session_turns`, `memory_records`, `memory_embeddings`, `mission_nodes`,
`research_sources`, `watches`, `watch_firings`, `self_dev_runs`.
Recommended indexes: `{createdBy:1, updatedAt:-1}` on user-scoped collections;
`{runId:1}` on `agent_loop_steps`/`tool_invocations`; `{subject:1, createdBy:1}`
on `memory_records`; `{parentId:1}` on `mission_nodes`.

### New environment variables (all optional; missing → honest degraded)
```
# Model (independence: local first). See scripts/model-health-check.mjs.
LLM_LOCAL_BASE_URL=      # e.g. http://127.0.0.1:11434/v1 (Ollama) — preferred
LLM_LOCAL_MODEL=         # e.g. qwen2.5:7b (tool-capable)
LLM_LOCAL_MODEL_FAST=
LLM_LOCAL_API_KEY=       # usually "local"
LLM_MODEL_REASONING=     # tier overrides (optional)
LLM_MODEL_STANDARD=
LLM_MODEL_FAST=
ANTHROPIC_API_KEY=       # optional cloud (host api.anthropic.com)
OPENAI_API_KEY=          # optional cloud
LLM_TOOLCALL_MODE=native # native | structured (compat)
# Memory v2 embeddings (optional, self-hostable; lexical works without it)
EMBEDDINGS_BASE_URL=     # defaults to LLM_LOCAL_BASE_URL
EMBEDDINGS_MODEL=        # default nomic-embed-text
EMBEDDINGS_API_KEY=
# Independent research (optional; direct/RSS work without it)
SEARXNG_BASE_URL=        # self-hosted SearXNG (deployment/searxng.md)
# Agent loop worker execution budget (distinct from producer wait)
AGENT_JOB_TIMEOUT_MS=120000
```

### Runtime dependencies
- Required: MongoDB (Atlas or self-hosted), Redis.
- Optional/self-hosted: Ollama or vLLM (model), SearXNG (search), a local
  OpenAI-compatible `/embeddings` endpoint.
- Chromium + system libs only for the Playwright e2e suite (not production).

### Migrations / rollback
- No migration needed: all K2 collections are new; legacy paths untouched.
- Rollback: revert the K2 commits; new collections can be dropped safely (no
  legacy data depends on them).

### Verify after deploy
`node scripts/model-health-check.mjs`; the four Jarvis verify scripts against
the deployed Mongo/Redis; then `/jarvis` in the browser.
