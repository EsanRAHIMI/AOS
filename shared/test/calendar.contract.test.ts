/**
 * D-192 — Google Calendar integration.
 *
 * The failures worth guarding here are the quiet ones. A mirror that drifts
 * still renders; it just shows the owner a meeting that moved yesterday. A
 * plaintext refresh token still works; it just means a database dump hands
 * over the calendar permanently. So: crypto, the write policy, and the sync
 * rules the official guide imposes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  encryptSecret, decryptSecret, vaultAvailability, storeGrant, getGrant, markGrantRevoked,
  googleAvailability, buildAuthUrl, GOOGLE_SCOPES, GoogleApiError, classifyWrite,
  AOS_CALENDAR_SUMMARY,
} from '../src/calendar/index.js';

const KEY = '0'.repeat(64);                    // 32 bytes of hex
const ENV = { GOOGLE_TOKEN_ENC_KEY: KEY } as unknown as NodeJS.ProcessEnv;

beforeEach(() => { setTestDb(createFakeDb().db); });

describe('token vault', () => {
  it('refuses to work without a real key, and says exactly why', () => {
    expect(vaultAvailability({} as NodeJS.ProcessEnv).configured).toBe(false);
    expect(vaultAvailability({} as NodeJS.ProcessEnv).reason).toContain('GOOGLE_TOKEN_ENC_KEY');
    const short = { GOOGLE_TOKEN_ENC_KEY: 'abcd' } as unknown as NodeJS.ProcessEnv;
    expect(vaultAvailability(short).reason).toContain('32 bytes');
  });

  it('round-trips a secret and never stores it in the clear', () => {
    const secret = '1//0gRefreshTokenValue';
    const enc = encryptSecret(secret, ENV);
    expect(enc).not.toContain(secret);
    expect(enc.split(':')).toHaveLength(3);      // iv : authTag : ciphertext
    expect(decryptSecret(enc, ENV)).toBe(secret);
  });

  it('rejects a tampered record instead of returning garbage', () => {
    const enc = encryptSecret('secret', ENV);
    const [iv, tag, data] = enc.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    // GCM authenticates: this must throw, not silently decrypt to nonsense we
    // would then send to Google as a token.
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join(':'), ENV)).toThrow();
  });

  it('stores a grant with the refresh token encrypted at rest', async () => {
    await storeGrant({ actorId: 'esan', refreshToken: 'rt-123', accessToken: 'at-1', expiresInSec: 3600, scopes: ['a'] }, ENV);
    const grant = await getGrant('esan');
    expect(grant?.refreshTokenEnc).toBeTruthy();
    expect(grant?.refreshTokenEnc).not.toContain('rt-123');
    expect(decryptSecret(grant!.refreshTokenEnc, ENV)).toBe('rt-123');
  });

  it('keeps the working refresh token when Google returns none on reconnect', async () => {
    await storeGrant({ actorId: 'esan', refreshToken: 'rt-original' }, ENV);
    // Google only returns a refresh token on first consent; a re-auth without
    // one must not wipe the grant.
    await storeGrant({ actorId: 'esan', refreshToken: '', accessToken: 'at-2', expiresInSec: 3600 }, ENV);
    const grant = await getGrant('esan');
    expect(decryptSecret(grant!.refreshTokenEnc, ENV)).toBe('rt-original');
  });

  it('refuses a first-time grant that has no refresh token, with actionable advice', async () => {
    await expect(storeGrant({ actorId: 'new', refreshToken: '' }, ENV))
      .rejects.toThrow(/prompt=consent/);
  });

  it('marks a revoked grant so the UI can say reconnect', async () => {
    await storeGrant({ actorId: 'esan', refreshToken: 'rt' }, ENV);
    await markGrantRevoked('esan', 'invalid_grant');
    const grant = await getGrant('esan');
    expect(grant?.revokedAt).toBeTruthy();
    expect(grant?.lastError).toContain('invalid_grant');
  });
});

describe('oauth configuration', () => {
  it('names the missing variables instead of a generic failure', () => {
    const a = googleAvailability({} as NodeJS.ProcessEnv);
    expect(a.configured).toBe(false);
    expect(a.missing).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
  });

  it('always asks for offline access AND forces consent', () => {
    const url = buildAuthUrl({ clientId: 'cid', clientSecret: 's', redirectUri: 'https://x/cb' }, 'state123');
    // Without BOTH, a returning user gets no refresh token and the integration
    // dies at the first access-token expiry.
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('state=state123');
  });

  it('requests least privilege — events, not the full calendar scope', () => {
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/tasks');
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar');
  });
});

describe('google error semantics', () => {
  it('recognises a dead sync token — the one error that must wipe the mirror', () => {
    const gone = new GoogleApiError(410, 'fullSyncRequired', 'Sync token is no longer valid');
    expect(gone.isSyncTokenGone).toBe(true);
    // A deleted resource is also 410 but means nothing of the sort.
    expect(new GoogleApiError(410, 'deleted', 'Resource has been deleted').isSyncTokenGone).toBe(false);
  });

  it('treats 403 rate limits as retryable and 403 permission as permanent', () => {
    expect(new GoogleApiError(403, 'rateLimitExceeded', '').isRateLimited).toBe(true);
    expect(new GoogleApiError(429, 'rateLimitExceeded', '').isRateLimited).toBe(true);
    expect(new GoogleApiError(403, 'forbiddenForNonOrganizer', '').isPermanent).toBe(true);
    expect(new GoogleApiError(400, 'timeRangeEmpty', '').isPermanent).toBe(true);
  });

  it('does not mark a 500 permanent — that one is worth retrying', () => {
    expect(new GoogleApiError(500, 'backendError', '').isPermanent).toBe(false);
  });
});

describe('write policy — the owner keeps their calendar', () => {
  const aos = { calendarId: 'c1', isAosCalendar: true, summary: AOS_CALENDAR_SUMMARY } as never;
  const personal = { calendarId: 'c2', isAosCalendar: false, summary: 'Ehsan' } as never;

  it('lets the agent write freely only in the AOS calendar', () => {
    expect(classifyWrite({ op: 'create', calendar: aos }).sensitivity).toBe('free');
    expect(classifyWrite({ op: 'update', calendar: aos }).sensitivity).toBe('free');
  });

  it('requires approval to touch the owner\'s own calendar', () => {
    const v = classifyWrite({ op: 'create', calendar: personal });
    expect(v.sensitivity).toBe('approval');
    expect(v.reason).toContain('تقویم شخصی');
  });

  it('requires approval to delete or to invite guests, even in the AOS calendar', () => {
    // A delete is irreversible from here; an invitation sends real mail to real
    // people in the owner's name. Neither becomes safe by being "ours".
    expect(classifyWrite({ op: 'delete', calendar: aos }).sensitivity).toBe('approval');
    expect(classifyWrite({ op: 'create', calendar: aos, hasAttendees: true }).sensitivity).toBe('approval');
  });

  it('treats an unknown calendar as the owner\'s, never as ours', () => {
    expect(classifyWrite({ op: 'create', calendar: null }).sensitivity).toBe('approval');
  });
});

describe('oauth state — durable, single use, time-boxed', () => {
  it('survives being minted and consumed across calls (no in-process map)', async () => {
    const { rememberOAuthState, consumeOAuthState } = await import('../src/calendar/tokens.js');
    await rememberOAuthState('abc');
    expect(await consumeOAuthState('abc')).toBe(true);
  });

  it('is single use — a replayed callback must fail', async () => {
    const { rememberOAuthState, consumeOAuthState } = await import('../src/calendar/tokens.js');
    await rememberOAuthState('once');
    expect(await consumeOAuthState('once')).toBe(true);
    expect(await consumeOAuthState('once')).toBe(false);
  });

  it('rejects a state that was never minted', async () => {
    const { consumeOAuthState } = await import('../src/calendar/tokens.js');
    expect(await consumeOAuthState('forged')).toBe(false);
  });

  it('carries a real Date for the TTL index, not just an ISO string', async () => {
    const { rememberOAuthState } = await import('../src/calendar/tokens.js');
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');
    await rememberOAuthState('dated');
    const doc = await collection(COLLECTIONS.OAUTH_STATES).findOne({ state: 'dated' });
    // Mongo TTL only acts on Date fields; an ISO string index never deletes.
    expect(doc?.ttlAt instanceof Date).toBe(true);
  });
});

/**
 * D-193b — the mirror must never show another account's calendar.
 *
 * This system runs single-operator, so every mirror row was keyed by
 * `actorId: 'owner'`. Connect account A, sync, connect account B — and A's
 * events stayed, with the page reporting B as connected. Not missing data:
 * confidently wrong data belonging to someone else.
 */
describe('mirror is scoped to the connected Google account', () => {
  it('reports when a reconnect switched accounts', async () => {
    const first = await storeGrant({ actorId: 'owner', refreshToken: 'rt', accountEmail: 'a@gmail.com' }, ENV);
    expect(first.accountChanged).toBe(false);

    const same = await storeGrant({ actorId: 'owner', refreshToken: 'rt', accountEmail: 'a@gmail.com' }, ENV);
    expect(same.accountChanged).toBe(false);

    const other = await storeGrant({ actorId: 'owner', refreshToken: 'rt2', accountEmail: 'b@gmail.com' }, ENV);
    expect(other.accountChanged).toBe(true);
  });

  it('purges every mirror collection, including the sync tokens', async () => {
    const { purgeMirror } = await import('../src/calendar/sync.js');
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');

    await collection(COLLECTIONS.CALENDAR_EVENTS).insertOne({ actorId: 'owner', account: 'a@x', eventId: 'e1' } as never);
    await collection(COLLECTIONS.CALENDAR_TASKS).insertOne({ actorId: 'owner', account: 'a@x', taskId: 't1' } as never);
    await collection(COLLECTIONS.CALENDARS).insertOne({ actorId: 'owner', account: 'a@x', calendarId: 'c1' } as never);
    // Sync tokens belonged to the OLD account; keeping them would resume a
    // stranger's incremental sync against the new grant.
    await collection(COLLECTIONS.CALENDAR_SYNC_STATE).insertOne({ actorId: 'owner', resourceId: 'c1' } as never);

    const purged = await purgeMirror('owner');
    expect(purged.events).toBe(1);
    expect(purged.tasks).toBe(1);
    expect(purged.calendars).toBe(1);
    expect(await collection(COLLECTIONS.CALENDAR_SYNC_STATE).findOne({ actorId: 'owner' })).toBeNull();
  });

  it('never returns rows belonging to a different account, even unpurged', async () => {
    const { readAgenda, readTasks } = await import('../src/calendar/sync.js');
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');

    await storeGrant({ actorId: 'owner', refreshToken: 'rt', accountEmail: 'new@gmail.com' }, ENV);
    // A leftover row from the previous account, exactly the reported bug.
    await collection(COLLECTIONS.CALENDAR_EVENTS).insertOne({
      actorId: 'owner', account: 'old@gmail.com', calendarId: 'c', eventId: 'stale',
      status: 'confirmed', start: '2026-07-31T09:00:00Z', end: '2026-07-31T10:00:00Z',
      allDay: false, syncedAt: '2026-07-31T00:00:00Z',
    } as never);
    await collection(COLLECTIONS.CALENDAR_TASKS).insertOne({
      actorId: 'owner', account: 'old@gmail.com', taskListId: '@default', taskId: 'stale',
      status: 'needsAction', syncedAt: '2026-07-31T00:00:00Z',
    } as never);

    expect(await readAgenda({ actorId: 'owner', fromIso: '2026-01-01', toIso: '2027-01-01' })).toEqual([]);
    expect(await readTasks('owner')).toEqual([]);
  });
});
