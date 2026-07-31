'use client';
/**
 * THE conversation with Jarvis — one implementation, every surface (D-190),
 * and since D-211 a VIEW rather than the engine itself.
 *
 * History: there were two implementations (`JarvisDock` and
 * `JarvisWorkspace`) that shared data and duplicated behaviour. D-190 merged
 * them here. That fixed the duplication but left a subtler fault: this
 * component still OWNED the conversation — session, message list, `busy`,
 * `send` — while being mounted only when the rudder panel is open.
 *
 * A conversation is a long-running process; a panel is a piece of furniture.
 * Tying the first to the second meant closing the panel mid-turn lost the
 * answer, and reopening it re-fired the effect that submitted a voice command
 * — one spoken sentence becoming three turns.
 *
 * So the process moved to `lib/jarvisEngine` at module scope, and what is
 * left here is rendering plus the input box. This component may now mount and
 * unmount as often as the interface likes, and nothing observable changes.
 * Surfaces still differ only in `variant`, which is a CSS concern.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { decideApprovalAction } from '@/app/jarvis/actions';
import { invalidateBlocks } from '@/components/UniverseProvider';
import { blocksForApprovalDecision } from '@/lib/realtimeBlocks';
import { RichText } from '@/components/RichText';
import { bidiProps } from '@/lib/rtl';
import { useVoice } from '@/lib/useVoice';
import { publishJarvisPresence } from '@/lib/jarvisPresence';
import {
  subscribe, getSnapshot, submit, loadHistory, setSpeaker,
  type EngineSnapshot,
} from '@/lib/jarvisEngine';

export type ConversationState = 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'error';

export interface ConversationMsg {
  who: 'you' | 'jarvis';
  text: string;
  /** Real tool steps the agent took for this turn (never invented). */
  steps?: string[];
}

export interface JarvisConversationProps {
  /** Layout only. Behaviour is identical in every one. */
  variant: 'rudder' | 'overlay' | 'page';
  /** Extra text appended to the prompt — the host passes the current page. */
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
  variant, contextNote, placeholder, emptyHint,
  onState, onTurnComplete, autoFocus, voice = true,
}: JarvisConversationProps) {
  const [snap, setSnap] = useState<EngineSnapshot>(getSnapshot);
  const [input, setInput] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* The engine is the single source of truth; this is the only subscription. */
  useEffect(() => subscribe(setSnap), []);
  useEffect(() => { void loadHistory(); }, []);

  const { msgs, steps, busy, state, pending } = snap;

  useEffect(() => { onState?.(state); }, [state, onState]);

  /* A turn ending is what hosts refresh on. Derived from the engine's busy
   * edge rather than owned here, so it still fires for a turn that started
   * while this component was unmounted. */
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && snap.sessionId) onTurnComplete?.(snap.sessionId);
    wasBusy.current = busy;
  }, [busy, snap.sessionId, onTurnComplete]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, steps]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  // Dictation feeds the very same entry point — voice is a transport, not a mode.
  const v = useVoice({
    onFinal: (text) => { submit(text, { transport: 'voice', contextNote }); },
  });

  /* Lend the engine this view's speaker, and take it back on unmount. The
   * engine must not hold a voice handle of its own: it outlives every
   * surface, and a voice still talking after its surface is gone is one the
   * owner cannot silence. */
  useEffect(() => {
    if (!voice) return;
    setSpeaker(v.speak);
    return () => setSpeaker(null);
  }, [voice, v.speak]);

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
    await decideApprovalAction(pending.approvalId, pending.runId, action);
    invalidateBlocks(blocksForApprovalDecision());
    // The engine reloads the authoritative state; nothing is inferred here.
    void loadHistory();
  }, [pending]);

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (submit(input, { contextNote })) setInput('');
  }, [input, contextNote]);

  return (
    <div className={`jconv jconv--${variant}`} dir="rtl">
      <div className="jconv-scroll" ref={scrollRef}>
        {msgs.length === 0 && (
          <p className="jconv-empty" {...bidiProps(emptyHint ?? '')}>
            {emptyHint ?? 'هرچه لازم دارید بپرسید — به همهٔ سرویس‌ها، حافظه، مأموریت‌ها، هویت و حلقهٔ زنده دسترسی دارم.'}
          </p>
        )}

        {msgs.map((m) => (
          <article key={m.id} className={`jconv-msg jconv-msg--${m.who}`}>
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

      <form className="jconv-form" onSubmit={onSubmit}>
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
          /* NOT disabled while busy (D-211): the engine queues, so the owner
           * can keep typing while a turn runs instead of waiting on a frozen
           * box. Disabling it was what made a slow turn feel like a hang. */
          readOnly={v.listening}
          {...bidiProps(v.listening ? v.interim : input)}
        />

        {v.speaking ? (
          <button type="button" className="jconv-send jconv-send--stop" onClick={v.stopSpeaking} aria-label="توقف صدا">◼</button>
        ) : (
          <button type="submit" className="jconv-send" disabled={!input.trim()} aria-label="ارسال">↵</button>
        )}
      </form>

      <p className="jconv-foot" aria-live="polite">
        {snap.queued > 0 ? `${snap.queued} دستور در صف`
          : state === 'error' ? (snap.lastError || 'خطا در ارتباط')
            : state === 'waiting_approval' ? 'در انتظار تأیید شما'
              : v.listening ? 'میکروفون باز است — بعد از مکث ارسال می‌شود'
                : v.speaking ? 'در حال خواندن پاسخ'
                  : 'همان جلسه، حافظه و صدا در همهٔ صفحه‌ها'}
      </p>
    </div>
  );
}
