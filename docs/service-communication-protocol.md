# Service Communication Protocol

## Principles

1. Services communicate over HTTP only.
2. Service-to-service calls use `x-factory-internal-token`.
3. Human/dashboard calls use server-side admin/session auth and propagated roles.
4. Peer URLs come from env, service registry, or canonical local ports.
5. All responses use the standard success/error envelope.
6. Failures are explicit: `not_configured`, `manual_required`, `fallback`, or `failed`.
7. User-data calls must propagate tenant/user/role context explicitly.

## Startup Sequence

1. Validate env through `shared/src/env`.
2. Connect to MongoDB when state is required.
3. Build manifest and start Fastify through `@factory/service-kit`.
4. Self-register with `service-registry` best-effort.
5. Publish startup/status events best-effort.
6. Serve factory endpoints and service-specific routes.

## Calling a Peer

```ts
const peer = await ctx.registry.resolve('memory-agent');
const res = await fetch(`${peer.domain}/.factory/task`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-factory-internal-token': token,
  },
  body: JSON.stringify({ goal, input }),
});
```

## Failure Posture

- Registry/event-bus outages must not crash unrelated work.
- Dependency failure should produce an event and an honest status.
- External API shape drift should become diagnostics + manual fallback.
- Protected-core and real-world actions must stop at approval gates.
- Scope confusion is a security failure: if tenant/user/case context is missing, fail closed.

## Event Fan-Out (K1 Redis Backbone, D-167)

`event-bus-service` fans events out to connected SSE subscribers (mainly the dashboard) through
`EventBroadcaster<T>` (`@factory/shared`, `shared/src/redis/index.ts`), a single primitive used
identically whether or not Redis is configured:

- **Local delivery is unconditional.** Every publish fans out to same-process subscribers first,
  with zero Redis dependency — this is byte-identical to the original Phase 1 in-process behavior
  when `REDIS_URL` is unset.
- **Cross-instance delivery is additive.** When `REDIS_URL` is set, the same publish is also sent
  on a Redis pub/sub channel, and every sibling instance subscribed to that channel fans the message
  out to its own local subscribers too. N replicas of `event-bus-service` behind one load balancer
  then see identical event streams — closing the exact gap this file used to describe as future
  work.
- **Self-echo suppression.** Each broadcaster instance tags its own outgoing Redis messages with a
  random `originId` (generated once at construction) and drops any incoming Redis message carrying
  its own `originId` — without this, a publishing instance would double-deliver its own event to
  its own local subscribers (once directly, once via its own Redis echo).
- **Never crashes on Redis failure.** `RedisBackbone` (the thin wrapper every Redis call goes
  through) never throws; a missing, unreachable, or misbehaving Redis degrades a multi-instance
  deployment back to single-instance-equivalent behavior (each instance only sees its own directly
  posted events) rather than taking the service down.

`gateway-api`'s mutation rate limiter (`RateLimiter`, `shared/src/security/index.ts`) uses the same
`RedisBackbone` for a shared, cross-instance counter (`INCR` + `PEXPIRE`-on-first-hit, a standard
fixed-window pattern) when `REDIS_URL` is set, and falls back to its original local in-memory
fixed-window counter otherwise or on any Redis error mid-request.

Safe-mode enforcement itself was already Mongo-backed and cross-instance-correct before this phase
(`isSafeMode()` does a fresh read every call, no caching) — Redis's role there is exclusively
faster cross-instance *notification* of a safe-mode change via the same event fan-out above, not a
new enforcement mechanism. See decision-log D-167 for the full reasoning.

Verification: `shared/test/redis-backbone.contract.test.ts` (17 tests, hand-rolled fake Redis
broker/client — same test-double pattern as `services/gateway-api/test/helpers/fake-db.ts`) proves
cross-instance delivery, no-republish-loop, per-key-independent rate limiting, and Redis-disabled
fallback. `scripts/redis-two-instance-check.mjs` is a human-run script (requires a real, reachable
Redis — not available in every dev sandbox) that boots two real HTTP instances and proves the same
contract end to end over real Redis pub/sub.

## Task Dispatch (K1 BullMQ Task Queue + Producer Adoption, D-173/D-174)

Every service-to-service task dispatch in the kernel is one of two transports, selected per-process by
`AGENT_DISPATCH_MODE` (`http` | `queue_with_http_fallback` | `queue_only`, default `http` — byte-identical
to the original HTTP-only behavior):

- **HTTP** (`PeerClient.dispatchTask` / gateway's own `fetch`) — the original, always-available
  transport. `POST /.factory/task` on the target service, no retry, no idempotency, no dead-letter.
- **BullMQ** (`shared/src/queue/index.ts`, D-173) — one `Queue`/`Worker` pair per `serviceId`
  (`agent-tasks:{serviceId}`), a Mongo-backed `agent_job_runs` lifecycle
  (`queued→claimed→running→succeeded|failed→retrying|dead_lettered|cancelled`) separate from
  `Task.status`, idempotency-key enforcement at enqueue time, configurable retry/backoff/timeout, and a
  DLQ (list/inspect/replay/cancel).

`shared/src/dispatch/index.ts`'s `dispatchViaQueueOrHttp` (D-174) is the single mode-aware helper both
producers use — it is NOT a new transport, only a router between the two above:

- `http` (the default): calls the HTTP transport directly, queue code is never entered. Zero risk,
  zero behavior change from pre-D-173.
- `queue_with_http_fallback`: enqueues via BullMQ; if the queue client is disabled (`REDIS_URL` unset),
  the enqueue fails, or (when the caller needs a synchronous-style result) the job doesn't reach a
  terminal state before a timeout, it falls back to HTTP AND publishes `agent.dispatch.degraded` — a
  queue-capable dispatch never silently reverts to HTTP without a visible event.
- `queue_only`: same enqueue attempt, but never falls back — a queue failure is reported as a failure,
  not silently absorbed by HTTP. Every `Task`/dispatch result records which path actually ran
  (`Task.dispatchMode: 'queue' | 'http' | 'http_fallback'`).

**Current producers/consumers (D-174):**

- `gateway-api`'s `POST /v1/tasks` (and the 3 other gateway→orchestrator-agent forward points —
  `capabilities.ts`'s build-from-proposal, `governance.ts`'s recommendation-approved and
  learning-trigger) all route through one shared `dispatchTaskToOrchestrator` helper
  (`server.ts`), fire-and-forget (no `waitForCompletion`) — matching the original forward-and-forget
  semantics exactly when queue mode degrades or is off.
- `orchestrator-agent` consumes its own queue (`agent-tasks:orchestrator-agent`) via
  `createAgentTaskWorker` wired to the same `handleTask` its HTTP route already calls (same pattern as
  `aos-agent-runtime`'s 7 workers, D-173).
- Inside `orchestrator-agent/src/pipeline.ts`, every dispatch call TO one of the 7 `aos-agent-runtime`
  consolidated workers (`architect-agent`, `qa-agent`, `reviewer-agent`, `report-agent`, `memory-agent`,
  `documentation-service`, `internet-research-service` — 12 call sites total across
  `runResearchPipeline`/`runDelegationPipeline`/`runBuildPipeline`/`runActivationPipeline`) goes through
  `dispatchPeerTask`, which uses `waitForCompletion` so the queue path stands in for today's
  sequential-awaited HTTP call without changing pipeline control flow.
- Dispatches to the isolated services — `builder-agent`, `devops-agent`, `monitor-agent`,
  `browser-testing-agent` (13 call sites in `pipeline.ts`), plus gateway's own calls to
  `internet-research-service` (synchronous RPC for Jarvis), `voice-operator-agent`, and
  `code-operator-agent` — remain HTTP-only. These are either security-isolated (filesystem writes, real
  GitHub API writes, a spawned browser process — see D-170) or synchronous request/response flows a
  queue redesign would change the shape of; neither is in scope for this pass.

**DLQ operational surface (D-174):** `gateway-api`'s `routes/agent-jobs.ts` —
`GET /v1/agent-jobs/dead-letters?serviceId=`, `GET /v1/agent-jobs/:jobRunId`,
`POST /v1/agent-jobs/:jobRunId/replay`, `POST /v1/agent-jobs/:jobRunId/cancel`. The two mutating routes
require the `manage_agent_jobs` RBAC permission, are blocked in safe mode, and every action is audited
(`buildAuditLog`) — same pattern as every other sensitive dashboard action in this file.

## Future Direction

- Add typed client generation from OpenAPI.
- Add distributed tracing headers across gateway and agents.
- Move internal service auth toward short-lived service tokens when the platform
  is ready for a service identity layer.
- Redis-backed session invalidation (list/revoke sessions across instances) — not yet built; K1
  auth still resolves sessions from Mongo per-request, which is already cross-instance-correct but
  does not yet support instant cross-instance revocation notification the way events/rate-limits do.
- Queue-enable the isolated services (`builder-agent`, `devops-agent`, `monitor-agent`,
  `browser-testing-agent`) — deliberately deferred: each needs its own security-isolation-aware queue
  design (D-170), not a blind migration.
- Queue-enable gateway's synchronous RPC calls (`internet-research-service`, `voice-operator-agent`,
  `code-operator-agent`) — would require a Jarvis-response-flow redesign to poll/await a queued result
  instead of an inline HTTP round trip; out of scope for D-174.
