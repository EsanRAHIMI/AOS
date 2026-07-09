/**
 * Gateway API — entry point (production bootstrap).
 *
 * All service construction lives in server.ts (`buildGatewayService`), which
 * characterization tests also build — without listening and with an injected
 * test Db. This file only loads env, builds, and listens.
 */
import { loadEnv } from '@factory/shared';
import { GatewayEnvSchema, buildGatewayService } from './server.js';

const env = loadEnv(GatewayEnvSchema);

async function main(): Promise<void> {
  const service = await buildGatewayService(env);
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
