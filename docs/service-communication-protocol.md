# Service Communication Protocol

## Principles
1. **HTTP only between services.** No shared runtime code, no shared memory.
2. **Internal token on every service-to-service call** (`x-factory-internal-token`).
3. **Admin token for human/dashboard calls** (`x-factory-admin-token`).
4. **Discovery via configured URLs + the service-registry.** Services resolve a
   peer's base URL by id through `RegistryClient.resolve(serviceId)`.
5. **Consistent envelope** for all responses (`{ ok, data | error }`).

## Startup sequence (per service)
1. Validate env (`loadEnv`) — fail fast.
2. Connect MongoDB Atlas.
3. Build manifest, start Fastify (`@factory/service-kit`).
4. Self-register with the service-registry (best-effort, retried).
5. Begin serving standard + service-specific routes.

## Calling a peer
```ts
const peer = await ctx.registry.resolve('memory-agent');
await fetch(`${peer.domain}/.factory/task`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-factory-internal-token': TOKEN },
  body: JSON.stringify({ goal, input }),
});
```

## Failure posture
A service runs even if the registry or event bus is unreachable. Event
publishing and registration are best-effort and never break the main flow.
