/**
 * Documentation Service — entry point (production bootstrap).
 *
 * All service construction lives in server.ts (buildDocumentationServiceService),
 * which characterization tests also build — without listening and with an
 * injected test Db. This file only loads env, connects Mongo, ensures the
 * unique index, builds, and listens. See decision-log D-172 (K1 Consolidation
 * Prep Batch 2A).
 */
import { loadEnv, BaseEnvSchema, MongoEnvSchema, connectMongo, collection, COLLECTIONS } from '@factory/shared';
import { buildDocumentationServiceService, type DocRecord } from './server.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<DocRecord>(COLLECTIONS.DOCUMENTS).createIndex({ slug: 1 }, { unique: true });
  const service = await buildDocumentationServiceService(env);
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
