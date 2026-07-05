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

## Future Direction

- Add typed client generation from OpenAPI.
- Add retry/backoff/circuit-breaker helpers in `@factory/shared`.
- Add distributed tracing headers across gateway and agents.
- Move internal service auth toward short-lived service tokens when the platform
  is ready for a service identity layer.
