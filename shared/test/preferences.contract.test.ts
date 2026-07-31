/**
 * D-202 — the owner moved to Dubai and nothing noticed.
 *
 * There was nothing to notice with: the timezone was an environment variable
 * needing a restart, the calendar system was a URL parameter, the language was
 * hard-coded in a dozen strings, currency did not exist, and Jarvis could see
 * none of them. These pin the record that replaced all four.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  getPreferences, setPreferences, DEFAULT_PREFERENCES,
  isValidTimezone, intlLocale, formatMoney, formatDate, offsetMinutes,
} from '../src/settings/preferences.js';
import { nowContext } from '../src/jarvis/turn-runner.js';
import { buildCoreToolFamilies } from '../src/agentcore/families.js';

beforeEach(() => { setTestDb(createFakeDb().db); });

const ctx = {
  actorId: 'owner', role: 'owner' as const, isOwner: true, scope: 'user' as const,
  tenantId: null, userId: 'owner', runId: 'r', sessionId: 's', taskId: null,
  workingSet: new Map<string, unknown>(),
};

describe('reading and writing preferences', () => {
  it('returns usable defaults before anything is saved', async () => {
    const p = await getPreferences();
    expect(p.timezone).toBe(DEFAULT_PREFERENCES.timezone);
    expect(isValidTimezone(p.timezone)).toBe(true);
  });

  it('persists a move and leaves everything else alone', async () => {
    await setPreferences({ currency: 'AED' });
    const p = await setPreferences({ timezone: 'Asia/Dubai' });
    expect(p.timezone).toBe('Asia/Dubai');
    expect(p.currency).toBe('AED');           // not clobbered by the second patch
    expect((await getPreferences()).timezone).toBe('Asia/Dubai');
  });

  it('rejects a bad timezone where the owner can still see the field', async () => {
    // Intl throws deep inside a formatter, on some other page, hours later.
    await expect(setPreferences({ timezone: 'Dubai' })).rejects.toThrow(/unknown timezone/);
    await expect(setPreferences({ timezone: 'UTC+4' })).rejects.toThrow(/unknown timezone/);
  });

  it('rejects a currency that is not an ISO code', async () => {
    await expect(setPreferences({ currency: 'dirham' })).rejects.toThrow(/ISO 4217/);
  });

  it('rejects a language tag that Intl cannot use', async () => {
    await expect(setPreferences({ language: 'not a locale' })).rejects.toThrow(/unknown language/);
  });

  it('never throws on read, because a formatter cannot handle "no preferences"', async () => {
    await expect(getPreferences()).resolves.toBeTruthy();
  });
});

describe('formatting follows the record', () => {
  it('prices in the owner\'s currency', async () => {
    const p = await setPreferences({ currency: 'AED', language: 'en-AE', numerals: 'latn' });
    expect(formatMoney(1234.5, p)).toContain('1,234.5');
    expect(formatMoney(1234.5, p)).toMatch(/AED|د\.إ/);
  });

  it('switches calendar system without touching anything else', async () => {
    const g = await setPreferences({ calendarSystem: 'gregorian', language: 'en-GB' });
    const j = await setPreferences({ calendarSystem: 'jalali' });
    expect(intlLocale(g)).toContain('ca-gregory');
    expect(intlLocale(j)).toContain('ca-persian');
    expect(formatDate('2026-07-31T12:00:00Z', j)).not.toBe(formatDate('2026-07-31T12:00:00Z', g));
  });

  it('computes the offset per instant rather than storing it', async () => {
    // Dubai is +04:00 all year; a stored offset is a bug that appears twice a
    // year in every zone that is not.
    const p = await setPreferences({ timezone: 'Asia/Dubai' });
    expect(offsetMinutes(p, new Date('2026-01-15T00:00:00Z'))).toBe(240);
    expect(offsetMinutes(p, new Date('2026-07-15T00:00:00Z'))).toBe(240);

    const london = { ...p, timezone: 'Europe/London' };
    expect(offsetMinutes(london, new Date('2026-01-15T00:00:00Z'))).toBe(0);
    expect(offsetMinutes(london, new Date('2026-07-15T00:00:00Z'))).toBe(60);
  });
});

describe('Jarvis reasons from the same record', () => {
  it('states the owner\'s zone, currency and calendar in RIGHT NOW', async () => {
    const p = await setPreferences({ timezone: 'Asia/Dubai', currency: 'AED' });
    const out = nowContext(new Date('2026-07-31T10:05:00.000Z'), p);
    expect(out).toContain('Asia/Dubai');
    expect(out).toContain('AED');
  });

  it('resolves "today" in the new zone, not the old one', async () => {
    const dubai = await setPreferences({ timezone: 'Asia/Dubai' });
    // 20:30 UTC is 00:30 the NEXT day in Dubai but still the same day in London.
    const at = new Date('2026-07-31T20:30:00.000Z');
    expect(nowContext(at, dubai)).toContain('today, local: 2026-08-01');
    expect(nowContext(at, { ...dubai, timezone: 'Europe/London' })).toContain('today, local: 2026-07-31');
  });

  it('can read the settings as a tool', async () => {
    await setPreferences({ timezone: 'Asia/Dubai', currency: 'AED' });
    const res = await buildCoreToolFamilies().get('owner_preferences_read')!.executor({}, ctx);
    expect(res.summary).toContain('timezone=Asia/Dubai');
    expect(res.summary).toContain('currency=AED');
  });

  it('can act on "I am in Dubai now" and make it stick', async () => {
    const res = await buildCoreToolFamilies().get('owner_preferences_update')!
      .executor({ timezone: 'Asia/Dubai', currency: 'AED' }, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('DONE');
    // Persisted, not just answered — an assistant that knows your timezone for
    // one conversation is worse than one that does not know it.
    expect((await getPreferences()).timezone).toBe('Asia/Dubai');
  });

  it('tells the model how to fix a city name instead of failing silently', async () => {
    const res = await buildCoreToolFamilies().get('owner_preferences_update')!
      .executor({ timezone: 'Dubai' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('Asia/Dubai');
    expect(res.summary).toContain('do not pass a city name');
  });

  it('refuses a non-owner caller', async () => {
    const res = await buildCoreToolFamilies().get('owner_preferences_update')!
      .executor({ timezone: 'Asia/Dubai' }, { ...ctx, isOwner: false });
    expect(res.ok).toBe(false);
  });
});
