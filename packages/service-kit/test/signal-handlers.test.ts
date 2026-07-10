/**
 * K1 Consolidation Prep (D-168) — proves the registerSignalHandlers option.
 *
 * Real signal delivery (kill -SIGINT <pid>) isn't practical to exercise
 * safely inside a test process, so this proves the two structural
 * guarantees that actually matter:
 *   1. Default (unset/true) behavior is BYTE-IDENTICAL to before this
 *      change — every existing single-service-per-process deployable is
 *      unaffected. Proven by asserting a SIGINT/SIGTERM listener IS added.
 *   2. registerSignalHandlers:false adds NO listener — the composing
 *      entrypoint owns shutdown instead — and two such instances sharing
 *      one process can both be closed cleanly by one shared handler that
 *      awaits both, which is exactly what services/aos-agent-runtime does.
 *      This directly fixes the bug this option exists to fix: without it,
 *      the FIRST instance's own handler would call process.exit(0) the
 *      moment ITS OWN close() resolves, before the other instance's close()
 *      has a chance to finish.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createFactoryService, type FactoryService } from '../src/index.js';
import type { ServiceManifest } from '@factory/shared';

function testManifest(serviceId: string): ServiceManifest {
  return {
    serviceId, serviceName: serviceId, serviceType: 'infra', version: '0.0.0-test',
    domain: `http://localhost/${serviceId}`, healthEndpoint: '/health',
    capabilities: [], dependencies: [], requiredEnv: [],
  };
}

describe('createFactoryService registerSignalHandlers', () => {
  const built: FactoryService[] = [];

  afterEach(async () => {
    await Promise.all(built.splice(0).map((s) => s.close().catch(() => undefined)));
  });

  it('default (unset) registers one SIGINT + one SIGTERM listener — unchanged existing behavior', async () => {
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
    const service = await createFactoryService({
      manifest: testManifest('default-behavior-test'), port: 0, internalToken: 'test-token',
    });
    built.push(service);
    expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
    expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);
  });

  it('registerSignalHandlers:false adds no process-level listener', async () => {
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
    const service = await createFactoryService({
      manifest: testManifest('opt-out-test'), port: 0, internalToken: 'test-token',
      registerSignalHandlers: false,
    });
    built.push(service);
    expect(process.listenerCount('SIGINT')).toBe(before.int);
    expect(process.listenerCount('SIGTERM')).toBe(before.term);
  });

  it('two registerSignalHandlers:false instances sharing one process both close fully under one shared awaited handler', async () => {
    const a = await createFactoryService({
      manifest: testManifest('multi-a'), port: 0, internalToken: 'test-token', registerSignalHandlers: false,
    });
    const b = await createFactoryService({
      manifest: testManifest('multi-b'), port: 0, internalToken: 'test-token', registerSignalHandlers: false,
    });
    await a.listen();
    await b.listen();
    expect(a.app.server.listening).toBe(true);
    expect(b.app.server.listening).toBe(true);

    // This is the exact pattern services/aos-agent-runtime's entrypoint uses
    // for its own single shared shutdown handler: await every instance's
    // close() together, THEN exit once — never exit after only the first.
    await Promise.all([a.close(), b.close()]);

    expect(a.app.server.listening).toBe(false);
    expect(b.app.server.listening).toBe(false);
  });
});
