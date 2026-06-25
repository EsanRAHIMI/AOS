/**
 * Event Bus Service — entry point.
 *
 * The internal real-time backbone. Services POST events here; the bus persists
 * each event to MongoDB and fans it out to all connected SSE subscribers
 * (primarily the dashboard). Phase 1 uses in-process SSE fan-out; a Redis/NATS
 * backplane can be added later for multi-instance scale without changing the
 * publish/subscribe contract.
 */
import { randomUUID } from 'node:crypto';
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
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

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

/** Connected SSE clients. Keyed by a per-connection id. */
const subscribers = new Map<string, FastifyReply>();

function broadcast(event: SystemEvent): void {
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const [id, reply] of subscribers) {
    try {
      reply.raw.write(frame);
    } catch {
      subscribers.delete(id);
    }
  }
}

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const events = collection<SystemEvent>(COLLECTIONS.EVENTS);
  await events.createIndex({ createdAt: -1 });
  await events.createIndex({ type: 1, createdAt: -1 });
  await events.createIndex({ taskId: 1, createdAt: -1 });

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
        broadcast(event);
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
        subscribers.set(id, reply);
        ctx.log.info({ subscriberId: id, total: subscribers.size }, 'sse subscriber connected');

        const heartbeat = setInterval(() => {
          try {
            reply.raw.write(`: ping\n\n`);
          } catch {
            /* dropped below */
          }
        }, 25000);

        req.raw.on('close', () => {
          clearInterval(heartbeat);
          subscribers.delete(id);
          ctx.log.info({ subscriberId: id, total: subscribers.size }, 'sse subscriber disconnected');
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
