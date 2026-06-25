/**
 * Service Registry — entry point.
 *
 * Knows every service in the system. Services self-register on boot (POST
 * /services with their manifest); agents and the gateway resolve peers by id.
 * Registration records are upserted into MongoDB with a health snapshot.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  ServiceManifestSchema,
  hasValidInternalToken,
  success,
  failure,
  ERROR_CODES,
  nowIso,
  type ServiceManifest,
} from '@factory/shared';
import { createFactoryService } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

/** Registry record = manifest + lifecycle metadata. */
interface ServiceRecord extends ServiceManifest {
  registeredAt: string;
  lastSeenAt: string;
  deploymentStatus: 'registered' | 'healthy' | 'unreachable';
}

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const services = collection<ServiceRecord>(COLLECTIONS.SERVICES);
  // Unique index on serviceId keeps the registry idempotent.
  await services.createIndex({ serviceId: 1 }, { unique: true });

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    routes: (app, ctx) => {
      // Guard mutating routes with the internal token.
      const guard = (req: { headers: Record<string, string | string[] | undefined> }) =>
        hasValidInternalToken({
          headers: req.headers,
          expectedInternalToken: env.FACTORY_INTERNAL_TOKEN,
        });

      app.post('/services', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const parsed = ServiceManifestSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid manifest', parsed.error.issues));
        }
        const now = nowIso();
        const m = parsed.data;
        await services.updateOne(
          { serviceId: m.serviceId },
          {
            $set: { ...m, lastSeenAt: now, deploymentStatus: 'registered' },
            $setOnInsert: { registeredAt: now },
          },
          { upsert: true },
        );
        await ctx.publisher.publish({
          type: EVENT_TYPES.SERVICE_REGISTERED,
          taskId: null,
          payload: { serviceId: m.serviceId, serviceType: m.serviceType },
        });
        ctx.log.info({ serviceId: m.serviceId }, 'service registered');
        return success({ serviceId: m.serviceId, registered: true });
      });

      app.get('/services', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const all = await services.find({}, { projection: { _id: 0 } }).toArray();
        return success(all);
      });

      app.get<{ Params: { id: string } }>('/services/:id', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const rec = await services.findOne({ serviceId: req.params.id }, { projection: { _id: 0 } });
        if (!rec) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'service not found'));
        return success(rec);
      });
    },
  });

  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
