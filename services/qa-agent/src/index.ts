/**
 * QA Agent — entry point (production bootstrap).
 *
 * All service construction lives in server.ts (buildQaAgentService), which
 * characterization tests also build — without listening and with an
 * injected test Db. This file only loads env, connects Mongo, builds, and
 * listens. See decision-log D-168 (K1 Consolidation Prep).
 */
import { loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo } from '@factory/shared';
import { buildQaAgentService } from './server.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const service = await buildQaAgentService(env);
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
