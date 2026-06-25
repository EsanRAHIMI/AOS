/**
 * File Asset Service — entry point.
 *
 * Standard file/object API for the whole system. Files live in AWS S3; metadata
 * lives in MongoDB. Other services request a presigned upload URL, upload
 * directly to S3, then register the resulting object's metadata here.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  S3EnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  S3_PREFIXES,
  FileStorage,
  hasValidInternalToken,
  success,
  failure,
  ERROR_CODES,
  genId,
  nowIso,
  type S3Object,
} from '@factory/shared';
import { createFactoryService } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(S3EnvSchema));

/** Map a logical area to an S3 key prefix. */
function prefixFor(area: string, id: string): string {
  switch (area) {
    case 'tasks':
      return S3_PREFIXES.tasks(id);
    case 'agents':
      return S3_PREFIXES.agents(id);
    case 'services':
      return S3_PREFIXES.services(id);
    case 'documents':
      return S3_PREFIXES.documents();
    case 'artifacts':
      return S3_PREFIXES.artifacts();
    case 'images':
      return S3_PREFIXES.images();
    case 'research':
      return S3_PREFIXES.research();
    default:
      return S3_PREFIXES.artifacts();
  }
}

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const objects = collection<S3Object>(COLLECTIONS.S3_OBJECTS);
  await objects.createIndex({ objectId: 1 }, { unique: true });
  await objects.createIndex({ taskId: 1 });

  const storage = new FileStorage({
    region: env.AWS_REGION,
    bucket: env.AWS_S3_BUCKET,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  });

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    routes: (app, ctx) => {
      const guard = (req: { headers: Record<string, string | string[] | undefined> }) =>
        hasValidInternalToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN });

      // Presign a direct-to-S3 upload and return the key the caller should use.
      app.post<{
        Body: { area: string; id?: string; filename: string; contentType: string };
      }>('/files/presign-upload', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const { area, id, filename, contentType } = req.body ?? {};
        if (!area || !filename || !contentType) {
          return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'area, filename, contentType required'));
        }
        const key = `${prefixFor(area, id ?? 'shared')}/${genId('obj')}-${filename}`;
        const url = await storage.signedPutUrl(key, contentType);
        return success({ key, url, bucket: storage.bucketName });
      });

      // Register metadata after a successful upload.
      app.post<{
        Body: { key: string; mimeType: string; size: number; serviceId?: string; taskId?: string };
      }>('/files/metadata', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const b = req.body;
        if (!b?.key || !b?.mimeType || typeof b.size !== 'number') {
          return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'key, mimeType, size required'));
        }
        const record: S3Object = {
          objectId: genId('file'),
          bucket: storage.bucketName,
          key: b.key,
          mimeType: b.mimeType,
          size: b.size,
          serviceId: b.serviceId ?? null,
          taskId: b.taskId ?? null,
          createdAt: nowIso(),
        };
        await objects.insertOne(record);
        ctx.log.info({ objectId: record.objectId, key: record.key }, 'file metadata recorded');
        return success(record);
      });

      app.get<{ Params: { id: string } }>('/files/:id', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const rec = await objects.findOne({ objectId: req.params.id }, { projection: { _id: 0 } });
        if (!rec) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'object not found'));
        return success(rec);
      });

      app.get<{ Params: { id: string } }>('/files/:id/url', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const rec = await objects.findOne({ objectId: req.params.id });
        if (!rec) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'object not found'));
        const url = await storage.signedGetUrl(rec.key);
        return success({ url });
      });
    },
  });

  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
