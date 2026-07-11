/**
 * K1 BullMQ Producer Adoption (D-174) — agent-jobs route group (DLQ
 * operational surface: list dead letters, inspect, replay, cancel).
 *
 * REDIS_URL is unset in the test harness (see helpers/build-app.ts), so
 * `agentQueueClient.enabled` is false — replay/cancel exercise the
 * disabled-client guard added in shared/src/queue/index.ts (D-174) rather
 * than a real BullMQ round-trip. That guard, the RBAC gate, the safe-mode
 * gate, and the audit-log write are exactly what this route group is
 * required to prove; the real-Redis enqueue/remove path is proven by
 * shared/test/queue.bullmq-integration.contract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { COLLECTIONS } from '@factory/shared';
import { buildTestGateway, asAdmin } from './helpers/build-app.js';

const seedDeadLetter = (overrides: Partial<Record<string, unknown>> = {}) => ({
  jobRunId: 'jr_dlq_1',
  taskId: 'task_1',
  serviceId: 'architect-agent',
  idempotencyKey: 'architect-agent:task_1',
  bullJobId: 'bull_1',
  status: 'dead_lettered',
  attempts: 3,
  maxAttempts: 3,
  lastError: 'boom: architect timed out',
  result: null,
  workerInstanceId: null,
  queuedAt: 'x', claimedAt: 'x', startedAt: 'x', finishedAt: 'x',
  createdAt: 'x', updatedAt: 'x',
  ...overrides,
});

describe('GET /v1/agent-jobs/dead-letters', () => {
  it('requires auth', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/agent-jobs/dead-letters?serviceId=architect-agent' });
    expect(res.statusCode).toBe(401);
    await h.close();
  });

  it('requires a serviceId query param', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/agent-jobs/dead-letters', headers: asAdmin() });
    expect(res.statusCode).toBe(400);
    await h.close();
  });

  it('lists only dead letters for the requested serviceId', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(
        seedDeadLetter(),
        seedDeadLetter({ jobRunId: 'jr_dlq_2', serviceId: 'memory-agent' }),
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/agent-jobs/dead-letters?serviceId=architect-agent', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ jobRunId: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].jobRunId).toBe('jr_dlq_1');
    await h.close();
  });
});

describe('GET /v1/agent-jobs/:jobRunId', () => {
  it('404s for a job run that does not exist', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/agent-jobs/does-not-exist', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    await h.close();
  });

  it('returns the full job run, including lastError, for inspection', async () => {
    const h = await buildTestGateway({}, (db) => { db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter()); });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/agent-jobs/jr_dlq_1', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.lastError).toBe('boom: architect timed out');
    await h.close();
  });
});

describe('POST /v1/agent-jobs/:jobRunId/replay', () => {
  it('a viewer cannot replay (403 forbidden, RBAC-gated via manage_agent_jobs)', async () => {
    const h = await buildTestGateway({}, (db) => { db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter()); });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/jr_dlq_1/replay', headers: asAdmin('viewer') });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    await h.close();
  });

  it('is blocked in safe mode (403 safe_mode_blocked), even for an owner', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter());
      db.col(COLLECTIONS.SYSTEM_SETTINGS).docs.push({ settingId: 'safe_mode', value: true, updatedAt: 'x' });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/jr_dlq_1/replay', headers: asAdmin() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('safe_mode_blocked');
    await h.close();
  });

  it('404s for a job run that does not exist', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/does-not-exist/replay', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    await h.close();
  });

  it('an owner can replay; the disabled queue client fails honestly (redis_disabled) and the action is still audited', async () => {
    const h = await buildTestGateway({}, (db) => { db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter()); });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/jr_dlq_1/replay', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    // REDIS_URL is unset in the test harness — the D-174 disabled-client
    // guard in AgentTaskQueueClient.replayDeadLetter must return this
    // gracefully rather than throwing on a live BullMQ call.
    expect(res.json().data).toEqual(expect.objectContaining({ enqueued: false, reason: 'redis_disabled' }));
    const audit = h.db.col(COLLECTIONS.AUDIT_LOGS).docs.find((a) => a.action === 'agent_job_replayed');
    expect(audit).toBeTruthy();
    expect(audit?.targetId).toBe('jr_dlq_1');
    await h.close();
  });
});

describe('POST /v1/agent-jobs/:jobRunId/cancel', () => {
  it('a viewer cannot cancel (403 forbidden)', async () => {
    const h = await buildTestGateway({}, (db) => { db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter({ status: 'queued', jobRunId: 'jr_q_1' })); });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/jr_q_1/cancel', headers: asAdmin('viewer') });
    expect(res.statusCode).toBe(403);
    await h.close();
  });

  it('404s for a job run that does not exist', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/does-not-exist/cancel', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    await h.close();
  });

  it('an owner can cancel a queued job; the Mongo transition happens and the action is audited', async () => {
    const h = await buildTestGateway({}, (db) => { db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter({ status: 'queued', jobRunId: 'jr_q_1', bullJobId: null })); });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/jr_q_1/cancel', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('cancelled');
    const row = h.db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.find((d) => d.jobRunId === 'jr_q_1');
    expect(row?.status).toBe('cancelled');
    const audit = h.db.col(COLLECTIONS.AUDIT_LOGS).docs.find((a) => a.action === 'agent_job_cancelled');
    expect(audit).toBeTruthy();
    await h.close();
  });

  it('cancelling an already-succeeded job is a documented no-op, not an error', async () => {
    const h = await buildTestGateway({}, (db) => { db.col(COLLECTIONS.AGENT_JOB_RUNS).docs.push(seedDeadLetter({ status: 'succeeded', jobRunId: 'jr_done_1', bullJobId: null })); });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/agent-jobs/jr_done_1/cancel', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.cancelled).toBe(false);
    await h.close();
  });
});
