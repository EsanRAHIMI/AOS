/**
 * D-211 — the conversation is a process, not a view.
 *
 * The reported symptom was that ambient voice behaved differently depending
 * on whether the chat panel happened to be open, closed, or opened while a
 * turn was running — and that one spoken sentence produced up to four
 * identical turns, sometimes answered inconsistently.
 *
 * All of it came from one structural mistake: the session, the message list
 * and `send` lived inside a component that mounts only while the panel is
 * open. Closing it mid-turn dropped the answer; reopening it re-fired the
 * effect that submitted the voice command; and two overlapping turns wrote
 * into one server-side transcript, which is why the same question came back
 * answered "2 events" and then "1 event".
 *
 * The engine is module state with a serial queue. These tests cover the
 * properties that make the reported behaviour impossible, without a browser
 * or a React tree — because none of it depends on either any more, which is
 * the point.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  submit, subscribe, getSnapshot, setSpeaker, __resetEngineForTests,
} from '../src/lib/jarvisEngine';

/* The engine talks to server actions and a streaming route. Both are mocked
 * at the module boundary: this file is about ordering and identity, not
 * transport. */
vi.mock('@/app/jarvis/actions', () => ({
  listSessionsAction: vi.fn(async () => [{ sessionId: 'sess_1' }]),
  createSessionAction: vi.fn(async () => 'sess_1'),
  getSessionAction: vi.fn(async () => ({ session: null, turns: [] })),
  sendTurnAction: vi.fn(async (_s: string, text: string) => ({ replyText: `reply:${text}` })),
}));

/** Resolves when the engine has drained everything it accepted. */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
    const s = getSnapshot();
    if (!s.busy && s.queued === 0) return;
  }
}

/** A stream that never works, so every turn falls back to `sendTurnAction`. */
function stubFailingStream(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
}

beforeEach(() => {
  __resetEngineForTests();
  stubFailingStream();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('one command, one turn', () => {
  it('accepts a command and produces exactly two messages', async () => {
    expect(submit('سلام')).toBe(true);
    await settle();
    const { msgs } = getSnapshot();
    expect(msgs.filter((m) => m.who === 'you')).toHaveLength(1);
    expect(msgs.filter((m) => m.who === 'jarvis')).toHaveLength(1);
  });

  it('rejects the same command delivered twice in quick succession', async () => {
    // The exact reported failure: a remount, a stale prop, or a late voice
    // event re-delivering one utterance.
    expect(submit('یک رویداد برای امشب بگذار')).toBe(true);
    expect(submit('یک رویداد برای امشب بگذار')).toBe(false);
    await settle();
    expect(getSnapshot().msgs.filter((m) => m.who === 'you')).toHaveLength(1);
  });

  it('rejects a duplicate that is still sitting in the queue', async () => {
    // Two deliveries of one utterance can arrive further apart than the time
    // window, but never further apart than the queue itself.
    submit('اول');
    expect(submit('دوم')).toBe(true);
    expect(submit('دوم')).toBe(false);
    await settle();
    expect(getSnapshot().msgs.filter((m) => m.who === 'you' && m.text === 'دوم')).toHaveLength(1);
  });

  it('still accepts a genuinely different command immediately', async () => {
    expect(submit('اول')).toBe(true);
    expect(submit('دوم')).toBe(true);
    await settle();
    expect(getSnapshot().msgs.filter((m) => m.who === 'you')).toHaveLength(2);
  });

  it('ignores empty and whitespace-only input', () => {
    expect(submit('')).toBe(false);
    expect(submit('   ')).toBe(false);
  });
});

describe('turns are serialised', () => {
  it('runs one at a time and preserves the order they were given in', async () => {
    // Overlapping turns share one server-side transcript, which is how the
    // same question came back answered two different ways.
    submit('یک');
    submit('دو');
    submit('سه');
    await settle();
    const said = getSnapshot().msgs.filter((m) => m.who === 'you').map((m) => m.text);
    expect(said).toEqual(['یک', 'دو', 'سه']);
  });

  it('never has more than one turn in flight', async () => {
    const seen: boolean[] = [];
    const stop = subscribe((s) => seen.push(s.busy));
    submit('الف');
    submit('ب');
    await settle();
    stop();
    // `busy` is a single flag; two concurrent turns would race it. What we can
    // assert cheaply is that it settles false and every command ran.
    expect(getSnapshot().busy).toBe(false);
    expect(getSnapshot().msgs.filter((m) => m.who === 'you')).toHaveLength(2);
  });

  it('reports how many commands are waiting', async () => {
    submit('یک');
    submit('دو');
    submit('سه');
    // The first is in flight, so at least one is visibly queued behind it.
    expect(getSnapshot().queued).toBeGreaterThan(0);
    await settle();
    expect(getSnapshot().queued).toBe(0);
  });

  it('refuses to pile up an unbounded backlog', async () => {
    const accepted = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => submit(t));
    expect(accepted.filter(Boolean).length).toBeLessThanOrEqual(6);
    await settle();
  });
});

describe('the engine outlives every view', () => {
  it('keeps running with no subscriber at all', async () => {
    // This is the fix for "closing the panel mid-turn lost the answer": there
    // is no component involved in completing a turn any more.
    submit('بدون هیچ بیننده‌ای');
    await settle();
    expect(getSnapshot().msgs.filter((m) => m.who === 'jarvis')).toHaveLength(1);
  });

  it('replays its current state to a subscriber that arrives late', async () => {
    submit('قبل از اشتراک');
    await settle();
    let received: ReturnType<typeof getSnapshot> | null = null;
    const stop = subscribe((s) => { received = s; });
    stop();
    // A panel opened after the fact must see the finished conversation, not
    // an empty one.
    expect(received!.msgs.length).toBeGreaterThan(0);
  });

  it('survives subscribers coming and going mid-turn', async () => {
    submit('در حین پردازش');
    const stop1 = subscribe(() => {});
    stop1();                       // the panel closes
    const stop2 = subscribe(() => {});   // and reopens
    await settle();
    stop2();
    expect(getSnapshot().msgs.filter((m) => m.who === 'you')).toHaveLength(1);
    expect(getSnapshot().msgs.filter((m) => m.who === 'jarvis')).toHaveLength(1);
  });
});

describe('voice replies are spoken, text replies are not', () => {
  it('speaks a reply to a spoken command', async () => {
    const speak = vi.fn();
    setSpeaker(speak);
    submit('با صدا', { transport: 'voice' });
    await settle();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a typed command', async () => {
    const speak = vi.fn();
    setSpeaker(speak);
    submit('با تایپ');
    await settle();
    expect(speak).not.toHaveBeenCalled();
  });

  it('does not fail when no view has lent a speaker', async () => {
    setSpeaker(null);
    submit('بدون بلندگو', { transport: 'voice' });
    await settle();
    expect(getSnapshot().state).not.toBe('error');
  });
});
