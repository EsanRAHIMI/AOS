/**
 * D-209 — the gate in front of every unprompted utterance.
 *
 * Two failure modes bracket this module, and both are silent:
 *
 *   TALKS TOO MUCH — the assistant interrupts a meeting to mention an overdue
 *     task. Nobody files a bug; they just mute it, and then every genuinely
 *     urgent thing is muted too.
 *   TALKS TOO LITTLE — the assistant decides something is not worth saying and
 *     the owner never learns it existed. Indistinguishable from a bug in the
 *     detector, unless the suppression left a record.
 *
 * So the tests below assert the shape of the judgement (what it decides, and
 * when it refuses to decide "silence") rather than the wording of any reason.
 *
 * `decideInterrupt` is pure, which is why every path can be covered here
 * exhaustively without a database, a clock, or a calendar.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, collection } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import {
  decideInterrupt, judgeInterrupt, dueHeldItems, markDelivered,
  listAttentionDecisions, isQuietHour, localHour, SPEAK_COOLDOWN_MS,
  type AttentionContext, type InterruptCandidate,
} from '../src/presence/attention.js';

const ACTOR = { actorId: 'user_owner', tenantId: null };
const NOW = '2026-07-31T09:00:00.000Z';

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { state: 'free', busyUntil: null, lastSpokeAt: null, at: NOW, ...over };
}
function candidate(over: Partial<InterruptCandidate> = {}): InterruptCandidate {
  return { subjectId: 's1', subjectKind: 'test', headline: 'x', weight: 0.7, ...over };
}

beforeEach(() => { setTestDb(createFakeDb().db); });

describe('the owner is free', () => {
  it('speaks when the item is worth it and nothing is in the way', () => {
    expect(decideInterrupt(candidate(), ctx()).decision).toBe('speak_now');
  });

  it('shows rather than says when the item is minor', () => {
    // A memory read is real and belongs on the stage; it is not worth a voice.
    expect(decideInterrupt(candidate({ weight: 0.3 }), ctx()).decision).toBe('card_only');
  });

  it('batches instead of speaking twice in quick succession', () => {
    const justSpoke = new Date(Date.parse(NOW) - SPEAK_COOLDOWN_MS / 2).toISOString();
    const v = decideInterrupt(candidate(), ctx({ lastSpokeAt: justSpoke }));
    expect(v.decision).toBe('hold_for_briefing');
    // And it says when it will come back — a hold with no horizon is a drop.
    expect(v.notBefore).toBeTruthy();
  });

  it('lets a time-critical item through the cooldown — that is what the flag is for', () => {
    const justSpoke = new Date(Date.parse(NOW) - 60_000).toISOString();
    const v = decideInterrupt(candidate({ timeCritical: true }), ctx({ lastSpokeAt: justSpoke }));
    expect(v.decision).toBe('speak_now');
  });

  it('speaks again once the cooldown has genuinely passed', () => {
    const old = new Date(Date.parse(NOW) - SPEAK_COOLDOWN_MS - 1000).toISOString();
    expect(decideInterrupt(candidate(), ctx({ lastSpokeAt: old })).decision).toBe('speak_now');
  });
});

describe('the owner is in a meeting', () => {
  it('holds an ordinary item until the meeting ends, and says when that is', () => {
    const end = '2026-07-31T10:00:00.000Z';
    const v = decideInterrupt(candidate(), ctx({ state: 'in_meeting', busyUntil: end }));
    expect(v.decision).toBe('hold_for_briefing');
    expect(v.notBefore).toBe(end);
  });

  it('shows a time-critical item silently rather than losing its timing', () => {
    // "Your next meeting starts in 10 minutes" is worthless an hour later, but
    // not worth talking over the meeting you are in. The card preserves both.
    const v = decideInterrupt(candidate({ timeCritical: true, weight: 0.7 }), ctx({ state: 'in_meeting' }));
    expect(v.decision).toBe('card_only');
  });

  it('interrupts only for something both urgent AND at the top of the scale', () => {
    const v = decideInterrupt(
      candidate({ timeCritical: true, weight: 1 }),
      ctx({ state: 'in_meeting' }),
    );
    expect(v.decision).toBe('speak_now');
  });
});

describe('quiet hours', () => {
  it('never speaks for an ordinary item — it waits for the morning', () => {
    const v = decideInterrupt(candidate({ weight: 0.9 }), ctx({ state: 'quiet_hours' }));
    expect(v.decision).toBe('hold_for_briefing');
  });

  it('wakes the owner only for something urgent at the very top of the scale', () => {
    const v = decideInterrupt(candidate({ weight: 1, timeCritical: true }), ctx({ state: 'quiet_hours' }));
    expect(v.decision).toBe('speak_now');
  });
});

describe('the owner is typing to Jarvis', () => {
  it('never talks over them, whatever the weight', () => {
    for (const weight of [0.3, 0.7, 1]) {
      const v = decideInterrupt(candidate({ weight, timeCritical: true }), ctx({ state: 'focused' }));
      expect(v.decision).toBe('card_only');
    }
  });
});

describe('the calendar is unreadable', () => {
  it('does not assume the owner is free', () => {
    // The dangerous default. Unknown must behave like "possibly busy".
    expect(decideInterrupt(candidate({ weight: 0.9 }), ctx({ state: 'unknown' })).decision).toBe('card_only');
  });

  it('still speaks for something urgent at the top of the scale', () => {
    const v = decideInterrupt(candidate({ weight: 1, timeCritical: true }), ctx({ state: 'unknown' }));
    expect(v.decision).toBe('speak_now');
  });
});

describe('nothing is ever silently dropped', () => {
  it('never returns `suppress` from any state or weight', () => {
    // The strongest invariant in the module: silence is a decision about
    // DELIVERY, never about whether the owner gets to know. If a future check
    // needs to suppress outright, this test must be changed deliberately.
    const states = ['free', 'in_meeting', 'quiet_hours', 'focused', 'unknown'] as const;
    for (const state of states) {
      for (const weight of [0, 0.3, 0.5, 0.7, 0.95, 1]) {
        for (const timeCritical of [true, false]) {
          const v = decideInterrupt(candidate({ weight, timeCritical }), ctx({ state }));
          expect(v.decision).not.toBe('suppress');
        }
      }
    }
  });

  it('always attaches a non-empty reason', () => {
    const states = ['free', 'in_meeting', 'quiet_hours', 'focused', 'unknown'] as const;
    for (const state of states) {
      const v = decideInterrupt(candidate(), ctx({ state }));
      expect(v.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('the ledger — answering "why did you not tell me"', () => {
  it('records every verdict, including the ones that stayed quiet', async () => {
    await judgeInterrupt(ACTOR, candidate({ subjectId: 'quiet_one', weight: 0.2 }), ctx());
    const rows = await listAttentionDecisions(ACTOR);
    const row = rows.find((r) => r.subjectId === 'quiet_one');
    expect(row).toBeDefined();
    expect(row!.decision).toBe('card_only');
    expect(row!.reason).toBeTruthy();
    // The state it was judged in is part of the record — without it the
    // reason cannot be checked against reality later.
    expect(row!.state).toBe('free');
  });

  it('stamps a spoken item as delivered immediately', async () => {
    const r = await judgeInterrupt(ACTOR, candidate({ subjectId: 'spoken' }), ctx());
    expect(r.decision).toBe('speak_now');
    expect(r.deliveredAt).toBeTruthy();
  });
});

describe('held items', () => {
  it('become due only once their notBefore has passed', async () => {
    const later = '2026-07-31T10:00:00.000Z';
    await judgeInterrupt(ACTOR, candidate({ subjectId: 'held' }), ctx({ state: 'in_meeting', busyUntil: later }));

    const during = await dueHeldItems(ACTOR, new Date('2026-07-31T09:30:00.000Z'));
    expect(during.map((d) => d.subjectId)).not.toContain('held');

    const after = await dueHeldItems(ACTOR, new Date('2026-07-31T10:30:00.000Z'));
    expect(after.map((d) => d.subjectId)).toContain('held');
  });

  it('a quiet-hours hold has no horizon and is due as soon as it is asked for', async () => {
    await judgeInterrupt(ACTOR, candidate({ subjectId: 'overnight' }), ctx({ state: 'quiet_hours' }));
    const due = await dueHeldItems(ACTOR, new Date('2026-07-31T04:00:00.000Z'));
    expect(due.map((d) => d.subjectId)).toContain('overnight');
  });

  it('stop coming back once delivered — a briefing must not repeat itself', async () => {
    const r = await judgeInterrupt(ACTOR, candidate({ subjectId: 'once' }), ctx({ state: 'quiet_hours' }));
    expect(await markDelivered(ACTOR, [r.decisionId])).toBe(1);
    const due = await dueHeldItems(ACTOR);
    expect(due.map((d) => d.subjectId)).not.toContain('once');
  });

  it('are scoped to their actor', async () => {
    await judgeInterrupt({ actorId: 'someone_else' }, candidate({ subjectId: 'theirs' }), ctx({ state: 'quiet_hours' }));
    const due = await dueHeldItems(ACTOR);
    expect(due.map((d) => d.subjectId)).not.toContain('theirs');
  });
});

describe('waking hours are evaluated in the OWNER\'s timezone', () => {
  const prefs = { timezone: 'Asia/Tehran' };

  it('reads the local hour, not the server\'s', () => {
    // 02:00 UTC is 05:30 in Tehran — still asleep, in both, but for different
    // reasons. 20:00 UTC is 23:30 in Tehran: quiet there, awake in UTC.
    expect(localHour(new Date('2026-07-31T02:00:00.000Z'), prefs)).toBe(5);
    expect(localHour(new Date('2026-07-31T20:00:00.000Z'), prefs)).toBe(23);
  });

  it('calls 23:30 Tehran quiet even though 20:00 UTC is not', () => {
    const at = new Date('2026-07-31T20:00:00.000Z');
    expect(isQuietHour(at, prefs)).toBe(true);
    expect(isQuietHour(at, { timezone: 'UTC' })).toBe(false);
  });

  it('does not go permanently silent on an invalid stored timezone', () => {
    // Falling back to UTC is wrong-ish; falling silent forever is unusable.
    expect(isQuietHour(new Date('2026-07-31T12:00:00.000Z'), { timezone: 'Not/AZone' })).toBe(false);
  });
});

describe('the heartbeat judges what it notices', () => {
  it('records a decision for each event it creates', async () => {
    // Seed an overdue mission so the pulse has something real to find.
    await collection(COLLECTIONS.MISSION_NODES).insertOne({
      nodeId: 'm_overdue', actorId: ACTOR.actorId, scope: 'user', tenantId: null,
      nodeType: 'task', title: 'کار عقب‌افتاده', status: 'active', priority: 'high',
      progress: 0, parentId: null, dueAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    } as never);

    const { runHeartbeatOnce } = await import('../src/heartbeat/index.js');
    const res = await runHeartbeatOnce({ actorId: ACTOR.actorId, scope: 'user', tenantId: null } as never);

    if (res.created.length) {
      const rows = await listAttentionDecisions(ACTOR);
      for (const e of res.created) {
        expect(rows.some((r) => r.subjectId === e.eventId)).toBe(true);
      }
      // The pulse reports how many of what it found were actually spoken.
      expect(res.run.notes).toMatch(/^spoken:\d+\/\d+$/);
    }
  });
});
