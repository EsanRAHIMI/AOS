'use client';
/**
 * THE conversation with Jarvis — one implementation, every surface (D-190).
 *
 * There were two: `JarvisDock` (bottom-right panel) and `JarvisWorkspace`
 * (the `/jarvis` stage). They shared the session list and the streaming route,
 * so the DATA was one — but the UI, the rendering and the behaviour were
 * written twice, and they drifted. History loading existed in one; the
 * structured reply renderer landed in one first; the approval bar looked
 * different in each. Two copies of a conversation is two products.
 *
 * This component owns the whole interaction: resolving the session, loading
 * real history, streaming a turn with live tool steps, the approval pause, and
 * rendering replies as structure. Surfaces differ only in `variant`, which is
 * a CSS concern — never a behavioural one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSessionAction, decideApprovalAction, getSessionAction, listSessionsAction, sendTurnAction,
} from '@/app/jarvis/actions';
import { invalidateBlocks } from '@/components/UniverseProvider';
import { blocksForApprovalDecision } from '@/lib/realtimeBlocks';
import { RichText } from '@/components/RichText';
import { bidiProps } from '@/lib/rtl';
import { useVoice } from '@/lib/useVoice';
import { publishJarvisPresence } from '@/lib/jarvisPresence';

export type ConversationState = 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'error';

export interface ConversationMsg {
  who: 'you' | 'jarvis';
  text: string;
  /** Real tool steps the agent took for this turn (never invented). */
  steps?: string[];
}

/** Enough to recognise the conversation without re-rendering a whole archive. */
const HISTORY_TURNS = 30;

export interface JarvisConversationProps {
  /** Layout only. Behaviour is identical in every one. */
  variant: 'rudder' | 'overlay' | 'page';
  /** Controlled session (the /jarvis session switcher); omit to use the latest. */
  sessionId?: string | null;
  /** Extra text appended to the prompt — the dock passes the current page. */
  contextNote?: string;
  placeholder?: string;
  emptyHint?: string;
  onState?: (s: ConversationState) => void;
  /** Fires after a turn completes so a host can refresh its own panels. */
  onTurnComplete?: (sessionId: string) => void;
  autoFocus?: boolean;
  /** Read replies aloud when the turn arrived by voice. Default on. */
  voice?: boolean;
}

export function JarvisConversation({
  variant, sessionId: controlledSessionId, contextNote, placeholder, emptyHint,
  onState, onTurnComplete, autoFocus, voice = true,
}: JarvisConversationProps) {
  const [msgs, setMsgs] = useState<ConversationMsg[]>([]);
  const [input, setInput] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setStateRaw] = useState<ConversationState>('idle');
  const [pending, setPending] = useState<{ approvalId: string; runId: string } | null>(null);

  const sessionRef = useRef<string | null>(controlledSessionId ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setState = useCallback((s: ConversationState) => { setStateRaw(s); onState?.(s); }, [onState]);


  useEffect(() => { sessionRef.current = controlledSessionId ?? sessionRef.current; }, [controlledSessionId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, steps]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  /** One shared session across every surface — same history, same memory. */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionRef.current) return sessionRef.current;
    try {
      const sessions = await listSessionsAction();
      if (sessions[0]?.sessionId) { sessionRef.current = sessions[0].sessionId; return sessionRef.current; }
      sessionRef.current = await createSessionAction('Live');
      return sessionRef.current;
    } catch { return null; }
  }, []);

  /* ------------------------------- history ------------------------------- */
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = controlledSessionId ?? await ensureSession();
      if (!id || !alive || loadedFor.current === id) return;
      loadedFor.current = id;
      try {
        const { turns } = await getSessionAction(id);
        if (!alive) return;
        const restored: ConversationMsg[] = [];
        for (const t of turns.slice(-HISTORY_TURNS)) {
          if (t.userText) restored.push({ who: 'you', text: t.userText });
          if (t.replyText) restored.push({ who: 'jarvis', text: t.replyText });
        }
        setMsgs(restored);
        const last = turns[turns.length - 1];
        setPending(last?.pendingApprovalId && last.runId ? { approvalId: last.pendingApprovalId, runId: last.runId } : null);
      } catch {
        loadedFor.current = null;   // history is a convenience; allow a retry
      }
    })();
    return () => { alive = false; };
  }, [controlledSessionId, ensureSession]);

  /* --------------------------------- send -------------------------------- */
  /** True when THIS turn was dictated — decides whether the reply is spoken. */
  const spokenTurnRef = useRef(false);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { who: 'you', text }]);
    setSteps([]);
    setBusy(true);
    setState('thinking');

    const sessionId = controlledSessionId ?? await ensureSession();
    if (!sessionId) {
      setBusy(false);
      setState('error');
      setMsgs((m) => [...m, { who: 'jarvis', text: 'اتصال به کرنل برقرار نشد. دوباره تلاش کنید.' }]);
      return;
    }

    const prompt = contextNote ? `${text}\n\n[context] ${contextNote}` : text;
    const collected: string[] = [];

    try {
      // Streaming first — the owner sees the real tool steps as they happen.
      const res = await fetch(`/api/jarvis-stream?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: prompt, transport: 'text' }),
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
          try { data = JSON.parse(dm[1]); } catch { continue; }

          if (ev === 'loop.step') {
            const summary = String(data.summary ?? data.toolName ?? '');
            if (summary) { collected.push(summary); setSteps([...collected]); }
            setState('acting');
          }
          if (ev === 'turn.final') final = data as FinalTurn;
        }
      }

      if (final?.pendingApprovalId && final.runId) {
        setPending({ approvalId: final.pendingApprovalId, runId: final.runId });
        setState('waiting_approval');
      } else {
        setState('idle');
      }
      const reply = String(final?.replyText ?? '…');
      setMsgs((m) => [...m, { who: 'jarvis', text: reply, steps: [...collected] }]);
      // Answer in the medium the owner used: spoken question, spoken answer.
      if (voice && spokenTurnRef.current) v.speak(reply);
      spokenTurnRef.current = false;
    } catch {
      // Non-streaming fallback: the answer still arrives, just without steps.
      try {
        const r = await sendTurnAction(sessionId, prompt, 'text');
        setMsgs((m) => [...m, { who: 'jarvis', text: r?.replyText ?? 'پاسخی دریافت نشد.' }]);
        if (r?.pendingApprovalId && r.runId) { setPending({ approvalId: r.pendingApprovalId, runId: r.runId }); setState('waiting_approval'); }
        else setState('idle');
      } catch {
        setState('error');
        setMsgs((m) => [...m, { who: 'jarvis', text: 'پاسخ دریافت نشد. اتصال کرنل را بررسی کنید.' }]);
      }
    } finally {
      setBusy(false);
      setSteps([]);
      onTurnComplete?.(sessionId);
    }
  }, [busy, contextNote, controlledSessionId, ensureSession, onTurnComplete, setState, voice]);

  // Dictation feeds the very same send path — voice is a transport, not a mode.
  const v = useVoice({
    onFinal: (text) => { spokenTurnRef.current = true; void send(text); },
  });
  /* Broadcast what Jarvis is doing so the /jarvis canvas can pulse with it
   * WITHOUT owning a second conversation to derive it from. */
  useEffect(() => {
    publishJarvisPresence(
      v.listening ? 'listening'
        : v.speaking ? 'speaking'
          : state === 'acting' ? 'acting'
            : state === 'thinking' ? 'thinking'
              : state === 'error' ? 'error'
                : 'idle',
    );
  }, [state, v.listening, v.speaking]);

  const decide = useCallback(async (action: 'approve' | 'reject') => {
    if (!pending) return;
    setBusy(true);
    setState('thinking');
    const r = await decideApprovalAction(pending.approvalId, pending.runId, action);
    setPending(null);
    setBusy(false);
    setState('idle');
    if (r?.replyText) setMsgs((m) => [...m, { who: 'jarvis', text: r.replyText }]);
    invalidateBlocks(blocksForApprovalDecision());
    if (sessionRef.current) onTurnComplete?.(sessionRef.current);
  }, [pending, onTurnComplete, setState]);

  return (
    <div className={`jconv jconv--${variant}`} dir="rtl">
      <div className="jconv-scroll" ref={scrollRef}>
        {msgs.length === 0 && (
          <p className="jconv-empty" {...bidiProps(emptyHint ?? '')}>
            {emptyHint ?? 'هرچه لازم دارید بپرسید — به همهٔ سرویس‌ها، حافظه، مأموریت‌ها، هویت و حلقهٔ زنده دسترسی دارم.'}
          </p>
        )}

        {msgs.map((m, i) => (
          <article key={i} className={`jconv-msg jconv-msg--${m.who}`}>
            {m.who === 'jarvis' ? (
              <>
                <div className="jconv-avatar" aria-hidden>J</div>
                <div className="jconv-body">
                  <RichText text={m.text} />
                  {m.steps && m.steps.length > 0 && (
                    <details className="jconv-did">
                      <summary>{m.steps.length} کاری که انجام دادم</summary>
                      <ul className="jconv-steps">
                        {m.steps.map((s, k) => <li key={k} {...bidiProps(s)}>{s}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              </>
            ) : (
              <div className="jconv-body">
                <p className="jconv-you" {...bidiProps(m.text)}>{m.text}</p>
              </div>
            )}
          </article>
        ))}

        {busy && (
          <article className="jconv-msg jconv-msg--jarvis">
            <div className="jconv-avatar jconv-avatar--live" aria-hidden>J</div>
            <div className="jconv-body">
              {steps.length > 0 ? (
                <ul className="jconv-steps jconv-steps--live">
                  {steps.map((s, k) => <li key={k} {...bidiProps(s)}>{s}</li>)}
                </ul>
              ) : (
                <span className="jconv-typing" aria-label="در حال کار"><i /><i /><i /></span>
              )}
            </div>
          </article>
        )}
      </div>

      {pending && (
        <div className="jconv-approval">
          <span>برای ادامه به تأیید شما نیاز دارم.</span>
          <button type="button" className="btn" disabled={busy} onClick={() => void decide('approve')}>تأیید</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void decide('reject')}>رد</button>
        </div>
      )}

      <form
        className="jconv-form"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        {v.supported && (
          <button
            type="button"
            className={`jconv-mic${v.listening ? ' on' : ''}`}
            onClick={v.toggleListening}
            aria-pressed={v.listening}
            aria-label={v.listening ? 'قطع میکروفون' : 'گفتن با صدا'}
            title={v.listening ? 'در حال شنیدن — برای توقف بزنید' : 'گفتن با صدا'}
          >
            <span className="jconv-mic-ico" aria-hidden>◉</span>
          </button>
        )}

        <input
          ref={inputRef}
          value={v.listening && v.interim ? v.interim : input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={v.stopSpeaking}
          placeholder={v.listening ? 'در حال شنیدن…' : (placeholder ?? 'دستور یا پرسش…')}
          disabled={busy}
          readOnly={v.listening}
          {...bidiProps(v.listening ? v.interim : input)}
        />

        {v.speaking ? (
          <button type="button" className="jconv-send jconv-send--stop" onClick={v.stopSpeaking} aria-label="توقف صدا">◼</button>
        ) : (
          <button type="submit" className="jconv-send" disabled={busy || !input.trim()} aria-label="ارسال">↵</button>
        )}
      </form>

      <p className="jconv-foot" aria-live="polite">
        {state === 'error' ? 'خطا در ارتباط'
          : state === 'waiting_approval' ? 'در انتظار تأیید شما'
            : v.listening ? 'میکروفون باز است — بعد از مکث ارسال می‌شود'
              : v.speaking ? 'در حال خواندن پاسخ'
                : 'همان جلسه، حافظه و صدا در همهٔ صفحه‌ها'}
      </p>
    </div>
  );
}
