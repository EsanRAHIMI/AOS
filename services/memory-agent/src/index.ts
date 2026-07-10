/**
 * Memory Agent — entry point (production bootstrap).
 *
 * All service construction lives in server.ts (buildMemoryAgentService),
 * which characterization tests also build — without listening and with an
 * injected test Db. This file only loads env, connects Mongo, ensures
 * indexes, builds, and listens. See decision-log D-172 (K1 Consolidation
 * Prep Batch 2A).
 */
import { loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo, collection, COLLECTIONS, type Memory, type Skill } from '@factory/shared';
import { buildMemoryAgentService } from './server.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<Memory>(COLLECTIONS.MEMORIES).createIndex({ memoryId: 1 }, { unique: true });
  await collection<Memory>(COLLECTIONS.MEMORIES).createIndex({ taskId: 1 });
  await collection<Skill>(COLLECTIONS.SKILLS).createIndex({ skillId: 1 }, { unique: true });
  const service = await buildMemoryAgentService(env);
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
