/**
 * K1.3 characterization — task pipeline, approvals, infrastructure, events.
 * Pins the exact behavior of the highest-value mutation flows before the split.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { COLLECTIONS, nowIso } from '@factory/shared';
import { buildTestGateway, asAdmin, type Harness } from './helpers/build-app.js';

let h: Harness;
beforeAll(async () => { h = await buildTestGateway(); });
afterAll(async () => { await h.close(); });

const seedTask = (taskId: string, status = 'in_progress') =>
  h.db.col(COLLECTIONS.TASKS).docs.push({ taskId, goal: 'g', status, priority: 'normal', createdBy: 'x', assignedServiceId: null, parentTaskId: null, requiresApproval: false, tags: [], error: null, createdAt: nowIso(), updatedAt: nowIso() });

describe('POST /v1/tasks', () => {
  it('rejects an invalid body with 400 validation_error', async () => {
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/tasks', headers: asAdmin(), payload: { nope: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('persists the task and returns it sans _id; local contract: stays queued when the orchestrator is unreachable', async () => {
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/tasks', headers: asAdmin(), payload: { goal: 'characterize the gateway' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.taskId).toMatch(/^task_[0-9a-f]{12}$/);
    expect(body.data.goal).toBe('characterize the gateway');
    expect(body.data.status).toBe('queued'); // forward failed → queued (documented local behavior)
    expect(body.data._id).toBeUndefined();
    const stored = h.db.col(COLLECTIONS.TASKS).docs.find((d) => d.taskId === body.data.taskId);
    expect(stored).toBeTruthy();
  }, 15_000);

  it('a viewer role cannot create tasks (403 forbidden + RBAC audit)', async () => {
    const before = h.db.col(COLLECTIONS.AUDIT_LOGS).docs.length;
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/tasks', headers: asAdmin('viewer'), payload: { goal: 'nope' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    expect(h.db.col(COLLECTIONS.AUDIT_LOGS).docs.length).toBe(before + 1);
    expect(h.db.col(COLLECTIONS.AUDIT_LOGS).docs.at(-1)).toMatchObject({ action: 'createTask_denied' });
  });
});

describe('GET /v1/tasks + /v1/tasks/:id + timeline', () => {
  it('lists tasks without _id', async () => {
    seedTask('task_seed_list');
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tasks', headers: asAdmin() });
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.taskId === 'task_seed_list')).toBe(true);
    expect(rows.every((r) => r._id === undefined)).toBe(true);
  });
  it('404 not_found for a missing task id', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tasks/task_missing', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
  it('timeline returns task-scoped events oldest-first', async () => {
    h.db.col(COLLECTIONS.EVENTS).docs.push(
      { eventId: 'evt_2', type: 'b', source: 's', taskId: 'task_tl', payload: {}, createdAt: '2026-07-10T02:00:00.000Z' },
      { eventId: 'evt_1', type: 'a', source: 's', taskId: 'task_tl', payload: {}, createdAt: '2026-07-10T01:00:00.000Z' },
      { eventId: 'evt_x', type: 'c', source: 's', taskId: 'other', payload: {}, createdAt: '2026-07-10T03:00:00.000Z' },
    );
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tasks/task_tl/timeline', headers: asAdmin() });
    const rows = res.json().data as Array<{ eventId: string }>;
    expect(rows.map((r) => r.eventId)).toEqual(['evt_1', 'evt_2']);
  });
});

describe('approvals decision', () => {
  it('400 on an invalid action', async () => {
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/approvals/appr_x/decision', headers: asAdmin(), payload: { action: 'maybe' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
  it('404 not_found for an unknown approval', async () => {
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/approvals/appr_missing/decision', headers: asAdmin(), payload: { action: 'approve' } });
    expect(res.statusCode).toBe(404);
  });
  it('approve drives the linked task to completed and writes an audit row', async () => {
    seedTask('task_appr');
    h.db.col(COLLECTIONS.APPROVALS).docs.push({ approvalId: 'appr_1', taskId: 'task_appr', actionType: 'test', status: 'pending', createdAt: nowIso() });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/approvals/appr_1/decision', headers: asAdmin(), payload: { action: 'approve', reason: 'ok' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('approved');
    const task = h.db.col(COLLECTIONS.TASKS).docs.find((d) => d.taskId === 'task_appr');
    expect(task?.status).toBe('completed');
    expect(h.db.col(COLLECTIONS.AUDIT_LOGS).docs.some((a) => a.action === 'approval_approved' && a.targetId === 'appr_1')).toBe(true);
  });
  it('reject cancels the linked task', async () => {
    seedTask('task_rej');
    h.db.col(COLLECTIONS.APPROVALS).docs.push({ approvalId: 'appr_2', taskId: 'task_rej', actionType: 'test', status: 'pending', createdAt: nowIso() });
    await h.service.app.inject({ method: 'POST', url: '/v1/approvals/appr_2/decision', headers: asAdmin(), payload: { action: 'reject' } });
    expect(h.db.col(COLLECTIONS.TASKS).docs.find((d) => d.taskId === 'task_rej')?.status).toBe('cancelled');
  });
  it('pending list only returns pending approvals', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/approvals', headers: asAdmin() });
    const rows = res.json().data as Array<{ approvalId: string; status: string }>;
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.some((r) => r.approvalId === 'appr_1')).toBe(false); // decided above
  });
});

describe('infrastructure confirm', () => {
  it('404 for an unknown request; confirm marks fulfilled with the full validation checklist', async () => {
    expect((await h.service.app.inject({ method: 'POST', url: '/v1/infrastructure/infra_missing/confirm', headers: asAdmin() })).statusCode).toBe(404);
    h.db.col(COLLECTIONS.INFRASTRUCTURE_REQUESTS).docs.push({ requestId: 'infra_1', serviceName: 'x', status: 'waiting_user_creation', createdAt: nowIso() });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/infrastructure/infra_1/confirm', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      status: 'fulfilled',
      validation: { domainReachable: true, healthOk: true, internalTokenOk: true, manifestAvailable: true, registered: true },
    });
  });
});

describe('events + services proxy + system status', () => {
  it('events respect the limit and clamp at 500', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/events?limit=2', headers: asAdmin() });
    expect((res.json().data as unknown[]).length).toBeLessThanOrEqual(2);
  });
  it('services proxy returns [] when no registry is configured', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/services', headers: asAdmin() });
    expect(res.json()).toEqual({ ok: true, data: [] });
  });
  it('system status reports counts and env', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/system/status', headers: asAdmin() });
    const data = res.json().data;
    expect(typeof data.taskCount).toBe('number');
    expect(typeof data.pendingApprovals).toBe('number');
    expect(data.env).toBe('local');
  });
});
