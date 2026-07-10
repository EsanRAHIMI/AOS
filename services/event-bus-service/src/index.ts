/**
 * Event Bus Service — entry point.
 *
 * The internal real-time backbone. Services POST events here; the bus persists
 * each event to MongoDB and fans it out to all connected SSE subscribers
 * (primarily the dashboard). K1 Redis Backbone (D-167): fan-out now goes
 * through `EventBroadcaster` (`@factory/shared`) — same in-process SSE
 * delivery as before when REDIS_URL is unset (local/single-instance mode,
 * byte-identical to the original Phase 1 behavior), and ALSO published to a
 * Redis channel when configured, so N replicas of this service (behind one
 * load balancer, all pointed at the same Redis) see identical event
 * streams — closing the exact gap this file's comment used to describe as
 * future work. See docs/service-communication-protocol.md and decision-log
 * D-167.
 */
import { randomUUID } from 'node:crypto';
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  RedisEnvSchema,
  createRedisBackbone,
  EventBroadcaster,
  connectMongo,
  collection,
  COLLECTIONS,
  PublishEventSchema,
  hasValidInternalToken,
  success,
  failure,
  ERROR_CODES,
  genId,
  nowIso,
  type SystemEvent,
} from '@factory/shared';
import { createFactoryService, type FastifyReply } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(RedisEnvSchema));

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const events = collection<SystemEvent>(COLLECTIONS.EVENTS);
  await events.createIndex({ createdAt: -1 });
  await events.createIndex({ type: 1, createdAt: -1 });
  await events.createIndex({ taskId: 1, createdAt: -1 });

  const redisBackbone = createRedisBackbone({
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX,
    logger: { warn: (obj, msg) => console.warn(`[event-bus-service] ${msg ?? ''}`, obj) },
  });
  const broadcaster = new EventBroadcaster<SystemEvent>(redisBackbone.enabled ? redisBackbone : null, 'events');

  /** Connected SSE clients on THIS instance. Keyed by a per-connection id. */
  const sseClients = new Map<string, FastifyReply>();

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    logLevel: env.LOG_LEVEL,
    routes: (app, ctx) => {
      const guard = (req: { headers: Record<string, string | string[] | undefined> }) =>
        hasValidInternalToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN });

      // Local SSE writers subscribe to the broadcaster once, at boot — this
      // is what receives BOTH locally-ingested events and (when Redis is
      // configured) events published by sibling instances.
      broadcaster.subscribeLocal('sse-writer', (event) => {
        const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        for (const [id, reply] of sseClients) {
          try {
            reply.raw.write(frame);
          } catch {
            sseClients.delete(id);
          }
        }
      });

      app.addHook('onClose', async () => {
        await redisBackbone.quit();
      });

      // Ingest + persist + fan-out.
      app.post('/events', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const parsed = PublishEventSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid event', parsed.error.issues));
        }
        const event: SystemEvent = {
          eventId: genId('evt'),
          createdAt: nowIso(),
          ...parsed.data,
          taskId: parsed.data.taskId ?? null,
        };
        await events.insertOne(event);
        await broadcaster.publish(event);
        return success({ eventId: event.eventId });
      });

      // Recent history (newest first).
      app.get<{ Querystring: { limit?: string; taskId?: string } }>('/events', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        const filter = req.query.taskId ? { taskId: req.query.taskId } : {};
        const rows = await events.find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
        return success(rows);
      });

      // SSE stream for live dashboard updates.
      app.get('/events/stream', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        reply.raw.write(`event: ready\ndata: {"ok":true}\n\n`);
        const id = randomUUID();
        sseClients.set(id, reply);
        ctx.log.info({ subscriberId: id, total: sseClients.size }, 'sse subscriber connected');

        const heartbeat = setInterval(() => {
          try {
            reply.raw.write(`: ping\n\n`);
          } catch {
            /* dropped below */
          }
        }, 25000);

        req.raw.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(id);
          ctx.log.info({ subscriberId: id, total: sseClients.size }, 'sse subscriber disconnected');
        });
      });
    },
  });

  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
