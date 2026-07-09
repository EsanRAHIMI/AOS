/**
 * K1.1 contract tests — API envelopes, event schema, id/time utilities.
 * Every service and the dashboard rely on these exact shapes; the event
 * contract is what the bus validates before persisting/fanning out.
 */
import { describe, it, expect } from 'vitest';
import { success, failure, ERROR_CODES } from '../src/http/index.js';
import { PublishEventSchema, SystemEventSchema } from '../src/schemas/event.js';
import { genId, nowIso, uuid, ok, err } from '../src/utils/index.js';

describe('API envelopes', () => {
  it('success wraps data and only includes meta when provided', () => {
    expect(success({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(success([1, 2], { total: 2 })).toEqual({ ok: true, data: [1, 2], meta: { total: 2 } });
  });
  it('failure carries code + message (+ details)', () => {
    expect(failure(ERROR_CODES.NOT_FOUND, 'missing')).toEqual({ ok: false, error: { code: 'not_found', message: 'missing', details: undefined } });
  });
  it('standard error codes are frozen contracts', () => {
    expect(ERROR_CODES).toMatchObject({
      UNAUTHORIZED: 'unauthorized',
      VALIDATION: 'validation_error',
      APPROVAL_REQUIRED: 'approval_required',
      RATE_LIMITED: 'rate_limited',
      SAFE_MODE: 'safe_mode_blocked',
    });
  });
});

describe('event contract', () => {
  it('accepts a minimal publish body and applies safe defaults', () => {
    const parsed = PublishEventSchema.parse({ type: 'task.created', source: 'gateway-api' });
    expect(parsed.taskId).toBeNull();
    expect(parsed.payload).toEqual({});
  });
  it('rejects an event without a source (no anonymous events)', () => {
    expect(PublishEventSchema.safeParse({ type: 'task.created' }).success).toBe(false);
  });
  it('a full system event requires id + ISO timestamp', () => {
    const good = SystemEventSchema.safeParse({ eventId: 'evt_1', type: 't', source: 's', createdAt: nowIso() });
    expect(good.success).toBe(true);
    const bad = SystemEventSchema.safeParse({ eventId: 'evt_1', type: 't', source: 's', createdAt: 'not-a-date' });
    expect(bad.success).toBe(false);
  });
});

describe('id and time utilities', () => {
  it('genId produces prefixed 12-hex ids', () => {
    expect(genId('task')).toMatch(/^task_[0-9a-f]{12}$/);
  });
  it('nowIso is a parseable ISO-8601 instant', () => {
    const t = nowIso();
    expect(new Date(t).toISOString()).toBe(t);
  });
  it('uuid is RFC-4122 shaped', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it('Result helpers are honest discriminated unions', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });
});
