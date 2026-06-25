# @factory/service-kit

Fastify bootstrap shared by all kernel backend services.

`createFactoryService(options)` returns a configured Fastify app that already
exposes the standard factory endpoints, enforces internal-token auth on
protected routes, self-registers with the service-registry on boot, wires an
event publisher, and shuts down gracefully.

```ts
import { createFactoryService } from '@factory/service-kit';

const service = await createFactoryService({
  manifest: { /* ServiceManifest */ },
  taskHandler: async (req) => ({ taskId: req.taskId ?? genId('task'), accepted: true }),
});
await service.listen();
```
