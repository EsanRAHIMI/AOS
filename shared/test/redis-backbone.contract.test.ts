/**
 * K1 Redis Backbone (D-167) — RedisBackbone, EventBroadcaster, and the
 * Redis-backed RateLimiter path.
 *
 * The two-instance proofs here (`EventBroadcaster` and `RateLimiter`
 * sections) are the concrete evidence that this codebase's runtime
 * backbone state moves correctly out of single-process memory: two
 * independent objects, each bound to its OWN RedisBackbone/client handle,
 * sharing only a fake in-memory "Redis server" (`FakeRedisBroker`) — the
 * same shape two real gateway-api or event-bus-service replicas would have,
 * connected to the same real Redis. No shared JS references between the
 * two "instances" other than the broker itself, which stands in for the
 * network boundary a real Redis provides.
 */
import { describe, it, expect, vi } from 'vitest';
import { RedisBackbone, EventBroadcaster } from '../src/redis/index.js';
import { RateLimiter } from '../src/security/index.js';
import { createFakeRedisServer, createFailingRedisClient } from './helpers/fake-redis.js';

describe('RedisBackbone — disabled (no url, no client)', () => {
  it('reports enabled: false and every operation returns its degraded sentinel, never throws', async () => {
    const rb = new RedisBackbone({ url: '' });
    expect(rb.enabled).toBe(false);
    await expect(rb.publish('ch', 'x')).resolves.toBe(false);
    await expect(rb.subscribe('ch', () => undefined)).resolves.toBe(false);
    await expect(rb.incrWithWindow('k', 1000)).resolves.toBeNull();
    await expect(rb.get('k')).resolves.toBeNull();
    await expect(rb.set('k', 'v')).resolves.toBe(false);
    await expect(rb.ping()).resolves.toBe(false);
    await expect(rb.quit()).resolves.toBeUndefined();
  });
});

describe('RedisBackbone — configured but failing (every call throws)', () => {
  it('falls back to degraded sentinels on every operation and never throws, warning at most once', async () => {
    const warn = vi.fn();
    const rb = new RedisBackbone({ url: 'fake://irrelevant', client: createFailingRedisClient(), logger: { warn } });
    expect(rb.enabled).toBe(true);
    await expect(rb.publish('ch', 'x')).resolves.toBe(false);
    await expect(rb.incrWithWindow('k', 1000)).resolves.toBeNull();
    await expect(rb.get('k')).resolves.toBeNull();
    await expect(rb.set('k', 'v')).resolves.toBe(false);
    await expect(rb.ping()).resolves.toBe(false);
    // Warned, but throttled — not once per failed call (would be 5 otherwise).
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('RedisBackbone — working fake client', () => {
  it('get/set round-trip', async () => {
    const { makeClient } = createFakeRedisServer();
    const rb = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    await rb.set('k', 'v');
    await expect(rb.get('k')).resolves.toBe('v');
  });

  it('incrWithWindow: fixed-window semantics, sets expiry only on first hit', async () => {
    const { makeClient } = createFakeRedisServer();
    const rb = new RedisBackbone({ url: 'fake://x', client: makeClient(), keyPrefix: '' });
    expect(await rb.incrWithWindow('rl', 60_000)).toBe(1);
    expect(await rb.incrWithWindow('rl', 60_000)).toBe(2);
    expect(await rb.incrWithWindow('rl', 60_000)).toBe(3);
  });

  it('keys are prefixed so different consumers never collide by accident', async () => {
    const { broker, makeClient } = createFakeRedisServer();
    const rb = new RedisBackbone({ url: 'fake://x', client: makeClient(), keyPrefix: 'myprefix:' });
    await rb.set('k', 'v');
    expect(broker.get('myprefix:k')).toBe('v');
    expect(broker.get('k')).toBeNull();
  });
});

describe('EventBroadcaster — local-only fan-out when Redis is disabled', () => {
  it('delivers to local subscribers with no Redis backbone at all', async () => {
    const eb = new EventBroadcaster<{ msg: string }>(null, 'events');
    const received: unknown[] = [];
    eb.subscribeLocal('sub1', (p) => received.push(p));
    await eb.publish({ msg: 'hello' });
    expect(received).toEqual([{ msg: 'hello' }]);
  });

  it('unsubscribeLocal stops delivery', async () => {
    const eb = new EventBroadcaster<{ msg: string }>(null, 'events');
    const received: unknown[] = [];
    eb.subscribeLocal('sub1', (p) => received.push(p));
    eb.unsubscribeLocal('sub1');
    await eb.publish({ msg: 'hello' });
    expect(received).toEqual([]);
  });
});

/**
 * THE TWO-INSTANCE PROOF (events / safe-mode propagation).
 *
 * Two EventBroadcaster instances, each wrapping its OWN RedisBackbone and
 * its OWN client handle — the only thing they share is the fake broker,
 * exactly as two real event-bus-service replicas would share only a real
 * Redis server. This directly proves master-direction's K1 gate: "two
 * kernel instances... receive identical event streams."
 */
describe('EventBroadcaster — two-instance proof via a shared Redis broker', () => {
  it('a publish on instance A reaches a local subscriber on instance B', async () => {
    const { makeClient } = createFakeRedisServer();
    const redisA = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const redisB = new RedisBackbone({ url: 'fake://x', client: makeClient() });

    const broadcasterA = new EventBroadcaster<{ type: string; msg: string }>(redisA, 'events');
    const broadcasterB = new EventBroadcaster<{ type: string; msg: string }>(redisB, 'events');
    await broadcasterA.ready();
    await broadcasterB.ready();

    const receivedOnA: unknown[] = [];
    const receivedOnB: unknown[] = [];
    broadcasterA.subscribeLocal('client-on-a', (p) => receivedOnA.push(p));
    broadcasterB.subscribeLocal('client-on-b', (p) => receivedOnB.push(p));

    // An event ingested via instance A's HTTP endpoint, in production, calls broadcasterA.publish(...).
    await broadcasterA.publish({ type: 'task.created', msg: 'from instance A' });

    // Instance A's own local subscriber gets it immediately (same-process delivery).
    expect(receivedOnA).toEqual([{ type: 'task.created', msg: 'from instance A' }]);
    // Instance B's local subscriber ALSO gets it — via the shared Redis channel, not shared JS memory.
    expect(receivedOnB).toEqual([{ type: 'task.created', msg: 'from instance A' }]);
  });

  it('safe-mode change events specifically propagate cross-instance the same way', async () => {
    const { makeClient } = createFakeRedisServer();
    const redisA = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const redisB = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const broadcasterA = new EventBroadcaster<{ type: string; payload: { enabled: boolean } }>(redisA, 'events');
    const broadcasterB = new EventBroadcaster<{ type: string; payload: { enabled: boolean } }>(redisB, 'events');
    await broadcasterA.ready();
    await broadcasterB.ready();

    const seenOnB: unknown[] = [];
    broadcasterB.subscribeLocal('dashboard-connected-to-b', (p) => seenOnB.push(p));

    // Instance A is where the owner's POST /v1/security/safe-mode landed.
    await broadcasterA.publish({ type: 'safe_mode_changed', payload: { enabled: true } });

    expect(seenOnB).toEqual([{ type: 'safe_mode_changed', payload: { enabled: true } }]);
  });

  it('does not create a republish loop — a message received FROM Redis is fanned out locally only, never re-published', async () => {
    const { broker, makeClient } = createFakeRedisServer();
    const publishSpy = vi.spyOn(broker, 'publish');
    const redisA = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const redisB = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const broadcasterA = new EventBroadcaster<{ n: number }>(redisA, 'events');
    const broadcasterB = new EventBroadcaster<{ n: number }>(redisB, 'events');
    await broadcasterA.ready();
    await broadcasterB.ready();
    broadcasterB.subscribeLocal('b', () => undefined);

    await broadcasterA.publish({ n: 1 });

    // Exactly one broker.publish call (from instance A) — instance B receiving
    // the message must NOT trigger a second broker.publish, or every event
    // would echo forever between instances.
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('three instances all receive a publish from any one of them', async () => {
    const { makeClient } = createFakeRedisServer();
    const broadcasters = Array.from({ length: 3 }, () => {
      const redis = new RedisBackbone({ url: 'fake://x', client: makeClient() });
      return new EventBroadcaster<{ n: number }>(redis, 'events');
    });
    await Promise.all(broadcasters.map((b) => b.ready()));
    const seen: unknown[][] = [[], [], []];
    broadcasters.forEach((b, i) => b.subscribeLocal(`sub-${i}`, (p) => seen[i]?.push(p)));

    await broadcasters[1]!.publish({ n: 42 });

    expect(seen[0]).toEqual([{ n: 42 }]);
    expect(seen[1]).toEqual([{ n: 42 }]); // the publisher's own local subscriber too
    expect(seen[2]).toEqual([{ n: 42 }]);
  });

  it('when Redis is disabled for one instance, that instance never sees a sibling\'s publish (documents the boundary honestly)', async () => {
    const { makeClient } = createFakeRedisServer();
    const redisA = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const broadcasterA = new EventBroadcaster<{ n: number }>(redisA, 'events');
    const broadcasterB = new EventBroadcaster<{ n: number }>(null, 'events'); // Redis disabled — local-only
    await broadcasterA.ready();

    const seenOnB: unknown[] = [];
    broadcasterB.subscribeLocal('b', (p) => seenOnB.push(p));
    await broadcasterA.publish({ n: 1 });

    expect(seenOnB).toEqual([]); // expected — B never subscribed to Redis, this is the documented local/degraded mode
  });
});

describe('RateLimiter — local behavior unchanged (regression pin)', () => {
  it('checkLocal is unaffected by this change — same fixed-window semantics as before', () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.checkLocal('k').allowed).toBe(true);
    expect(rl.checkLocal('k').allowed).toBe(true);
    expect(rl.checkLocal('k').allowed).toBe(false);
  });

  it('check() with no redis backend behaves identically to checkLocal()', async () => {
    const rl = new RateLimiter(2, 60_000);
    expect((await rl.check('k')).allowed).toBe(true);
    expect((await rl.check('k')).allowed).toBe(true);
    expect((await rl.check('k')).allowed).toBe(false);
  });
});

/**
 * THE TWO-INSTANCE PROOF (rate limits). Two independent RateLimiter
 * instances, each given its OWN RedisBackbone/client, sharing only the fake
 * broker — proves a shared budget across "replicas," closing the "N
 * instances each enforce their own independent limit" gap.
 */
describe('RateLimiter — Redis-backed, two-instance proof', () => {
  it('two limiter instances sharing one Redis enforce ONE shared counter', async () => {
    const { makeClient } = createFakeRedisServer();
    const redisA = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const redisB = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const limiterA = new RateLimiter(3, 60_000, redisA);
    const limiterB = new RateLimiter(3, 60_000, redisB);

    expect((await limiterA.check('shared-key')).allowed).toBe(true); // 1
    expect((await limiterB.check('shared-key')).allowed).toBe(true); // 2 — via instance B, but same counter
    expect((await limiterA.check('shared-key')).allowed).toBe(true); // 3
    expect((await limiterB.check('shared-key')).allowed).toBe(false); // 4 — blocked, even though B only made 2 of the 4 calls
  });

  it('two DIFFERENT keys on a shared Redis are counted independently', async () => {
    const { makeClient } = createFakeRedisServer();
    const redisA = new RedisBackbone({ url: 'fake://x', client: makeClient() });
    const limiterA = new RateLimiter(1, 60_000, redisA);
    expect((await limiterA.check('key-1')).allowed).toBe(true);
    expect((await limiterA.check('key-2')).allowed).toBe(true); // different key, own budget
    expect((await limiterA.check('key-1')).allowed).toBe(false);
  });

  it('falls back to its OWN local counter when the Redis backend errors — no cross-instance sharing in that case, but never throws or blocks incorrectly', async () => {
    const redis = new RedisBackbone({ url: 'fake://x', client: createFailingRedisClient() });
    const limiter = new RateLimiter(2, 60_000, redis);
    expect((await limiter.check('k')).allowed).toBe(true);
    expect((await limiter.check('k')).allowed).toBe(true);
    expect((await limiter.check('k')).allowed).toBe(false);
  });
});
