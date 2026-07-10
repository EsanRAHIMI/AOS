/**
 * Internet Research Service — entry point (production bootstrap).
 *
 * All service construction lives in server.ts
 * (buildInternetResearchServiceService), which characterization tests also
 * build — without listening and with an injected test Db. This file only
 * loads env, connects Mongo, builds, and listens. See decision-log D-172
 * (K1 Consolidation Prep Batch 2A).
 */
import { loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, ResearchEnvSchema, connectMongo } from '@factory/shared';
import { buildInternetResearchServiceService } from './server.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema).merge(ResearchEnvSchema));

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const service = await buildInternetResearchServiceService(env);
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
