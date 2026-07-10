/**
 * K1 Redis Backbone (D-167) — hand-rolled in-memory Redis test double,
 * mirroring the codebase's established convention (see
 * services/gateway-api/test/helpers/fake-db.ts) of a small, fully-understood
 * fake over a third-party mock library. `FakeRedisBroker` is the shared
 * "server" state; each `FakeRedisClient` bound to the SAME broker simulates
 * an independent connection from a different process to one real Redis
 * instance — this is what makes a genuine two-instance proof possible
 * without a real Redis server (unavailable in this sandbox — no root/Docker
 * to run redis-server; see decision-log D-167).
 */
import type { RedisLike } from '../../src/redis/index.js';

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

export class FakeRedisBroker {
  private store = new Map<string, StoredValue>();
  private channels = new Map<string, Set<(message: string) => void>>();

  private isExpired(v: StoredValue): boolean {
    return v.expiresAt !== null && v.expiresAt <= Date.now();
  }

  get(key: string): string | null {
    const v = this.store.get(key);
    if (!v || this.isExpired(v)) {
      this.store.delete(key);
      return null;
    }
    return v.value;
  }

  set(key: string, value: string, ttlMs?: number): void {
    this.store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  }

  incr(key: string): number {
    const current = this.get(key);
    const next = (current ? Number(current) : 0) + 1;
    const existing = this.store.get(key);
    const keepExpiry = existing && !this.isExpired(existing) ? existing.expiresAt : null;
    this.store.set(key, { value: String(next), expiresAt: keepExpiry });
    return next;
  }

  pexpire(key: string, ttlMs: number): void {
    const v = this.store.get(key);
    if (v) v.expiresAt = Date.now() + ttlMs;
  }

  del(key: string): void {
    this.store.delete(key);
  }

  /** Synchronous delivery — deterministic for tests; real Redis is async but the fan-out contract doesn't depend on that timing. */
  publish(channel: string, message: string): number {
    const subs = this.channels.get(channel);
    if (!subs || subs.size === 0) return 0;
    for (const cb of [...subs]) cb(message);
    return subs.size;
  }

  subscribe(channel: string, cb: (message: string) => void): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }
}

/** One handle bound to a shared broker — mirrors a real Redis client connection. */
export class FakeRedisClient implements RedisLike {
  private unsubscribers: Array<() => void> = [];
  constructor(private readonly broker: FakeRedisBroker) {}

  async get(key: string): Promise<string | null> {
    return this.broker.get(key);
  }
  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.broker.set(key, value, ttlMs);
  }
  async incr(key: string): Promise<number> {
    return this.broker.incr(key);
  }
  async pexpire(key: string, ttlMs: number): Promise<void> {
    this.broker.pexpire(key, ttlMs);
  }
  async del(key: string): Promise<void> {
    this.broker.del(key);
  }
  async publish(channel: string, message: string): Promise<number> {
    return this.broker.publish(channel, message);
  }
  async subscribe(channel: string, onMessage: (message: string) => void): Promise<void> {
    this.unsubscribers.push(this.broker.subscribe(channel, onMessage));
  }
  async ping(): Promise<string> {
    return 'PONG';
  }
  async quit(): Promise<void> {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }
}

/** A fresh broker ("one Redis server") plus a factory for independent client handles ("N processes connecting to it"). */
export function createFakeRedisServer(): { broker: FakeRedisBroker; makeClient: () => FakeRedisClient } {
  const broker = new FakeRedisBroker();
  return { broker, makeClient: () => new FakeRedisClient(broker) };
}

/** A client bound to a broker THAT ALWAYS FAILS — for exercising RedisBackbone's degraded-fallback paths. */
export function createFailingRedisClient(): RedisLike {
  const fail = () => {
    throw new Error('simulated redis failure');
  };
  return {
    get: async () => fail(),
    set: async () => fail(),
    incr: async () => fail(),
    pexpire: async () => fail(),
    del: async () => fail(),
    publish: async () => fail(),
    subscribe: async () => fail(),
    ping: async () => fail(),
    quit: async () => undefined,
  };
}
