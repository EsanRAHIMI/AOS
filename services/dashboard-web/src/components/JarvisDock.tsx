'use client';
/**
 * JarvisDock — THE assistant, on every page (D-184).
 *
 * The dashboard used to carry two different chat surfaces: this dock's
 * predecessor (`OperatorConsole`) drove the deterministic operator pipeline
 * (`/v1/operator/*` — goal→tool-step mapping, no reasoning, its own session
 * model), while `/jarvis` drove the real K2 agent (`/v1/jarvis/*` — the
 * shared multi-turn loop, governed tool registry, Memory v2, missions,
 * approval pause/resume). Two assistants meant two memories, two histories
 * and two behaviours for the same question. The weak one is gone; this dock
 * is the same agent as `/jarvis`, in a different frame.
 *
 * Concretely: the dock and the `/jarvis` stage share ONE session list, ONE
 * transcript and ONE memory, because both call the same server actions and
 * the same streaming route. Continue on any page a conversation you started
 * on the stage.
 *
 * Mounted once in `app/layout.tsx`, so its state survives route changes by
 * construction (App Router keeps layout client trees mounted). Hidden on
 * `/jarvis`, where the full-screen stage already IS this interface.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  createSessionAction, decideApprovalAction, getBriefingAction, getSessionAction,
  listSessionsAction, sendTurnAction, type JarvisBriefingView,
} from '@/app/jarvis/actions';
import { invalidateBlocks } from '@/components/UniverseProvider';
import { blocksForApprovalDecision } from '@/lib/realtimeBlocks';
import { bidiProps } from '@/lib/rtl';
import { RichText } from '@/components/RichText';

type DockState = 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'error';

interface Msg {
  who: 'you' | 'jarvis';
  text: string;
  /** Real tool steps the agent took for this turn (never invented). */
  steps?: string[];
}

const BRIEFING_REFRESH_MS = 120_000;
/** Enough to recognise the conversation without re-rendering a whole archive. */
const HISTORY_TURNS = 20;

export function JarvisDock({ role }: { role: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<JarvisBriefingView | null>(null);
  const [state, setState] = useState<DockState>('idle');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [pending, setPending] = useState<{ approvalId: string; runId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const historyLoaded = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** `/jarvis` is this same agent full-screen — never show two inputs. */
  const hidden = pathname === '/jarvis' || pathname.startsWith('/jarvis/') || pathname.startsWith('/login');

  /* ------------------------------- briefing ------------------------------ */
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    const pull = async () => {
      try {
        const b = await getBriefingAction();
        if (alive) setBriefing(b);
      } catch { /* keep the last good briefing */ }
    };
    void pull();
    const id = setInterval(pull, BRIEFING_REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [hidden]);

  /* ------------------------- keyboard: ⌘K / Ctrl+K ----------------------- */
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, steps, open]);

  /** One shared session with the /jarvis stage — same history, same memory. */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionRef.current) return sessionRef.current;
    try {
      const sessions = await listSessionsAction();
      if (sessions[0]?.sessionId) { sessionRef.current = sessions[0].sessionId; return sessionRef.current; }
      sessionRef.current = await createSessionAction('Live');
      return sessionRef.current;
    } catch { return null; }
  }, []);

  /* --------------------------- history on open --------------------------- */
  /**
   * D-188 — every turn was already persisted server-side (and the model kept
   * seeing them through the transcript context), but this panel mounted empty
   * and never fetched them, so to the owner the conversation looked erased on
   * every page. Load the tail of the real session the first time it opens.
   */
  useEffect(() => {
    if (!open || hidden || historyLoaded.current) return;
    historyLoaded.current = true;
    let alive = true;
    void (async () => {
      const sessionId = await ensureSession();
      if (!sessionId || !alive) return;
      try {
        const { turns } = await getSessionAction(sessionId);
        if (!alive || turns.length === 0) return;
        const restored: Msg[] = [];
        for (const t of turns.slice(-HISTORY_TURNS)) {
          if (t.userText) restored.push({ who: 'you', text: t.userText });
          if (t.replyText) restored.push({ who: 'jarvis', text: t.replyText });
        }
        // Anything typed while the fetch was in flight stays at the bottom.
        setMsgs((live) => [...restored, ...live]);
      } catch {
        // History is a convenience; failing to load it must not block the input.
        historyLoaded.current = false;
      }
    })();
    return () => { alive = false; };
  }, [open, hidden, ensureSession]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { who: 'you', text }]);
    setSteps([]);
    setBusy(true);
    setState('thinking');

    const sessionId = await ensureSession();
    if (!sessionId) {
      setBusy(false);
      setState('error');
      setMsgs((m) => [...m, { who: 'jarvis', text: 'اتصال به کرنل برقرار نشد. دوباره تلاش کنید.' }]);
      return;
    }

    // The page the owner is on is real context: "این را باز کن" means something
    // different on /finance than on /loop.
    const withContext = `${text}\n\n[context] current page: ${pathname}`;
    const collected: string[] = [];

    try {
      // Streaming first — the owner sees the real tool steps as they happen.
      const res = await fetch(`/api/jarvis-stream?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: withContext, transport: 'text' }),
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
          const evLine = chunk.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!evLine || !dataLine) continue;
          const event = evLine.slice(7).trim();
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataLine.slice(6)) as Record<string, unknown>; } catch { continue; }

          if (event === 'loop.step') {
            const tool = String(payload.toolName ?? '');
            const summary = String(payload.summary ?? '');
            const line = tool ? `${tool} — ${summary}` : summary;
            if (line.trim()) { collected.push(line); setSteps([...collected]); }
            setState('acting');
          } else if (event === 'turn.final') {
            final = payload as FinalTurn;
          } else if (event === 'turn.error') {
            throw new Error(String(payload.message ?? 'turn failed'));
          }
        }
      }

      if (!final) throw new Error('no final turn');
      const done: FinalTurn = final;
      setMsgs((m) => [...m, { who: 'jarvis', text: String(done.replyText ?? ''), steps: collected.slice() }]);
      if (done.pendingApprovalId && done.runId) {
        setPending({ approvalId: done.pendingApprovalId, runId: done.runId });
        setState('waiting_approval');
      } else {
        setState('idle');
      }
    } catch {
      // Non-streaming fallback — the same turn pipeline, just without live steps.
      try {
        const r = await sendTurnAction(sessionId, withContext, 'text');
        if (r) {
          setMsgs((m) => [...m, { who: 'jarvis', text: r.replyText, steps: collected.slice() }]);
          if (r.pendingApprovalId && r.runId) {
            setPending({ approvalId: r.pendingApprovalId, runId: r.runId });
            setState('waiting_approval');
          } else setState('idle');
        } else {
          setMsgs((m) => [...m, { who: 'jarvis', text: 'پاسخی از کرنل دریافت نشد.' }]);
          setState('error');
        }
      } catch {
        setMsgs((m) => [...m, { who: 'jarvis', text: 'خطا در اجرای این درخواست.' }]);
        setState('error');
      }
    } finally {
      setBusy(false);
      setSteps([]);
    }
  }, [busy, ensureSession, pathname]);

  const decide = useCallback(async (action: 'approve' | 'reject') => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await decideApprovalAction(pending.approvalId, pending.runId, action);
      setPending(r?.pendingApprovalId && pending.runId ? { approvalId: r.pendingApprovalId, runId: pending.runId } : null);
      if (r?.replyText) setMsgs((m) => [...m, { who: 'jarvis', text: r.replyText }]);
      setState(r?.pendingApprovalId ? 'waiting_approval' : 'idle');
      // The homepage's live blocks sit outside this component's provider tree,
      // so refresh them the same way the old console did — an approval usually
      // changes exactly what those blocks show.
      invalidateBlocks(blocksForApprovalDecision());
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  }, [pending]);

  if (hidden) return null;

  const priority = briefing?.primaryPriority || briefing?.headline || '';
  const stateLabel: Record<DockState, string> = {
    idle: 'آمادهٔ کار',
    thinking: 'در حال فکر کردن…',
    acting: 'در حال انجام کار…',
    waiting_approval: 'در انتظار تأیید شما',
    error: 'خطا — دوباره تلاش کنید',
  };

  return (
    <div className={`jdock${open ? ' jdock--open' : ''}`} dir="rtl">
      {!open && (
        <button type="button" className="jdock-pill" onClick={() => setOpen(true)} title="جارویس (⌘K)">
          <span className={`jdock-dot jdock-dot--${state}`} />
          <span className="jdock-pill-text" {...bidiProps(priority || 'جارویس')}>
            {priority || 'جارویس — بپرسید یا دستور بدهید'}
          </span>
          <kbd className="jdock-kbd" dir="ltr">⌘K</kbd>
        </button>
      )}

      {open && (
        <section className="jdock-panel" aria-label="جارویس">
          <header className="jdock-head">
            <span className={`jdock-dot jdock-dot--${state}`} />
            <strong>جارویس</strong>
            <span className="jdock-state">{stateLabel[state]}</span>
            <a className="jdock-link" href="/jarvis" title="نمای کامل">تمام‌صفحه</a>
            <button type="button" className="jdock-x" onClick={() => setOpen(false)} aria-label="بستن">×</button>
          </header>

          <div className="jdock-scroll" ref={scrollRef}>
            {msgs.length === 0 && (
              <p className="jdock-empty" {...bidiProps(priority)}>
                {priority
                  ? `اولویت امروز: ${priority}`
                  : 'هرچه لازم دارید بپرسید — به همهٔ سرویس‌ها، حافظه، مأموریت‌ها و حلقهٔ زنده دسترسی دارم.'}
              </p>
            )}
            {msgs.map((m, i) => (
              <article key={i} className={`jdock-msg jdock-msg--${m.who}`}>
                {m.who === 'jarvis' ? (
                  <>
                    <div className="jdock-avatar" aria-hidden>J</div>
                    <div className="jdock-body">
                      {/* Structured, not a wall of prose: headings, lists and
                        * label/value rows come from the reply itself. */}
                      <RichText text={m.text} />
                      {m.steps && m.steps.length > 0 && (
                        <details className="jdock-did">
                          <summary>{m.steps.length} کاری که انجام دادم</summary>
                          <ul className="jdock-steps">
                            {m.steps.map((s, k) => <li key={k} {...bidiProps(s)}>{s}</li>)}
                          </ul>
                        </details>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="jdock-body">
                    <p className="jdock-you-text" {...bidiProps(m.text)}>{m.text}</p>
                  </div>
                )}
              </article>
            ))}
            {busy && (
              <div className="jdock-msg jdock-msg--jarvis">
                <div className="jdock-avatar jdock-avatar--live" aria-hidden>J</div>
                <div className="jdock-body">
                  {steps.length > 0 ? (
                    <ul className="jdock-steps jdock-steps--live">
                      {steps.map((s, k) => <li key={k} {...bidiProps(s)}>{s}</li>)}
                    </ul>
                  ) : (
                    <span className="jdock-typing" aria-label="در حال کار"><i /><i /><i /></span>
                  )}
                </div>
              </div>
            )}
          </div>

          {pending && (
            <div className="jdock-approval">
              <span>این اقدام نیاز به تأیید شما دارد.</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void decide('approve')}>تأیید</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void decide('reject')}>رد</button>
            </div>
          )}

          <form
            className="jdock-form"
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`دستور یا پرسش… (${pathname})`}
              disabled={busy}
              data-auto-dir=""
              {...bidiProps(input || 'دستور')}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="ارسال">{busy ? '…' : '↵'}</button>
          </form>
          <p className="jdock-foot" dir="rtl">
            نقش: <span dir="ltr">{role}</span> · همان جلسه و حافظهٔ صفحهٔ <a href="/jarvis">/jarvis</a>
          </p>
        </section>
      )}
    </div>
  );
}
