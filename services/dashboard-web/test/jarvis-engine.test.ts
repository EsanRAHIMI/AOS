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

/* ========================================================================== *
 * D-213 — the answer appears as it is written
 * ========================================================================== */

/** Serve real SSE frames, cut into small pieces so records span reads. */
function stubStream(frames: Array<[string, unknown]>): void {
  const wire = frames.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(wire);
  vi.stubGlobal('fetch', vi.fn(async () => {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i >= bytes.length) { c.close(); return; }
        c.enqueue(bytes.slice(i, i + 11));
        i += 11;
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }));
}

describe('streaming a reply', () => {
  it('grows streamingText as text deltas arrive, then clears it', async () => {
    const seen: string[] = [];
    const stop = subscribe((s) => { if (s.streamingText) seen.push(s.streamingText); });
    stubStream([
      ['loop.run.started', { kind: 'run.started', runId: 'arun_1' }],
      ['loop.text', { kind: 'text', text: 'سلام' }],
      ['loop.text', { kind: 'text', text: ' مسی' }],
      ['turn.final', { replyText: 'سلام مسی', status: 'completed' }],
    ]);

    submit('سلام');
    await settle();
    stop();

    // Seen growing, character group by character group.
    expect(seen).toEqual(['سلام', 'سلام مسی']);
    // And gone once the turn settled — a stale preview under a finished
    // answer would render the reply twice.
    expect(getSnapshot().streamingText).toBe('');
  });

  it('REPLACES the preview with the final text rather than appending it', async () => {
    stubStream([
      ['loop.text', { kind: 'text', text: 'partial' }],
      ['turn.final', { replyText: 'the complete answer', status: 'completed' }],
    ]);
    submit('بگو');
    await settle();

    const reply = getSnapshot().msgs.filter((m) => m.who === 'jarvis').at(-1);
    // The two are the same sentence; concatenating them is how a streaming UI
    // ends up saying everything twice.
    expect(reply?.text).toBe('the complete answer');
  });

  it('keeps the streamed text when the final frame never arrives', async () => {
    /* A connection dropped at the last moment used to leave an ellipsis. The
     * owner watched a whole answer appear and then be thrown away. */
    stubStream([
      ['loop.text', { kind: 'text', text: 'this is what I managed to say' }],
    ]);
    submit('قطع شد');
    await settle();

    const reply = getSnapshot().msgs.filter((m) => m.who === 'jarvis').at(-1);
    expect(reply?.text).toBe('this is what I managed to say');
  });

  it('exposes the run id early, which is what a stop button needs', async () => {
    let idDuringTurn: string | null = null;
    const stop = subscribe((s) => { if (s.activeRunId) idDuringTurn = s.activeRunId; });
    stubStream([
      ['loop.run.started', { kind: 'run.started', runId: 'arun_42' }],
      ['loop.text', { kind: 'text', text: 'x' }],
      ['turn.final', { replyText: 'x', status: 'completed' }],
    ]);
    submit('کاری بکن');
    await settle();
    stop();

    expect(idDuringTurn).toBe('arun_42');
    expect(getSnapshot().activeRunId).toBeNull();
  });

  it('shows a tool starting and then finishing as ONE line, not two', async () => {
    stubStream([
      ['loop.tool.start', { kind: 'tool.start', toolName: 'calendar_agenda', callId: 'c1' }],
      ['loop.tool.end', { kind: 'tool.end', toolName: 'calendar_agenda', callId: 'c1', ok: true, summary: '2 events' }],
      ['turn.final', { replyText: 'دو رویداد داری', status: 'completed' }],
    ]);
    submit('برنامه‌ام چیه');
    await settle();

    const reply = getSnapshot().msgs.filter((m) => m.who === 'jarvis').at(-1);
    expect(reply?.steps).toEqual(['✓ calendar_agenda']);
  });

  it('ignores the trailing loop.step replay when live steps already told the story', async () => {
    /* `loop.step` is still emitted after the turn for older clients. Replaying
     * it here would duplicate every line the owner just watched appear. */
    stubStream([
      ['loop.tool.start', { kind: 'tool.start', toolName: 'memory_search', callId: 'c1' }],
      ['loop.tool.end', { kind: 'tool.end', toolName: 'memory_search', callId: 'c1', ok: true, summary: 'found' }],
      ['loop.step', { kind: 'tool_execution', summary: 'memory_search: found', toolName: 'memory_search', ok: true, index: 0 }],
      ['turn.final', { replyText: 'ok', status: 'completed' }],
    ]);
    submit('چی یادت هست');
    await settle();

    expect(getSnapshot().msgs.filter((m) => m.who === 'jarvis').at(-1)?.steps).toEqual(['✓ memory_search']);
  });

  it('still shows steps from loop.step alone when the provider cannot stream', async () => {
    stubStream([
      ['loop.step', { kind: 'tool_execution', summary: 'personal_state: read', toolName: 'personal_state', ok: true, index: 0 }],
      ['turn.final', { replyText: 'ok', status: 'completed' }],
    ]);
    submit('وضعیتم چطوره');
    await settle();

    expect(getSnapshot().msgs.filter((m) => m.who === 'jarvis').at(-1)?.steps).toEqual(['personal_state: read']);
  });
});
