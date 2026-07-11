/**
 * K1 BullMQ Producer Adoption (D-174) — mode-aware dispatch helper.
 *
 * A single, generic implementation of the http / queue_with_http_fallback /
 * queue_only branching described in decision-log D-174, so gateway-api's 4
 * gateway→orchestrator call sites and orchestrator-agent's 1 orchestrator→
 * architect-agent call site don't each duplicate this logic. Returns a
 * `PeerDispatchResult`-shaped object (same `{ok, status, data?, error?}`
 * contract every existing `peer.dispatchTask()` caller already checks)
 * PLUS `dispatchMode`, so call sites keep working with zero changes to their
 * own result-handling logic while gaining the ability to record which path
 * actually ran.
 *
 * This module deliberately does NOT touch `shared/src/queue/index.ts` (the
 * D-173 queue primitives) or `shared/src/discovery/index.ts` (the HTTP
 * PeerClient) — it only composes them. Both remain independently correct
 * and independently tested.
 */
import type { PeerDispatchResult } from '../discovery/index.js';
import type { TaskRequest } from '../schemas/task.js';
import { AgentTaskQueueClient, waitForJobRun, type AgentJobRun } from '../queue/index.js';
import { EVENT_TYPES } from '../constants/index.js';

export type AgentDispatchMode = 'http' | 'queue_with_http_fallback' | 'queue_only';

export type ActualDispatchMode = 'queue' | 'http' | 'http_fallback';

export interface DispatchOutcome<T = unknown> extends PeerDispatchResult<T> {
  dispatchMode: ActualDispatchMode;
  jobRunId?: string;
}

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export interface DispatchViaQueueOrHttpArgs<T = Record<string, unknown>> {
  serviceId: string;
  body: TaskRequest;
  mode: AgentDispatchMode;
  /** null when Redis isn't configured for this process at all. */
  queueClient: AgentTaskQueueClient | null;
  /**
   * The fallback (or sole, in `http` mode) transport. A plain callback
   * rather than requiring `PeerClient` specifically, so each caller keeps
   * its OWN existing URL-resolution behavior verbatim — e.g. gateway-api's
   * registry-domain-then-peerUrl() precedence (`orchestrator?.domain ??
   * peerUrl(...)`) is untouched, not silently narrowed to PeerClient's
   * simpler env-var-or-localhost-only resolution.
   */
  httpDispatch: () => Promise<PeerDispatchResult<T>>;
  /**
   * When set, the queue path waits (bounded by `timeoutMs`) for the
   * `AgentJobRun` to reach a terminal state and returns THAT as the result,
   * instead of returning immediately once queued. This is what lets a
   * queue-mode dispatch stand in for today's sequential-awaited
   * `peer.dispatchTask()` call inside a background pipeline step (e.g.
   * orchestrator's architect-agent delegation) without changing the
   * caller's control flow. Omit for fire-and-forget producers (e.g.
   * gateway's own task creation), which return as soon as the job is
   * queued — exactly like today's HTTP forward-and-forget.
   */
  waitForCompletion?: { timeoutMs: number; pollMs?: number };
  /** Called whenever a queue-capable mode could not use the queue and fell
   *  back to HTTP — the caller (gateway/orchestrator) uses this to publish
   *  AGENT_DISPATCH_DEGRADED, satisfying "never a silent fallback". */
  publish?: Publish;
}

function jobRunToDispatchResult<T>(run: AgentJobRun): PeerDispatchResult<T> {
  if (run.status === 'succeeded') return { ok: true, status: 200, data: run.result as T };
  return { ok: false, status: run.status === 'cancelled' ? 499 : 500, error: run.lastError ?? `job ${run.status}` };
}

async function degradeToHttp<T>(
  args: DispatchViaQueueOrHttpArgs<T>,
  reason: string,
): Promise<DispatchOutcome<T>> {
  await args.publish?.({
    type: EVENT_TYPES.AGENT_DISPATCH_DEGRADED,
    taskId: args.body.taskId ?? null,
    payload: { serviceId: args.serviceId, reason, message: `Queue dispatch degraded to HTTP: ${reason}`, level: 'warn' },
  });
  const res = await args.httpDispatch();
  return { ...res, dispatchMode: 'http_fallback' };
}

/**
 * Dispatch a task per `AGENT_DISPATCH_MODE`. See module doc comment above
 * and decision-log D-174 for the full mode semantics.
 */
export async function dispatchViaQueueOrHttp<T = Record<string, unknown>>(
  args: DispatchViaQueueOrHttpArgs<T>,
): Promise<DispatchOutcome<T>> {
  const { mode, queueClient, serviceId, body } = args;

  if (mode === 'http' || !queueClient) {
    // `http` is the explicit default: byte-identical to pre-D-174 behavior,
    // the queue code path below is never even entered. `queue_only` with no
    // queueClient configured at all (REDIS_URL unset) must still fail loudly
    // rather than silently behave like `http`.
    if (mode === 'queue_only' && !queueClient) {
      return { ok: false, status: 0, error: 'queue_only mode requires a configured queueClient (REDIS_URL unset)', dispatchMode: 'queue' };
    }
    const res = await args.httpDispatch();
    return { ...res, dispatchMode: 'http' };
  }

  if (!queueClient.enabled) {
    if (mode === 'queue_only') {
      return { ok: false, status: 0, error: 'redis_disabled', dispatchMode: 'queue' };
    }
    return degradeToHttp<T>(args, 'redis_disabled');
  }

  try {
    const enq = await queueClient.enqueue(serviceId, body);

    if (!enq.enqueued && !enq.duplicate) {
      if (mode === 'queue_only') return { ok: false, status: 0, error: enq.reason ?? 'enqueue_failed', dispatchMode: 'queue' };
      return degradeToHttp<T>(args, enq.reason ?? 'enqueue_failed');
    }

    // Duplicate = idempotent no-op (the exact same task/idempotency key is
    // already in flight or done) — correctly reported as accepted, not an
    // error, matching AgentTaskQueueClient's own idempotency contract.
    if (enq.duplicate) {
      return { ok: true, status: 200, data: { jobRunId: enq.jobRunId ?? undefined, duplicate: true } as T, dispatchMode: 'queue', jobRunId: enq.jobRunId ?? undefined };
    }

    if (!args.waitForCompletion) {
      return { ok: true, status: 202, data: { jobRunId: enq.jobRunId ?? undefined, accepted: true } as T, dispatchMode: 'queue', jobRunId: enq.jobRunId ?? undefined };
    }

    const finalRun = enq.jobRunId ? await waitForJobRun(enq.jobRunId, args.waitForCompletion) : null;
    if (!finalRun) {
      // Timed out waiting for a terminal state (worker never claimed it,
      // still retrying past the wait window, etc.) — NOT necessarily a
      // queue failure, but the caller needs an answer now.
      if (mode === 'queue_only') return { ok: false, status: 0, error: 'job_run_wait_timeout', dispatchMode: 'queue', jobRunId: enq.jobRunId ?? undefined };
      return degradeToHttp<T>(args, 'job_run_wait_timeout');
    }
    return { ...jobRunToDispatchResult<T>(finalRun), dispatchMode: 'queue', jobRunId: enq.jobRunId ?? undefined };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'queue_dispatch_threw';
    if (mode === 'queue_only') return { ok: false, status: 0, error: reason, dispatchMode: 'queue' };
    return degradeToHttp<T>(args, reason);
  }
}
