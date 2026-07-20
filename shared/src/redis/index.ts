/**
 * K1 Redis Backbone (D-167).
 *
 * A single, narrow interface (`RedisLike`) that both the real `ioredis`
 * client and test doubles implement, plus a null-safe wrapper
 * (`RedisBackbone`) that every consumer in this codebase talks to. The
 * wrapper NEVER throws: every operation is wrapped, logs once (not spam) on
 * failure, and returns a sentinel (`false`/`null`) the caller uses to fall
 * back to local/in-process behavior. Redis is optional infrastructure — a
 * blip or a misconfigured URL must degrade the system, never crash it.
 *
 * `EventBroadcaster<T>` is the reusable cross-instance fan-out primitive:
 * local subscribers always get zero-latency, same-process delivery; when
 * Redis is configured, publishes also go out on a Redis channel so sibling
 * instances' own local subscribers receive them too. See
 * services/event-bus-service/src/index.ts for the thin wiring, and
 * docs/service-communication-protocol.md for the full contract.
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { Logger } from '../logging/index.js';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
  ping(): Promise<string>;
  quit(): Promise<void>;
}

type MinimalLogger = Pick<Logger, 'warn'> | { warn: (obj: unknown, msg?: string) => void };

export interface RedisBackboneOptions {
  /** Empty string (the default) disables Redis entirely — local/degraded mode. */
  url: string;
  keyPrefix?: string;
  logger?: MinimalLogger;
  /** Test-only escape hatch: inject a fake RedisLike instead of connecting for real. */
  client?: RedisLike;
}

/**
 * Null-safe Redis wrapper. `enabled` reflects configuration, not live
 * connectivity — a configured-but-unreachable Redis still reports
 * `enabled: true` (it SHOULD be reachable) but every operation gracefully
 * falls back to its sentinel return value on failure rather than throwing.
 */
export class RedisBackbone {
  readonly enabled: boolean;
  private readonly client: RedisLike | null;
  private readonly keyPrefix: string;
  private readonly logger?: MinimalLogger;
  private warnedOnce = false;

  constructor(opts: RedisBackboneOptions) {
    this.keyPrefix = opts.keyPrefix ?? 'factory:';
    this.logger = opts.logger;
    this.enabled = Boolean(opts.url) || Boolean(opts.client);
    this.client = opts.client ?? (opts.url ? createIoredisClient(opts.url) : null);
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private warn(context: string, err: unknown): void {
    if (this.warnedOnce) return; // throttle — one warning per process is enough signal
    this.warnedOnce = true;
    this.logger?.warn({ err }, `[redis] ${context} failed — falling back to local/degraded behavior`);
  }

  async publish(channel: string, message: string): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      await this.client.publish(this.prefixed(channel), message);
      return true;
    } catch (err) {
      this.warn('publish', err);
      return false;
    }
  }

  /** Returns false if subscribing failed or Redis is disabled — caller stays local-only. */
  async subscribe(channel: string, onMessage: (message: string) => void): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      await this.client.subscribe(this.prefixed(channel), onMessage);
      return true;
    } catch (err) {
      this.warn('subscribe', err);
      return false;
    }
  }

  /**
   * Atomic fixed-window increment (INCR + PEXPIRE-on-first-hit). Returns
   * null when Redis is disabled or the call fails — the caller (RateLimiter)
   * must fall back to its local counter in that case, not treat null as 0.
   */
  async incrWithWindow(key: string, windowMs: number): Promise<number | null> {
    if (!this.enabled || !this.client) return null;
    try {
      const k = this.prefixed(key);
      const count = await this.client.incr(k);
      if (count === 1) await this.client.pexpire(k, windowMs);
      return count;
    } catch (err) {
      this.warn('incrWithWindow', err);
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.enabled || !this.client) return null;
    try {
      return await this.client.get(this.prefixed(key));
    } catch (err) {
      this.warn('get', err);
      return null;
    }
  }

  async set(key: string, value: string, ttlMs?: number): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      await this.client.set(this.prefixed(key), value, ttlMs);
      return true;
    } catch (err) {
      this.warn('set', err);
      return false;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch (err) {
      this.warn('ping', err);
      return false;
    }
  }

  async quit(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function createRedisBackbone(opts: RedisBackboneOptions): RedisBackbone {
  return new RedisBackbone(opts);
}

/**
 * Constructs a real ioredis-backed client. `lazyConnect: true` means
 * importing this module (or even instantiating the client) never opens a
 * socket by itself — the connection is only made on first real command,
 * inside `ensureConnected()` below, and only ever happens at all when a URL
 * was actually provided (RedisBackbone only calls this when `opts.url` is
 * truthy).
 */
function createIoredisClient(url: string): RedisLike {
  const cmd = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  let sub: Redis | null = null;
  const handlers = new Map<string, (message: string) => void>();
  let connected = false;

  const ensureConnected = async (): Promise<void> => {
    if (connected) return;
    await cmd.connect();
    connected = true;
  };

  return {
    async get(key) {
      await ensureConnected();
      return cmd.get(key);
    },
    async set(key, value, ttlMs) {
      await ensureConnected();
      if (ttlMs) await cmd.set(key, value, 'PX', ttlMs);
      else await cmd.set(key, value);
    },
    async incr(key) {
      await ensureConnected();
      return cmd.incr(key);
    },
    async pexpire(key, ttlMs) {
      await ensureConnected();
      await cmd.pexpire(key, ttlMs);
    },
    async del(key) {
      await ensureConnected();
      await cmd.del(key);
    },
    async publish(channel, message) {
      await ensureConnected();
      return cmd.publish(channel, message);
    },
    async subscribe(channel, onMessage) {
      await ensureConnected();
      if (!sub) {
        // duplicate() inherits lazyConnect — must connect before subscribe or
        // ioredis throws "Stream isn't writeable" with enableOfflineQueue:false.
        sub = cmd.duplicate();
        await sub.connect();
        sub.on('message', (ch: string, msg: string) => {
          handlers.get(ch)?.(msg);
        });
      }
      handlers.set(channel, onMessage);
      await sub.subscribe(channel);
    },
    async ping() {
      await ensureConnected();
      return cmd.ping();
    },
    async quit() {
      await cmd.quit().catch(() => undefined);
      await sub?.quit().catch(() => undefined);
    },
  };
}

/** Wire envelope for Redis-published events — see EventBroadcaster's origin-tagging note below. */
interface BroadcastEnvelope<T> {
  originId: string;
  payload: T;
}

/**
 * Cross-instance fan-out primitive. Local subscribers get zero-latency,
 * same-process delivery unconditionally; when `redis` is enabled, every
 * publish also goes out on a Redis channel, and messages arriving FROM
 * Redis are fanned out locally only (never re-published) — this is what
 * prevents an infinite republish loop across instances.
 *
 * Self-echo suppression: a real Redis client that is both publishing to and
 * subscribed to the same channel receives its own message back. Without
 * guarding against that, the publishing instance would double-deliver to
 * its own local subscribers (once from the direct local call in `publish`,
 * once again from its own Redis echo). Each instance tags its outgoing
 * messages with a random `originId` generated once at construction and
 * drops any incoming Redis message whose `originId` matches its own.
 */
export class EventBroadcaster<T> {
  private readonly local = new Map<string, (payload: T) => void>();
  private readonly originId = randomUUID();
  private redisReady: Promise<boolean>;

  constructor(
    private readonly redis: RedisBackbone | null,
    private readonly channel: string,
  ) {
    this.redisReady = this.redis
      ? this.redis.subscribe(this.channel, (message) => {
          try {
            const envelope = JSON.parse(message) as BroadcastEnvelope<T>;
            if (envelope.originId === this.originId) return; // our own echo — already delivered locally
            this.fanOutLocal(envelope.payload);
          } catch {
            /* malformed message from a foreign publisher — ignore, don't crash */
          }
        })
      : Promise.resolve(false);
  }

  subscribeLocal(id: string, handler: (payload: T) => void): void {
    this.local.set(id, handler);
  }

  unsubscribeLocal(id: string): void {
    this.local.delete(id);
  }

  get localSubscriberCount(): number {
    return this.local.size;
  }

  private fanOutLocal(payload: T): void {
    for (const [id, handler] of this.local) {
      try {
        handler(payload);
      } catch {
        this.local.delete(id);
      }
    }
  }

  /** Always delivers to local subscribers first (zero Redis dependency for same-instance delivery), then to Redis if configured. */
  async publish(payload: T): Promise<void> {
    this.fanOutLocal(payload);
    if (this.redis) {
      const envelope: BroadcastEnvelope<T> = { originId: this.originId, payload };
      await this.redis.publish(this.channel, JSON.stringify(envelope));
    }
  }

  /** Await this in tests/health checks to know whether the Redis subscription actually attached. */
  async ready(): Promise<boolean> {
    return this.redisReady;
  }
}
