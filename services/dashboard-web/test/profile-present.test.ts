/**
 * D-187 — the profile presentation layer.
 *
 * These are the functions that decide what the owner actually reads, so the
 * failure modes worth guarding are: silently dropping an unknown field,
 * mis-stating a deadline (the one number a person acts on), and ordering the
 * attention list so an expired document hides below a healthy one.
 */
import { describe, it, expect } from 'vitest';
import {
  fieldLabel, humanise, formatValue, valueKind, expiryPhrase, daysUntil,
  recordSentence, recordGroup, whenPhrase, claimSentence, completeness, initials,
} from '../src/app/me/profile/present';

const NOW = Date.parse('2026-07-30T12:00:00.000Z');

describe('field labels', () => {
  it('uses curated Persian labels where we have them', () => {
    expect(fieldLabel('passport_no')).toBe('شمارهٔ پاسپورت');
    expect(fieldLabel('email')).toBe('ایمیل');
  });

  it('humanises unknown keys instead of hiding them — new sections must degrade gracefully', () => {
    expect(fieldLabel('crypto_wallet_id')).toBe('Crypto Wallet Id');
    expect(humanise('someCamelKey')).toBe('Some Camel Key');
  });
});

describe('value rendering', () => {
  it('classifies values so each renders as what it is', () => {
    expect(valueKind('2026-01-05')).toBe('date');
    expect(valueKind('a@b.com')).toBe('email');
    expect(valueKind('https://x.dev')).toBe('url');
    expect(valueKind('+98 912 000 0000')).toBe('phone');
    expect(valueKind(42)).toBe('number');
    expect(valueKind(['a', 'b'])).toBe('list');
  });

  it('never renders [object Object] or a bare empty string', () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue('')).toBe('—');
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('بله');
    expect(formatValue(['x', 'y'])).toBe('x، y');
  });

  it('trims a stored timestamp to a date', () => {
    expect(formatValue('2026-01-05T09:30:00.000Z')).toBe('2026-01-05');
  });
});

describe('expiry phrasing — the number the owner acts on', () => {
  it('counts days, not milliseconds', () => {
    expect(daysUntil('2026-08-09T12:00:00.000Z', NOW)).toBe(10);
    expect(daysUntil(null, NOW)).toBeNull();
  });

  it('states the consequence for each band', () => {
    expect(expiryPhrase('2026-07-20T12:00:00.000Z', 'expired', NOW).text).toBe('10 روز است که منقضی شده');
    expect(expiryPhrase('2026-07-30T12:00:00.000Z', 'expiring', NOW).text).toBe('امروز منقضی می‌شود');
    expect(expiryPhrase('2026-08-05T12:00:00.000Z', 'expiring', NOW).text).toBe('6 روز تا انقضا');
    expect(expiryPhrase(null, 'active', NOW).text).toBe('بدون تاریخ انقضا');
  });

  it('escalates tone as the date approaches', () => {
    expect(expiryPhrase('2026-07-20T12:00:00.000Z', 'expired', NOW).tone).toBe('err');
    expect(expiryPhrase('2026-08-05T12:00:00.000Z', 'expiring', NOW).tone).toBe('err');   // <= 14 days
    expect(expiryPhrase('2026-08-25T12:00:00.000Z', 'expiring', NOW).tone).toBe('warn');  // <= 45 days
    expect(expiryPhrase('2027-08-25T12:00:00.000Z', 'active', NOW).tone).toBe('ok');
  });

  it('sorts most-urgent-first, with undated and archived last', () => {
    const docs = [
      { t: 'healthy', d: expiryPhrase('2028-01-01T00:00:00.000Z', 'active', NOW) },
      { t: 'expired', d: expiryPhrase('2026-06-01T00:00:00.000Z', 'expired', NOW) },
      { t: 'undated', d: expiryPhrase(null, 'active', NOW) },
      { t: 'soon', d: expiryPhrase('2026-08-03T00:00:00.000Z', 'expiring', NOW) },
      { t: 'archived', d: expiryPhrase('2026-06-01T00:00:00.000Z', 'archived', NOW) },
    ].sort((a, b) => a.d.urgency - b.d.urgency).map((x) => x.t);
    expect(docs).toEqual(['expired', 'soon', 'healthy', 'undated', 'archived']);
  });
});

describe('history in human language', () => {
  it('turns ledger record types into sentences', () => {
    expect(recordSentence('document.created')).toBe('مدرک جدیدی ثبت شد');
    expect(recordSentence('entity.section.updated')).toBe('یک بخش از پروفایل شما ویرایش شد');
  });

  it('degrades readably for a record type we have not seen', () => {
    expect(recordSentence('contract.signed')).toBe('Contract Signed');
  });

  it('groups records for the timeline marker', () => {
    expect(recordGroup('document.archived')).toBe('document');
    expect(recordGroup('claim.issued')).toBe('trust');
    expect(recordGroup('relation.created')).toBe('network');
    expect(recordGroup('entity.updated')).toBe('profile');
  });

  it('says when in relative Persian, falling back to a date past a month', () => {
    expect(whenPhrase('2026-07-30T09:00:00.000Z', NOW)).toBe('امروز');
    expect(whenPhrase('2026-07-29T09:00:00.000Z', NOW)).toBe('دیروز');
    expect(whenPhrase('2026-07-25T09:00:00.000Z', NOW)).toBe('5 روز پیش');
    expect(whenPhrase('2026-01-05T09:00:00.000Z', NOW)).toBe('2026-01-05');
  });

  it('explains an attestation without exposing the claim type', () => {
    expect(claimSentence('identity_verified')).toBe('هویت شما تأیید شده است');
    expect(claimSentence('weird_new_claim')).toBe('Weird New Claim');
  });
});

describe('completeness', () => {
  it('reports which core sections are still missing', () => {
    const c = completeness({ identity: {}, contact: {} });
    expect(c.filled).toBe(2);
    expect(c.total).toBe(6);
    expect(c.percent).toBe(33);
    expect(c.missing).toContain('skills');
    expect(c.missing).not.toContain('identity');
  });

  it('is 0% on an empty profile and 100% when the core is filled', () => {
    expect(completeness(undefined).percent).toBe(0);
    expect(completeness({ identity: {}, contact: {}, education: {}, employment: {}, skills: {}, goals: {} }).percent).toBe(100);
  });
});

describe('avatar initials', () => {
  it('works for Persian and Latin names alike', () => {
    expect(initials('احسان رحیمی')).toBe('ار');
    expect(initials('Ehsan Rahimi')).toBe('ER');
    expect(initials('  ')).toBe('؟');
  });
});
