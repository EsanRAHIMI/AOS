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

## Future Direction

- Add typed client generation from OpenAPI.
- Add retry/backoff/circuit-breaker helpers in `@factory/shared`.
- Add distributed tracing headers across gateway and agents.
- Move internal service auth toward short-lived service tokens when the platform
  is ready for a service identity layer.
- Redis-backed session invalidation (list/revoke sessions across instances) — not yet built; K1
  auth still resolves sessions from Mongo per-request, which is already cross-instance-correct but
  does not yet support instant cross-instance revocation notification the way events/rate-limits do.
- BullMQ or an equivalent real task queue for `POST /v1/tasks` — deliberately deferred (D-167): the
  current forward-and-forget HTTP call to orchestrator-agent is unchanged; a real queue is a new
  dependency, worker model, and retry/idempotency design, not a small foundation step.
