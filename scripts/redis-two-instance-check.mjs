#!/usr/bin/env node
/**
 * K1 Redis Backbone (D-167) — real-Redis two-instance verification.
 *
 * Boots TWO event-bus-service-shaped HTTP servers in this one process
 * (different ports), each with its OWN EventBroadcaster/RedisBackbone
 * pointed at the SAME real Redis (REDIS_URL), and proves an event POSTed
 * to instance A is delivered over SSE to a subscriber on instance B —
 * i.e. real cross-instance fan-out through real Redis pub/sub, not the
 * fake-broker test double used in shared/test/redis-backbone.contract.test.ts.
 *
 * Why this script exists and isn't just another automated test: this
 * sandbox has no way to run a real Redis server (no root/Docker, apt and
 * redis-memory-server's binary download are both blocked — see
 * decision-log D-167). The 17 tests in
 * shared/test/redis-backbone.contract.test.ts already prove the
 * cross-instance contract correctly against a hand-rolled fake broker,
 * and are the automated two-instance proof for CI. This script is the
 * closest thing to a "does it actually work against real Redis" check,
 * meant to be run by a human against a real Redis instance before/after
 * deploying to Dokploy.
 *
 * Usage:
 *   redis-server --daemonize yes          # or any reachable Redis
 *   REDIS_URL=redis://127.0.0.1:6379 node scripts/redis-two-instance-check.mjs
 *
 * Exits 0 and prints "PASS" on success, exits 1 and prints "FAIL" + reason
 * otherwise. Cleans up its own Redis keys/subscriptions on exit either way.
 */
import { randomUUID } from 'node:crypto';
import { EventBroadcaster, createRedisBackbone, hasValidInternalToken, success } from '@factory/shared';
import { createFactoryService } from '@factory/service-kit';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error('FAIL: REDIS_URL is not set. This script requires a real, reachable Redis.');
  console.error('Example: REDIS_URL=redis://127.0.0.1:6379 node scripts/redis-two-instance-check.mjs');
  process.exit(1);
}

const INTERNAL = `smoke-${randomUUID()}`;
const CHANNEL = `two-instance-check:${randomUUID()}`; // unique per run — no collision with real traffic

async function buildInstance(port, serviceId) {
  const redisBackbone = createRedisBackbone({
    url: REDIS_URL,
    keyPrefix: 'factory:redis-check:',
    logger: { warn: (obj, msg) => console.warn(`[${serviceId}]`, msg ?? '', obj) },
  });
  const broadcaster = new EventBroadcaster(redisBackbone.enabled ? redisBackbone : null, CHANNEL);
  const ready = await broadcaster.ready();
  if (!ready) {
    throw new Error(`${serviceId}: Redis subscription did not attach — is ${REDIS_URL} reachable?`);
  }

  const sseClients = new Map();
  broadcaster.subscribeLocal('sse-writer', (event) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [id, reply] of sseClients) {
      try {
        reply.raw.write(frame);
      } catch {
        sseClients.delete(id);
      }
    }
  });

  const service = await createFactoryService({
    manifest: {
      serviceId,
      serviceName: serviceId,
      serviceType: 'infra',
      version: '0.0.0-check',
      domain: `http://127.0.0.1:${port}`,
      healthEndpoint: '/health',
      capabilities: [],
      dependencies: [],
      requiredEnv: [],
    },
    port,
    internalToken: INTERNAL,
    adminToken: '',
    registryUrl: '',
    logLevel: 'error',
    routes: (app) => {
      const guard = (req) => hasValidInternalToken({ headers: req.headers, expectedInternalToken: INTERNAL });

      app.post('/events', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send({ ok: false });
        const event = { eventId: randomUUID(), type: 'check.event', msg: req.body?.msg ?? '' };
        await broadcaster.publish(event);
        return success({ eventId: event.eventId });
      });

      app.get('/events/stream', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send({ ok: false });
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        reply.raw.write('event: ready\ndata: {}\n\n'); // flush headers immediately — see decision-log D-167 note
        const id = randomUUID();
        sseClients.set(id, reply);
        req.raw.on('close', () => sseClients.delete(id));
      });
    },
  });
  await service.listen();
  return { service, redisBackbone };
}

async function main() {
  const instA = await buildInstance(5391, 'redis-check-a');
  const instB = await buildInstance(5392, 'redis-check-b');
  console.log(`two instances listening: A=5391 B=5392, both pointed at ${REDIS_URL}`);

  const sseRes = await fetch('http://127.0.0.1:5392/events/stream', {
    headers: { 'x-factory-internal-token': INTERNAL },
  });
  if (sseRes.status !== 200) throw new Error(`instance B SSE endpoint returned ${sseRes.status}`);

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Drain the initial "ready" frame before posting, so we don't race it.
  await new Promise((resolve) => setTimeout(resolve, 200));

  const marker = `real-redis-check-${randomUUID()}`;
  const postRes = await fetch('http://127.0.0.1:5391/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-factory-internal-token': INTERNAL },
    body: JSON.stringify({ msg: marker }),
  });
  if (postRes.status !== 200) throw new Error(`POST to instance A returned ${postRes.status}`);

  const deadline = Date.now() + 5000;
  let found = false;
  while (Date.now() < deadline && !found) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ done: false, value: undefined }), 250)),
    ]);
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(marker)) found = true;
  }

  await reader.cancel().catch(() => undefined);
  await instA.service.close().catch(() => undefined);
  await instB.service.close().catch(() => undefined);
  await instA.redisBackbone.quit().catch(() => undefined);
  await instB.redisBackbone.quit().catch(() => undefined);

  if (!found) {
    console.error('FAIL: instance B never received the event POSTed to instance A within 5s.');
    console.error('Last buffer contents:', buffer);
    process.exit(1);
  }

  console.log('PASS: event POSTed to instance A was delivered to instance B over real Redis pub/sub.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err?.message ?? err);
  process.exit(1);
});
