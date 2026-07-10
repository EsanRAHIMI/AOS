/**
 * K1.3 characterization harness — builds the REAL gateway (every route, every
 * guard, every helper) in-process with an injected fake Db and no listening
 * socket. registryUrl/eventBusUrl are empty, so EventPublisher/RegistryClient
 * short-circuit without network (verified in shared source). Orchestrator
 * forwarding targets localhost and fails fast — which IS the documented local
 * contract for POST /v1/tasks (task persists as 'queued').
 */
import { setTestDb, INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER, ROLE_HEADER } from '@factory/shared';
import type { FactoryService } from '@factory/service-kit';
import { buildGatewayService, GatewayEnvSchema, type GatewayEnv } from '../../src/server.js';
import { FakeDb } from './fake-db.js';

export const INTERNAL = 'test-internal-token';
export const ADMIN = 'test-admin-token';

export function testEnv(overrides: Partial<GatewayEnv> = {}): GatewayEnv {
  return GatewayEnvSchema.parse({
    NODE_ENV: 'test',
    FACTORY_INTERNAL_TOKEN: INTERNAL,
    FACTORY_ADMIN_TOKEN: ADMIN,
    SERVICE_ID: 'gateway-api',
    SERVICE_NAME: 'Gateway API',
    SERVICE_PORT: 4100,
    MONGODB_URI: 'mongodb://fake-not-used:27017',
    LOG_LEVEL: 'error',
    ...overrides,
  });
}

export interface Harness {
  service: FactoryService;
  db: FakeDb;
  close: () => Promise<void>;
}

export async function buildTestGateway(
  envOverrides: Partial<GatewayEnv> = {},
  seed?: (db: FakeDb) => void,
): Promise<Harness> {
  const db = new FakeDb();
  seed?.(db); // seed BEFORE boot so boot-time reads (e.g. safe-mode) see it
  setTestDb(db.asDb());
  const service = await buildGatewayService(testEnv(envOverrides), { connectDb: false });
  return { service, db, close: () => service.close() };
}

/** Auth header helpers. Admin requests may declare a role (owner by default). */
export const asAdmin = (role?: string): Record<string, string> =>
  role ? { [ADMIN_TOKEN_HEADER]: ADMIN, [ROLE_HEADER]: role } : { [ADMIN_TOKEN_HEADER]: ADMIN };
export const asInternal = (): Record<string, string> => ({ [INTERNAL_TOKEN_HEADER]: INTERNAL });
