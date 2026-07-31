'use client';
/**
 * The Jarvis turn engine — one conversation, outliving every view (D-211).
 *
 * WHY THIS IS NOT A REACT HOOK
 * ----------------------------
 * The engine used to live inside `JarvisConversation`: the session id, the
 * message list, `busy`, and `send` were all component state. That component
 * is mounted only while the rudder panel is OPEN, and the owner opens and
 * closes it constantly — including in the middle of a turn. Three bugs
 * followed directly from that, all reported from one session:
 *
 *   1. CLOSING MID-TURN LOST THE ANSWER. The fetch kept running, but its
 *      `setState` calls landed on an unmounted component. The turn completed
 *      server-side and vanished from the interface.
 *   2. REOPENING RESENT THE COMMAND. A voice command was delivered as a prop
 *      (`injected={{text, nonce}}`) and submitted from an effect keyed on the
 *      nonce. Remounting re-ran that effect with the same nonce still in the
 *      parent's state — so one spoken sentence became two, three, four turns.
 *   3. BEHAVIOUR DEPENDED ON WHETHER A PANEL WAS OPEN. Which is not a thing
 *      an owner should ever have to think about.
 *
 * None of those are fixable inside the component, because the component's
 * lifetime is the bug. The conversation is not a view concern: it is a
 * long-running process that a view happens to observe. So it lives here, at
 * module scope, for the lifetime of the tab — and `JarvisConversation`
 * becomes a subscriber that can mount and unmount freely.
 *
 * WHY A SERIAL QUEUE RATHER THAN CONCURRENCY
 * ------------------------------------------
 * Turns share one session, one transcript and one rolling summary on the
 * server. Two in flight at once interleave into that shared state and produce
 * exactly what was reported: the same question answered twice, differently,
 * because each run saw a different half-written history. They also multiply
 * token spend against a per-minute limit that was already the binding
 * constraint. One at a time, queued, is not a limitation — it is the only
 * ordering that has a defined meaning.
 */
import { listSessionsAction, createSessionAction, getSessionAction, sendTurnAction } from '@/app/jarvis/actions';

export type EngineState = 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'error';

export interface EngineMsg {
  /** Stable id so a re-render never re-keys the list. */
  id: string;
  who: 'you' | 'jarvis';
  text: string;
  steps?: string[];
  /** True for a turn that arrived by voice — its reply is spoken. */
  spoken?: boolean;
}

export interface EngineSnapshot {
  sessionId: string | null;
  msgs: EngineMsg[];
  steps: string[];
  busy: boolean;
  state: EngineState;
  pending: { approvalId: string; runId: string } | null;
  /** How many commands are waiting behind the one in flight. */
  queued: number;
  /** Set when the last turn failed in a way worth showing once. */
  lastError: string;
}

export interface SubmitOptions {
  /** 'voice' replies aloud. Voice is a transport, never a separate mode. */
  transport?: 'text' | 'voice';
  /** Appended to the prompt — the page the owner is looking at. */
  contextNote?: string;
}

/* ========================================================================== *
 * Store
 * ========================================================================== */

let snapshot: EngineSnapshot = {
  sessionId: null, msgs: [], steps: [], busy: false,
  state: 'idle', pending: null, queued: 0, lastError: '',
};

const listeners = new Set<(s: EngineSnapshot) => void>();
/** Speech is a side effect the engine requests; the view owns the voice. */
let speakFn: ((text: string) => void) | null = null;

function emit(patch: Partial<EngineSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn(snapshot);
}

export function subscribe(fn: (s: EngineSnapshot) => void): () => void {
  listeners.add(fn);
  fn(snapshot);
  return () => { listeners.delete(fn); };
}

export function getSnapshot(): EngineSnapshot {
  return snapshot;
}

/**
 * Register the speaker.
 *
 * The engine must not own a `SpeechSynthesis` handle: it outlives every view,
 * and a voice that keeps talking after its surface is gone is a bug the owner
 * cannot silence. The view lends its speaker and takes it back on unmount.
 */
export function setSpeaker(fn: ((text: string) => void) | null): void {
  speakFn = fn;
}

let msgSeq = 0;
function msgId(): string {
  msgSeq += 1;
  return `m${msgSeq}_${Date.now().toString(36)}`;
}

/* ========================================================================== *
 * Session
 * ========================================================================== */

let sessionPromise: Promise<string | null> | null = null;

/**
 * One session for the whole tab, resolved at most once.
 *
 * The promise is cached rather than the id, because two commands arriving in
 * the same tick would otherwise both see `sessionId === null` and both create
 * a session — splitting the owner's conversation in half at random.
 */
async function ensureSession(): Promise<string | null> {
  if (snapshot.sessionId) return snapshot.sessionId;
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        const sessions = await listSessionsAction();
        const id = sessions[0]?.sessionId ?? await createSessionAction('Live');
        if (id) emit({ sessionId: id });
        return id ?? null;
      } catch {
        sessionPromise = null;   // allow a retry on the next command
        return null;
      }
    })();
  }
  return sessionPromise;
}

let historyLoaded = false;

/** Restore the transcript once per tab. Safe to call from every mount. */
export async function loadHistory(limit = 12): Promise<void> {
  if (historyLoaded) return;
  const id = await ensureSession();
  if (!id) return;
  historyLoaded = true;
  try {
    const { turns } = await getSessionAction(id);
    const restored: EngineMsg[] = [];
    for (const t of turns.slice(-limit)) {
      if (t.userText) restored.push({ id: msgId(), who: 'you', text: t.userText });
      if (t.replyText) restored.push({ id: msgId(), who: 'jarvis', text: t.replyText });
    }
    const last = turns[turns.length - 1];
    emit({
      msgs: restored,
      pending: last?.pendingApprovalId && last.runId
        ? { approvalId: last.pendingApprovalId, runId: last.runId }
        : null,
    });
  } catch {
    historyLoaded = false;   // a convenience, not a guarantee — allow a retry
  }
}

/* ========================================================================== *
 * The queue
 * ========================================================================== */

interface QueuedCommand {
  text: string;
  transport: 'text' | 'voice';
  contextNote?: string;
}

const queue: QueuedCommand[] = [];
let running = false;
/** Last accepted command, for the duplicate window. */
let lastAccepted = { text: '', at: 0 };

/**
 * Window in which an identical command is a duplicate delivery rather than a
 * deliberate repetition.
 *
 * Wider than the voice hook's own guard because the paths that duplicate here
 * are slower: a remount, a double-submitted form, a stale prop. Still short
 * enough that an owner re-asking after seeing an answer is heard.
 */
const DUPLICATE_WINDOW_MS = 6000;

/** Longest a queued command may wait before it is dropped as stale. */
const QUEUE_TTL_MS = 90_000;
const QUEUE_MAX = 5;

/**
 * Submit a command. THE single entry point — text box, dictation, wake word.
 *
 * Returns false when the command was rejected as a duplicate or the queue is
 * full, so a caller can tell "not sent" from "sent and pending".
 */
export function submit(raw: string, opts: SubmitOptions = {}): boolean {
  const text = raw.trim();
  if (!text) return false;

  const now = Date.now();
  if (text === lastAccepted.text && now - lastAccepted.at < DUPLICATE_WINDOW_MS) return false;
  // Also reject something already sitting in the queue: two deliveries of one
  // utterance can arrive further apart than the time window.
  if (queue.some((q) => q.text === text)) return false;
  if (queue.length >= QUEUE_MAX) return false;

  lastAccepted = { text, at: now };
  const cmd: QueuedCommand = { text, transport: opts.transport ?? 'text', contextNote: opts.contextNote };
  queuedAt.set(cmd, now);
  queue.push(cmd);
  emit({ queued: queue.length });
  void drain();
  return true;
}

/** Timestamped so a command that waited out a long turn is not run stale. */
const queuedAt = new WeakMap<QueuedCommand, number>();

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const cmd = queue.shift()!;
      emit({ queued: queue.length });
      const age = Date.now() - (queuedAt.get(cmd) ?? Date.now());
      /* A command the owner gave 90 seconds ago, behind a turn that took the
       * whole time, is probably no longer what they want — and acting on it
       * silently is worse than not acting. */
      if (age > QUEUE_TTL_MS) continue;
      await runTurn(cmd);
    }
  } finally {
    running = false;
  }
}

/* ========================================================================== *
 * One turn
 * ========================================================================== */

async function runTurn(cmd: QueuedCommand): Promise<void> {
  emit({
    msgs: [...snapshot.msgs, { id: msgId(), who: 'you', text: cmd.text }],
    steps: [],
    busy: true,
    state: 'thinking',
    lastError: '',
  });

  const sessionId = await ensureSession();
  if (!sessionId) {
    emit({
      busy: false,
      state: 'error',
      msgs: [...snapshot.msgs, { id: msgId(), who: 'jarvis', text: 'اتصال به کرنل برقرار نشد. دوباره تلاش کنید.' }],
    });
    return;
  }

  const prompt = cmd.contextNote ? `${cmd.text}\n\n[context] ${cmd.contextNote}` : cmd.text;
  const collected: string[] = [];

  try {
    const res = await fetch(`/api/jarvis-stream?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: prompt, transport: cmd.transport }),
    });
    if (!res.ok || !res.body) throw new Error('stream unavailable');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    type FinalTurn = { replyText?: string; status?: string; pendingApprovalId?: string | null; runId?: string | null };
    let final: FinalTurn | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const ev = /event: (.+)/.exec(chunk)?.[1];
        const dm = /data: (.+)/.exec(chunk);
        if (!ev || !dm) continue;
        let data: Record<string, unknown>;
        try { data = JSON.parse(dm[1]) as Record<string, unknown>; } catch { continue; }

        if (ev === 'loop.step') {
          const summary = String(data.summary ?? data.toolName ?? '');
          if (summary) { collected.push(summary); emit({ steps: [...collected], state: 'acting' }); }
        }
        if (ev === 'turn.final') final = data as FinalTurn;
      }
    }

    const reply = String(final?.replyText ?? '…');
    emit({
      msgs: [...snapshot.msgs, { id: msgId(), who: 'jarvis', text: reply, steps: [...collected], spoken: cmd.transport === 'voice' }],
      pending: final?.pendingApprovalId && final.runId
        ? { approvalId: final.pendingApprovalId, runId: final.runId }
        : null,
      state: final?.pendingApprovalId ? 'waiting_approval' : 'idle',
    });
    // Answer in the medium the owner used. The speaker belongs to the view,
    // so a missing one means nobody is listening — not an error.
    if (cmd.transport === 'voice') speakFn?.(reply);
  } catch {
    // Non-streaming fallback: the answer still arrives, just without steps.
    try {
      const r = await sendTurnAction(sessionId, prompt, cmd.transport);
      const reply = r?.replyText ?? 'پاسخی دریافت نشد.';
      emit({
        msgs: [...snapshot.msgs, { id: msgId(), who: 'jarvis', text: reply, spoken: cmd.transport === 'voice' }],
        pending: r?.pendingApprovalId && r.runId ? { approvalId: r.pendingApprovalId, runId: r.runId } : null,
        state: r?.pendingApprovalId ? 'waiting_approval' : 'idle',
      });
      if (cmd.transport === 'voice') speakFn?.(reply);
    } catch {
      emit({
        state: 'error',
        lastError: 'پاسخ دریافت نشد. اتصال کرنل را بررسی کنید.',
        msgs: [...snapshot.msgs, { id: msgId(), who: 'jarvis', text: 'پاسخ دریافت نشد. اتصال کرنل را بررسی کنید.' }],
      });
    }
  } finally {
    emit({ busy: false, steps: [] });
  }
}

/* ========================================================================== *
 * Approvals
 * ========================================================================== */

export async function decideApproval(
  action: 'approve' | 'reject',
  decide: (approvalId: string, action: 'approve' | 'reject') => Promise<{ replyText?: string } | null>,
): Promise<void> {
  const p = snapshot.pending;
  if (!p) return;
  emit({ busy: true, state: 'thinking', pending: null });
  try {
    const r = await decide(p.approvalId, action);
    const reply = r?.replyText ?? (action === 'approve' ? 'انجام شد.' : 'رد شد.');
    emit({ msgs: [...snapshot.msgs, { id: msgId(), who: 'jarvis', text: reply }], state: 'idle' });
  } catch {
    emit({ state: 'error', lastError: 'تصمیم ثبت نشد.' });
  } finally {
    emit({ busy: false });
  }
}

/** Test seam — resets module state between cases. Never called by the app. */
export function __resetEngineForTests(): void {
  snapshot = { sessionId: null, msgs: [], steps: [], busy: false, state: 'idle', pending: null, queued: 0, lastError: '' };
  listeners.clear();
  queue.length = 0;
  running = false;
  lastAccepted = { text: '', at: 0 };
  sessionPromise = null;
  historyLoaded = false;
  speakFn = null;
}
