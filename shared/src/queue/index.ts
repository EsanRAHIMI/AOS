/**
 * K1 BullMQ Task Queue (D-173) — reliable agent dispatch backbone.
 *
 * Additive, optional layer alongside the existing HTTP `PeerClient`/
 * `/.factory/task` dispatch (untouched — see `../discovery/index.ts`). Reuses
 * `REDIS_URL` from K1 Redis Backbone (D-167): unset means queue features are
 * fully disabled and callers must fall back to HTTP, exactly like
 * `RedisBackbone`'s own degrade-not-crash contract. Mongo (`agent_job_runs`)
 * remains the durable system of record for job lifecycle; BullMQ/Redis is
 * the delivery/retry/concurrency mechanism, not the source of truth.
 *
 * Two independent guarantees work together:
 *  1. BullMQ's own Redis-lock-based delivery: while a worker holds a job's
 *     lock, no other worker in the same consumer group can pick it up. This
 *     is BullMQ's core competency and the primary "don't double-process"
 *     mechanism under normal operation.
 *  2. A Mongo atomic claim (`claimJobRun`, `findOneAndUpdate` guarded by
 *     current status) as a second, independent guard for the specific case
 *     BullMQ itself documents as at-least-once, not exactly-once: a worker
 *     that crashes AFTER completing side effects but BEFORE its lock
 *     renewal/ack is recorded can have its "stalled" job handed to another
 *     worker. `claimJobRun` only succeeds once per job; a second claim
 *     attempt against an already-claimed/running/succeeded row is a no-op,
 *     so the handler is never invoked twice even in that edge case.
 *
 * Idempotency is enforced at ENQUEUE time via `idempotencyKey`: BullMQ's own
 * `jobId` dedup prevents a duplicate `add()` while the job is still
 * waiting/active/delayed, and `enqueueJobRun`'s Mongo check additionally
 * catches the case where the original job already finished (so BullMQ's own
 * jobId is free again) but the caller is honestly re-submitting the same
 * logical request.
 */
import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { collection } from '../db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import type { TaskRequest } from '../schemas/task.js';

export const AGENT_JOB_STATUSES = [
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'retrying',
  'dead_lettered',
  'cancelled',
] as const;
export type AgentJobRunStatus = (typeof AGENT_JOB_STATUSES)[number];

/** Job-level lifecycle record — fine-grained, separate from `Task.status`. */
export interface AgentJobRun {
  jobRunId: string;
  taskId: string | null;
  serviceId: string;
  idempotencyKey: string;
  bullJobId: string | null;
  status: AgentJobRunStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  result: unknown;
  workerInstanceId: string | null;
  queuedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export function agentQueueName(serviceId: string): string {
  // BullMQ v5 rejects queue names containing ':' (it is BullMQ's own Redis
  // key separator — `bull:<name>:<id>`), so the serviceId is joined with '.'
  // instead. Caught by the first real-Redis run of the D-173 integration
  // suite; the fake-db tier could never see this because the validation
  // lives in BullMQ's Queue/Worker constructors.
  return `agent-tasks.${serviceId}`;
}

export function defaultIdempotencyKey(serviceId: string, taskId: string | null | undefined): string {
  return `${serviceId}:${taskId ?? genId('adhoc')}`;
}

/**
 * BullMQ v5 rejects custom job ids containing ':' (its own Redis key
 * separator). The idempotencyKey remains the domain-level identity stored in
 * Mongo verbatim; this deterministic mapping is applied ONLY at the BullMQ
 * boundary (enqueue/replay jobIds), so the same key always yields the same
 * jobId and BullMQ's jobId-dedup guarantee is preserved. Caught by the first
 * real-Redis run of the D-173 integration suite (`Custom Id cannot contain :`).
 */
export function toBullJobId(idempotencyKey: string): string {
  return idempotencyKey.replaceAll(':', '.');
}

/**
 * A dedicated ioredis connection for BullMQ. Deliberately NOT the same
 * `RedisBackbone` client used for pub/sub/rate-limiting (D-167) — BullMQ
 * requires `maxRetriesPerRequest: null` and its own blocking-command
 * semantics, which would be the wrong configuration for that lighter client.
 * Returns null when `redisUrl` is empty — the caller must treat that as
 * "queue disabled, use HTTP fallback," never throw.
 */
export function queueConnectionFromEnv(redisUrl: string): ConnectionOptions | null {
  if (!redisUrl) return null;
  return new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true }) as unknown as ConnectionOptions;
}

// ---------------------------------------------------------------------------
// Pure Mongo state-machine transitions — independently unit-testable against
// a fake db, with no BullMQ/Redis dependency. Each returns the updated
// AgentJobRun (or null if the guarded transition didn't match, e.g. a
// duplicate claim).
// ---------------------------------------------------------------------------

export interface EnqueueArgs {
  serviceId: string;
  taskRequest: TaskRequest;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface EnqueueOutcome {
  jobRunId: string;
  idempotencyKey: string;
  duplicate: boolean;
}

/** Insert a new `queued` AgentJobRun, or return the existing one if this idempotencyKey is already in flight/done. */
export async function enqueueJobRun(args: EnqueueArgs, publish?: Publish): Promise<EnqueueOutcome> {
  const idempotencyKey = args.idempotencyKey ?? defaultIdempotencyKey(args.serviceId, args.taskRequest.taskId);
  const jobRuns = collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS);
  const existing = await jobRuns.findOne({ idempotencyKey, status: { $nin: ['failed', 'cancelled'] } as never });
  if (existing) return { jobRunId: existing.jobRunId, idempotencyKey, duplicate: true };

  const now = nowIso();
  const jobRunId = genId('jobrun');
  const run: AgentJobRun = {
    jobRunId,
    taskId: args.taskRequest.taskId ?? null,
    serviceId: args.serviceId,
    idempotencyKey,
    bullJobId: null,
    status: 'queued',
    attempts: 0,
    maxAttempts: args.maxAttempts ?? 3,
    lastError: null,
    result: null,
    workerInstanceId: null,
    queuedAt: now,
    claimedAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await jobRuns.insertOne(run);
  await publish?.({ type: EVENT_TYPES.AGENT_JOB_QUEUED, taskId: run.taskId, payload: { jobRunId, serviceId: args.serviceId, idempotencyKey } });
  return { jobRunId, idempotencyKey, duplicate: false };
}

/** Record the real BullMQ jobId once `queue.add()` returns (best-effort correlation, not load-bearing). */
export async function recordBullJobId(jobRunId: string, bullJobId: string): Promise<void> {
  await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).updateOne({ jobRunId }, { $set: { bullJobId, updatedAt: nowIso() } });
}

/** Atomic claim: only succeeds from `queued` or `retrying`. Returns null if another worker already claimed it. */
export async function claimJobRun(jobRunId: string, workerInstanceId: string): Promise<AgentJobRun | null> {
  const now = nowIso();
  const res = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOneAndUpdate(
    { jobRunId, status: { $in: ['queued', 'retrying'] } as never },
    { $set: { status: 'claimed', claimedAt: now, workerInstanceId, updatedAt: now } },
    { returnDocument: 'after' },
  );
  return res ?? null;
}

export async function markRunning(jobRunId: string, publish?: Publish): Promise<void> {
  const now = nowIso();
  const res = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOneAndUpdate(
    { jobRunId },
    { $set: { status: 'running', startedAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (res) await publish?.({ type: EVENT_TYPES.AGENT_JOB_STARTED, taskId: res.taskId, payload: { jobRunId, serviceId: res.serviceId } });
}

export async function markSucceeded(jobRunId: string, result: unknown, publish?: Publish): Promise<void> {
  const now = nowIso();
  const res = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOneAndUpdate(
    { jobRunId },
    { $set: { status: 'succeeded', result, finishedAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (res) await publish?.({ type: EVENT_TYPES.AGENT_JOB_SUCCEEDED, taskId: res.taskId, payload: { jobRunId, serviceId: res.serviceId } });
}

export interface FailureOutcome {
  status: 'retrying' | 'dead_lettered';
  attempts: number;
}

/**
 * Increment attempts and transition to `retrying` (more attempts remain) or
 * `dead_lettered` (exhausted) — the caller (the BullMQ worker's 'failed'
 * listener) decides which based on BullMQ's own `job.attemptsMade` vs
 * `job.opts.attempts`, passed in as `exhausted`, so this function never has
 * to guess at BullMQ's retry state independently.
 */
export async function markFailed(jobRunId: string, error: string, exhausted: boolean, publish?: Publish): Promise<FailureOutcome> {
  const now = nowIso();
  const status: AgentJobRunStatus = exhausted ? 'dead_lettered' : 'retrying';
  const res = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOneAndUpdate(
    { jobRunId },
    { $set: { status, lastError: error, updatedAt: now, ...(exhausted ? { finishedAt: now } : {}) }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (res) {
    await publish?.({
      type: exhausted ? EVENT_TYPES.AGENT_JOB_DEAD_LETTERED : EVENT_TYPES.AGENT_JOB_RETRYING,
      taskId: res.taskId,
      payload: { jobRunId, serviceId: res.serviceId, attempts: res.attempts, error, level: 'warn' },
    });
  }
  return { status, attempts: res?.attempts ?? 0 };
}

/**
 * Cancel a job. Best-effort for a job already executing: BullMQ cannot
 * force-kill an in-flight processor without additional infrastructure, so an
 * `active` job may still complete after this call — documented honestly, not
 * fabricated as instant. Queued/delayed jobs are removed from BullMQ by the
 * caller (`AgentTaskQueueClient.cancel`) before this Mongo transition.
 */
export async function markCancelled(jobRunId: string, publish?: Publish): Promise<AgentJobRun | null> {
  const now = nowIso();
  const res = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOneAndUpdate(
    { jobRunId, status: { $nin: ['succeeded', 'dead_lettered', 'cancelled'] } as never },
    { $set: { status: 'cancelled', finishedAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (res) await publish?.({ type: EVENT_TYPES.AGENT_JOB_CANCELLED, taskId: res.taskId, payload: { jobRunId, serviceId: res.serviceId } });
  return res ?? null;
}

export async function getJobRun(jobRunId: string): Promise<AgentJobRun | null> {
  return collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOne({ jobRunId });
}

export async function listDeadLetters(serviceId: string): Promise<AgentJobRun[]> {
  return collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS)
    .find({ serviceId, status: 'dead_lettered' })
    .sort({ updatedAt: -1 })
    .toArray();
}

const TERMINAL_JOB_STATUSES = new Set<AgentJobRunStatus>(['succeeded', 'failed', 'dead_lettered', 'cancelled']);

/**
 * K1 BullMQ Producer Adoption (D-174) — poll Mongo until a job run reaches a
 * terminal state, or the timeout elapses. Used ONLY by callers that need a
 * queue-mode dispatch to behave like today's synchronous, sequential-await
 * `peer.dispatchTask()` call within a background pipeline step (see
 * `shared/src/dispatch/index.ts`'s `waitForCompletion` option) — never used
 * by fire-and-forget producers (gateway's own task creation), which return
 * as soon as the job is queued, exactly like today's HTTP forward-and-forget.
 * Pure Mongo polling — no BullMQ/Redis dependency of its own, independently
 * testable against a fake db. Returns null on timeout; the caller decides
 * what "no answer yet" means (typically: fall back to HTTP, per D-174).
 */
export async function waitForJobRun(
  jobRunId: string,
  opts: { timeoutMs: number; pollMs?: number },
): Promise<AgentJobRun | null> {
  const pollMs = opts.pollMs ?? 250;
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const run = await getJobRun(jobRunId);
    if (run && TERMINAL_JOB_STATUSES.has(run.status)) return run;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// ---------------------------------------------------------------------------
// Producer — BullMQ-backed, degrades to `{ enqueued: false }` when disabled.
// ---------------------------------------------------------------------------

export interface AgentTaskQueueClientOptions {
  redisUrl: string;
  maxAttempts?: number;
  backoffMs?: number;
  publish?: Publish;
}

export interface EnqueueResult {
  enqueued: boolean;
  duplicate: boolean;
  jobRunId: string | null;
  bullJobId: string | null;
  reason?: string;
}

export class AgentTaskQueueClient {
  readonly enabled: boolean;
  private readonly connection: ConnectionOptions | null;
  private readonly queues = new Map<string, Queue>();
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly publish?: Publish;

  constructor(opts: AgentTaskQueueClientOptions) {
    this.connection = queueConnectionFromEnv(opts.redisUrl);
    this.enabled = this.connection !== null;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 2000;
    this.publish = opts.publish;
  }

  private queueFor(serviceId: string): Queue {
    let q = this.queues.get(serviceId);
    if (!q) {
      q = new Queue(agentQueueName(serviceId), { connection: this.connection as ConnectionOptions });
      this.queues.set(serviceId, q);
    }
    return q;
  }

  /** Honest degraded behavior: returns `{enqueued:false, reason:'redis_disabled'}` — caller must fall back to HTTP dispatch. */
  async enqueue(serviceId: string, taskRequest: TaskRequest, opts?: { idempotencyKey?: string }): Promise<EnqueueResult> {
    if (!this.enabled) return { enqueued: false, duplicate: false, jobRunId: null, bullJobId: null, reason: 'redis_disabled' };
    const outcome = await enqueueJobRun({ serviceId, taskRequest, idempotencyKey: opts?.idempotencyKey, maxAttempts: this.maxAttempts }, this.publish);
    if (outcome.duplicate) return { enqueued: false, duplicate: true, jobRunId: outcome.jobRunId, bullJobId: null, reason: 'duplicate_idempotency_key' };

    const job = await this.queueFor(serviceId).add('task', taskRequest, {
      jobId: toBullJobId(outcome.idempotencyKey),
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: false, // keep failed jobs for DLQ inspection until explicitly replayed
    });
    await recordBullJobId(outcome.jobRunId, job.id ?? toBullJobId(outcome.idempotencyKey));
    return { enqueued: true, duplicate: false, jobRunId: outcome.jobRunId, bullJobId: job.id ?? null };
  }

  /**
   * Best-effort cancel: removes the BullMQ job if still waiting/delayed,
   * always attempts the Mongo transition. Skips the BullMQ call entirely
   * when this client is disabled (REDIS_URL unset) or the run never got a
   * real bullJobId (e.g. it was only ever dispatched over HTTP) — touching
   * `this.queueFor(...)` in that state would try to open a live Redis
   * connection with `connection: null` and fail ungracefully. K1 BullMQ
   * Producer Adoption (D-174): this is what lets the DLQ ops route
   * (routes/agent-jobs.ts) call cancel() safely regardless of dispatch mode.
   */
  async cancel(serviceId: string, jobRunId: string): Promise<AgentJobRun | null> {
    const run = await getJobRun(jobRunId);
    if (this.enabled && run?.bullJobId) {
      const job = await this.queueFor(serviceId).getJob(run.bullJobId).catch(() => null);
      await job?.remove().catch(() => undefined);
    }
    return markCancelled(jobRunId, this.publish);
  }

  /**
   * Re-enqueue a dead-lettered job with a fresh attempt budget. Same
   * disabled-client guard as cancel() above — a job can only be
   * dead_lettered if it was actually processed through BullMQ, which means
   * `this.enabled` was true when it was dead-lettered, but the client
   * replaying it later (e.g. from an operational script or a redeployed
   * gateway) may have since had REDIS_URL removed; fail honestly instead of
   * attempting a live Queue.add() with no connection.
   */
  async replayDeadLetter(serviceId: string, jobRunId: string): Promise<EnqueueResult> {
    if (!this.enabled) return { enqueued: false, duplicate: false, jobRunId, bullJobId: null, reason: 'redis_disabled' };
    const run = await getJobRun(jobRunId);
    if (!run || run.status !== 'dead_lettered') return { enqueued: false, duplicate: false, jobRunId, bullJobId: null, reason: 'not_dead_lettered' };
    const now = nowIso();
    await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).updateOne(
      { jobRunId },
      { $set: { status: 'queued', attempts: 0, lastError: null, queuedAt: now, claimedAt: null, startedAt: null, finishedAt: null, updatedAt: now } },
    );
    // Fresh BullMQ jobId (the original may still be retained for DLQ history) — same idempotencyKey, new attempt.
    const job = await this.queueFor(serviceId).add('task', { taskId: run.taskId, goal: '', input: {}, priority: 'normal' } as TaskRequest, {
      jobId: toBullJobId(`${run.idempotencyKey}.replay.${genId('r')}`),
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
    });
    await recordBullJobId(jobRunId, job.id ?? toBullJobId(run.idempotencyKey));
    return { enqueued: true, duplicate: false, jobRunId, bullJobId: job.id ?? null };
  }

  async close(): Promise<void> {
    for (const q of this.queues.values()) await q.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Consumer — one BullMQ Worker per serviceId, wired directly to that
// worker's existing in-process task handler (no HTTP hop for same-process
// consolidated workers). Generic over the caller's own context shape so this
// module never has to depend on @factory/service-kit's ServiceContext type.
// ---------------------------------------------------------------------------

export type QueueTaskHandler<TCtx> = (req: TaskRequest, ctx: TCtx) => Promise<{ taskId: string; accepted: boolean; [k: string]: unknown }>;

export interface CreateAgentTaskWorkerOptions<TCtx> {
  serviceId: string;
  redisUrl: string;
  handler: QueueTaskHandler<TCtx>;
  ctx: TCtx;
  concurrency?: number;
  timeoutMs?: number;
  workerInstanceId?: string;
  publish?: Publish;
}

export interface AgentTaskWorkerHandle {
  enabled: boolean;
  close: () => Promise<void>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`job timed out after ${ms}ms`)), ms);
      // Don't hold the process open just for this timer.
      (t as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
}

export function createAgentTaskWorker<TCtx>(opts: CreateAgentTaskWorkerOptions<TCtx>): AgentTaskWorkerHandle {
  const connection = queueConnectionFromEnv(opts.redisUrl);
  if (!connection) return { enabled: false, close: async () => undefined };

  const workerInstanceId = opts.workerInstanceId ?? genId('worker');
  const timeoutMs = opts.timeoutMs ?? 30000;
  const publish = opts.publish;

  const processor = async (job: Job): Promise<unknown> => {
    // BullMQ's jobId is `toBullJobId(idempotencyKey)` (see AgentTaskQueueClient.enqueue),
    // but the AgentJobRun row is looked up by matching bullJobId, since the
    // worker only has the BullMQ job, not the jobRunId directly.
    const run = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOne({ bullJobId: job.id ?? '' });
    if (!run) {
      // No Mongo record (e.g. a raw job added outside enqueueJobRun) — still
      // execute it (never silently drop real work), just without lifecycle tracking.
      return opts.handler(job.data as TaskRequest, opts.ctx);
    }

    const claimed = await claimJobRun(run.jobRunId, workerInstanceId);
    if (!claimed) {
      // Already claimed/running/finished by another worker (stalled-job
      // handoff race) — do NOT re-execute the handler. Treat as a no-op
      // success so BullMQ doesn't retry a job someone else already handled.
      await publish?.({ type: EVENT_TYPES.AGENT_JOB_CLAIMED, taskId: run.taskId, payload: { jobRunId: run.jobRunId, serviceId: run.serviceId, skipped: true, level: 'warn' } });
      return { taskId: run.taskId ?? '', accepted: true, skippedDuplicateClaim: true };
    }
    await publish?.({ type: EVENT_TYPES.AGENT_JOB_CLAIMED, taskId: run.taskId, payload: { jobRunId: run.jobRunId, serviceId: run.serviceId, workerInstanceId } });
    await markRunning(run.jobRunId, publish);

    try {
      const result = await withTimeout(opts.handler(job.data as TaskRequest, opts.ctx), timeoutMs);
      await markSucceeded(run.jobRunId, result, publish);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Let the caller (worker.on('failed')) decide retrying vs dead_lettered —
      // it knows job.attemptsMade vs job.opts.attempts, this function doesn't.
      throw new Error(message);
    }
  };

  const worker = new Worker(agentQueueName(opts.serviceId), processor, {
    connection: connection as ConnectionOptions,
    concurrency: opts.concurrency ?? 4,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    void (async () => {
      const run = await collection<AgentJobRun>(COLLECTIONS.AGENT_JOB_RUNS).findOne({ bullJobId: job.id ?? '' });
      if (!run) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      await markFailed(run.jobRunId, err.message, exhausted, publish);
    })();
  });

  return {
    enabled: true,
    close: async () => {
      await worker.close();
    },
  };
}
