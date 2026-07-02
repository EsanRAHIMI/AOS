'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { voiceStartAction, voiceSendAction, voiceConfirmAction, voiceDecidePermissionAction, voiceEndSessionAction, type VoiceTurn } from '@/app/voice/actions';
import { useRealtimeVoiceSession, type RealtimeState } from '@/hooks/useRealtimeVoiceSession';
import { UtteranceGate } from '@/lib/utteranceGate';

/** Phase 19.5 — strict operator state machine. One utterance → one command →
 *  one response/proposal → one controlled execution path. */
type DockState =
  | 'idle' | 'listening' | 'capturing' | 'finalizing' | 'thinking'
  | 'proposal_ready' | 'waiting_confirmation' | 'executing' | 'speaking' | 'interrupted' | 'error';

interface ChatItem { who: 'user' | 'agent'; text: string }
interface Pending { turn: VoiceTurn }

/** Floating, always-available voice + text operator (production pipeline).
 *
 * Every candidate utterance — realtime transcript, browser STT final, typed
 * text — passes through ONE UtteranceGate: final-only, min length, dedupe,
 * single in-flight lock, echo suppression. The gateway enforces the same
 * rules server-side, plus RBAC / safe mode / approvals on every action. */
export function VoiceOperatorDock({ role }: { role: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [state, setStateRaw] = useState<DockState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [speaker, setSpeaker] = useState(true);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [hint, setHint] = useState('');

  const gateRef = useRef<UtteranceGate | null>(null);
  if (!gateRef.current) gateRef.current = new UtteranceGate();
  const gate = gateRef.current;

  const stateRef = useRef<DockState>('idle');
  const setState = (s: DockState): void => { stateRef.current = s; setStateRaw(s); };
  const recRef = useRef<{ stop?: () => void; abort?: () => void } | null>(null);
  const finalBufRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<ChatItem[]>([]);
  const rtActiveRef = useRef(false);
  const speakerRef = useRef(true);
  speakerRef.current = speaker;
  chatRef.current = chat;

  const speechSupported = typeof window !== 'undefined' && (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window));

  const rt = useRealtimeVoiceSession(sessionId, {
    onFinalUserUtterance: (text) => { void submitCommand(text, 'voice'); },
    onEnded: (meta) => {
      if (!sessionId) return;
      const summary = chatRef.current.slice(-6).map((m) => `${m.who}: ${m.text}`).join(' | ').slice(0, 800);
      void voiceEndSessionAction(sessionId, { durationSec: meta.durationSec, connectionMode: 'realtime', interactionMode: rt.interactionMode, transcriptSummary: summary, errorSummary: meta.error, fallbackReason: meta.fallbackReason });
    },
  });
  const rtActive: boolean = (['connected', 'listening', 'speaking', 'thinking', 'interrupted'] as RealtimeState[]).includes(rt.state);
  rtActiveRef.current = rtActive;

  // Mirror realtime speaking into the gate (echo suppression) and dock state.
  useEffect(() => {
    gate.markSpeaking(rt.state === 'speaking');
    if (rt.state === 'speaking' && stateRef.current !== 'executing') setState('speaking');
    if (rt.state !== 'speaking' && stateRef.current === 'speaking') setState(rtActive ? 'listening' : 'idle');
  }, [rt.state, rtActive, gate]);

  // Realtime priority: the moment realtime is active, browser STT must be off.
  useEffect(() => {
    if (rtActive) { stopBrowserListening(); try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtActive]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [chat, pending, interimText, rt.partialUserText, rt.partialAssistantText]);

  const showHint = (text: string): void => {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(''), 2500);
  };

  /* ------------------------------ speech out ------------------------------ */
  const speak = (text: string): void => {
    if (!speakerRef.current) return;
    if (rtActiveRef.current) { rt.speak(text); return; }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 400));
      // TTS lifecycle drives echo suppression: browser STT is stopped while we
      // speak and input is gated for echoGuardMs afterwards.
      u.onstart = () => { gate.markSpeaking(true); stopBrowserListening(); if (stateRef.current === 'idle' || stateRef.current === 'thinking') setState('speaking'); };
      u.onend = () => { gate.markSpeaking(false); if (stateRef.current === 'speaking') setState('idle'); };
      u.onerror = () => { gate.markSpeaking(false); if (stateRef.current === 'speaking') setState('idle'); };
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };

  const interrupt = (): void => {
    if (rtActiveRef.current) rt.interrupt();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    gate.reset();
    setInterimText(''); finalBufRef.current = '';
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setState(rtActiveRef.current ? 'listening' : 'idle');
  };

  /* ------------------------------- session ------------------------------- */
  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    const id = await voiceStartAction(pathname);
    setSessionId(id);
    return id;
  }

  /* -------------------- THE single command entry point -------------------- */
  const submitCommand = useCallback(async (text: string, modality: 'voice' | 'text'): Promise<void> => {
    const verdict = gate.evaluate(text, true, { voice: modality === 'voice' });
    if (!verdict.accept) {
      if (verdict.reason === 'busy') showHint('Busy with the previous command — interrupt or wait.');
      else if (verdict.reason === 'too_short' && modality === 'text') showHint('Command too short.');
      return; // interim/echo/duplicate/short voice fragments: silently ignored by design
    }
    // A typed command while the assistant speaks implies "move on": cut audio first.
    if (modality === 'text' && gate.speaking) interrupt();
    gate.markSubmitted(text);
    setInterimText('');
    setChat((c) => [...c, { who: 'user', text: text.trim() }]);
    setState('thinking');
    try {
      const sid = await ensureSession();
      if (!sid) { setChat((c) => [...c, { who: 'agent', text: 'I cannot reach the kernel right now.' }]); setState('error'); return; }
      const turn = await voiceSendAction(sid, text.trim(), pathname, modality);
      // Server-side gate agreed it's a duplicate/fragment → drop silently.
      if (turn.duplicate || turn.ignored) { setChat((c) => c.slice(0, -1)); setState(rtActiveRef.current ? 'listening' : 'idle'); return; }
      if (gate.acceptAssistant(turn.reply)) {
        setChat((c) => [...c, { who: 'agent', text: turn.reply }]);
        speak(turn.reply);
      }
      if (turn.blocked) { setPending(null); setState(rtActiveRef.current ? 'listening' : 'idle'); }
      else if (turn.confirm === 'light') { setPending({ turn }); setState('proposal_ready'); }
      else if (turn.confirm === 'approval') { setPending({ turn }); setState('waiting_confirmation'); }
      else { setPending(null); if (stateRef.current === 'thinking') setState(rtActiveRef.current ? 'listening' : 'idle'); }
    } catch {
      setChat((c) => [...c, { who: 'agent', text: 'Command failed — kernel unreachable.' }]);
      setState('error');
    } finally {
      gate.markHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sessionId]);

  async function confirmPending(): Promise<void> {
    if (!pending) return;
    const { turn } = pending;
    setState('executing'); setPending(null);
    let summary = '';
    try {
      if (turn.confirm === 'approval' && turn.permissionId) {
        const r = await voiceDecidePermissionAction(turn.permissionId, 'approve');
        summary = r.message || `Permission ${r.status}. Review and execute on Overview.`;
      } else if (turn.toolCallId) {
        const r = await voiceConfirmAction(turn.toolCallId);
        summary = r.summary;
      }
    } catch { summary = 'Execution failed — check the Overview.'; }
    if (gate.acceptAssistant(summary)) {
      setChat((c) => [...c, { who: 'agent', text: summary }]);
      speak(summary);
    }
    setState(rtActiveRef.current ? 'listening' : 'idle');
  }

  async function rejectPending(): Promise<void> {
    if (!pending) return;
    if (pending.turn.confirm === 'approval' && pending.turn.permissionId) await voiceDecidePermissionAction(pending.turn.permissionId, 'reject');
    setPending(null);
    setChat((c) => [...c, { who: 'agent', text: 'Cancelled. No action taken.' }]);
    setState(rtActiveRef.current ? 'listening' : 'idle');
  }

  async function startRealtime(): Promise<void> {
    const sid = await ensureSession();
    if (!sid) { setChat((c) => [...c, { who: 'agent', text: 'I cannot reach the kernel right now.' }]); return; }
    stopBrowserListening();
    await rt.connect();
  }

  /* --------------- browser STT fallback (final-only + debounce) --------------- */
  function stopBrowserListening(): void {
    try { recRef.current?.abort?.(); recRef.current?.stop?.(); } catch { /* ignore */ }
    recRef.current = null;
    setListening(false);
    setInterimText('');
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }

  function toggleListen(): void {
    if (!speechSupported || rtActive) return;
    if (listening) { stopBrowserListening(); if (stateRef.current === 'listening' || stateRef.current === 'capturing') setState('idle'); return; }
    if (gate.speaking || gate.busy) { showHint('Busy — interrupt or wait.'); return; }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor() as {
      lang: string; continuous: boolean; interimResults: boolean;
      onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
      onend: () => void; onerror: () => void; start: () => void; stop: () => void; abort: () => void;
    };
    rec.lang = 'en-US';
    rec.continuous = false;      // one utterance per tap
    rec.interimResults = true;   // interim = DISPLAY ONLY, never a command
    finalBufRef.current = '';

    rec.onresult = (e) => {
      // Assistant speaking → everything we "hear" is echo; display nothing.
      if (gate.speaking) return;
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) {
          if (i >= e.resultIndex || !finalBufRef.current.includes(txt.trim())) {
            finalBufRef.current = `${finalBufRef.current} ${txt}`.trim();
          }
        } else interim += txt;
      }
      setInterimText(interim.trim());
      if (interim) setState('capturing');
      // End-of-utterance gate: submit ONCE after silenceMs with no new finals.
      if (finalBufRef.current) {
        setState('finalizing');
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const cmd = finalBufRef.current;
          finalBufRef.current = '';
          setInterimText('');
          stopBrowserListening();
          void submitCommand(cmd, 'voice');
        }, gate.config.silenceMs);
      }
    };
    rec.onend = () => {
      setListening(false);
      // If a final buffer exists but the silence timer hasn't fired (engine
      // ended early), let the pending timer submit it — never submit here too.
      if (!finalBufRef.current && !silenceTimerRef.current && (stateRef.current === 'listening' || stateRef.current === 'capturing')) setState('idle');
    };
    rec.onerror = () => { setListening(false); setInterimText(''); };
    recRef.current = rec as unknown as { stop?: () => void; abort?: () => void };
    setListening(true); setState('listening');
    try { rec.start(); } catch { setListening(false); setState('idle'); }
  }

  /* --------------------------------- UI --------------------------------- */
  const fmtClock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const stateColor: Record<DockState, string> = {
    idle: 'var(--accent)', listening: 'var(--ok)', capturing: 'var(--ok)', finalizing: 'var(--warn)',
    thinking: 'var(--warn)', proposal_ready: 'var(--warn)', waiting_confirmation: 'var(--warn)',
    executing: 'var(--accent-2)', speaking: 'var(--accent)', interrupted: 'var(--warn)', error: 'var(--err)',
  };
  const rtStatusLabel: Record<RealtimeState, string> = {
    idle: '', connecting: 'connecting…', connected: 'realtime', listening: 'listening', speaking: 'speaking',
    thinking: 'thinking', interrupted: 'interrupted', permission_needed: 'mic blocked', fallback: 'fallback', error: 'connection error',
  };
  const dotColor = rtActive ? (rt.state === 'speaking' ? 'var(--accent)' : rt.state === 'thinking' ? 'var(--warn)' : 'var(--ok)') : stateColor[state];
  const statusText = rtActive || rt.state === 'connecting' ? rtStatusLabel[rt.state] : state.replace(/_/g, ' ');

  function closeDock(): void {
    if (rtActive) rt.disconnect('user');
    stopBrowserListening();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    gate.reset();
    setOpen(false); setState('idle');
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open voice operator"
        onClick={() => { setOpen(true); setState('idle'); if (chat.length === 0) setChat([{ who: 'agent', text: 'Operator online. Give me a command — I always ask before any change.' }]); }}
        style={{ position: 'fixed', right: 18, bottom: 'calc(18px + env(safe-area-inset-bottom))', zIndex: 60, width: 54, height: 54, borderRadius: '50%', border: '1px solid var(--border-2)', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: '#06122b', fontSize: 22, cursor: 'pointer', boxShadow: '0 10px 30px -8px rgba(110,168,255,0.7)' }}
      >🎙</button>
    );
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 60, width: 'min(380px, calc(100vw - 32px))', maxHeight: 'min(72vh, 580px)', display: 'flex', flexDirection: 'column' }} className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: `0 0 8px ${dotColor}`, flexShrink: 0 }} />
          <b style={{ fontSize: 13 }}>Voice Operator</b>
          <span className="m" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{statusText}</span>
          {rtActive && <span className="m" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtClock(rt.elapsedSec)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Mute speaker" onClick={() => { setSpeaker((s) => !s); interrupt(); }}>{speaker ? '🔊' : '🔇'}</button>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Interrupt" onClick={interrupt}>⏹</button>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} onClick={closeDock}>—</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        {rtActive ? (
          <>
            <span className="badge ok">realtime</span>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} title={rt.interactionMode === 'push_to_talk' ? 'Switch to always listening' : 'Switch to push-to-talk'} onClick={() => rt.setInteractionMode(rt.interactionMode === 'push_to_talk' ? 'always_listening' : 'push_to_talk')}>
              {rt.interactionMode === 'push_to_talk' ? 'push-to-talk' : '👂 always listening'}
            </button>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} title="End realtime voice" onClick={() => rt.disconnect('user')}>end voice</button>
            {rt.audioBlocked && <button type="button" className="chip" style={{ cursor: 'pointer', color: 'var(--warn)' }} onClick={rt.unlockAudio}>🔈 enable audio</button>}
          </>
        ) : rt.state === 'connecting' ? (
          <span className="badge warn">connecting realtime…</span>
        ) : (
          <>
            <span className={`badge ${speechSupported ? 'ok' : 'warn'}`}>{speechSupported ? 'browser voice + text' : 'text mode'}</span>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Start low-latency realtime voice (needs configured provider)" onClick={() => void startRealtime()}>⚡ start realtime</button>
            {rt.state === 'error' && <button type="button" className="chip" style={{ cursor: 'pointer', color: 'var(--warn)' }} onClick={() => void startRealtime()}>↻ reconnect</button>}
            {rt.state === 'permission_needed' && <span className="badge err">mic blocked</span>}
            {rt.state === 'fallback' && <span className="badge warn">fallback</span>}
          </>
        )}
        {hint && <span className="m" style={{ fontSize: 10.5, color: 'var(--warn)' }}>{hint}</span>}
      </div>
      {(rt.state === 'fallback' || rt.state === 'error' || rt.state === 'permission_needed') && rt.detail && (
        <div className="m" style={{ fontSize: 10.5, marginBottom: 6 }}>{rt.detail}</div>
      )}
      {rtActive && (
        <div title="Microphone input level" style={{ height: 3, borderRadius: 2, background: 'var(--glass-2)', marginBottom: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round((rt.micOpen ? rt.micLevel : 0) * 100)}%`, background: rt.micOpen ? 'var(--ok)' : 'var(--border-2)', transition: 'width 120ms linear' }} />
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px', minHeight: 120 }}>
        {chat.map((m, i) => (
          <div key={i} style={{ alignSelf: m.who === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div className={m.who === 'user' ? 'glass' : ''} style={{ padding: '8px 11px', borderRadius: 12, fontSize: 13, background: m.who === 'agent' ? 'var(--glass-2)' : undefined, border: m.who === 'agent' ? '1px solid var(--border)' : undefined }}>{m.text}</div>
          </div>
        ))}
        {(interimText || rt.partialUserText) && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
            <div className="glass" style={{ padding: '8px 11px', borderRadius: 12, fontSize: 13, fontStyle: 'italic', opacity: 0.6 }}>{interimText || rt.partialUserText}…</div>
          </div>
        )}
        {rt.partialAssistantText && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
            <div style={{ padding: '8px 11px', borderRadius: 12, fontSize: 13, fontStyle: 'italic', opacity: 0.85, background: 'var(--glass-2)', border: '1px solid var(--border)' }}>🔊 {rt.partialAssistantText}</div>
          </div>
        )}
        {pending && (
          <div className="glass" style={{ padding: 10, border: `1px solid ${pending.turn.riskLevel === 'critical' || pending.turn.riskLevel === 'high' ? 'rgba(255,107,129,0.4)' : 'var(--border-2)'}` }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className={`badge ${pending.turn.riskLevel === 'critical' || pending.turn.riskLevel === 'high' ? 'err' : pending.turn.riskLevel === 'medium' ? 'warn' : 'ok'}`}>{pending.turn.riskLevel} risk</span>
              {pending.turn.ownerOnly && <span className="badge err">owner only</span>}
              {pending.turn.safeMode && <span className="badge warn">safe mode</span>}
            </div>
            <div className="m" style={{ fontSize: 11.5, marginBottom: 8 }}>{pending.turn.confirm === 'approval' ? 'This needs approval before any change. Approving creates a plan you finish on Overview.' : 'Confirm to run this read-only/low-risk action.'}</div>
            <div className="actions">
              <button type="button" className="btn btn-ok" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={confirmPending}>{pending.turn.confirm === 'approval' ? 'Approve' : 'Confirm'}</button>
              <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={rejectPending}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); const t = input; setInput(''); void submitCommand(t, 'text'); }} style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {rtActive ? (
          rt.interactionMode === 'push_to_talk' ? (
            <button
              type="button"
              aria-label="Hold to talk"
              onPointerDown={() => rt.setTalking(true)}
              onPointerUp={() => rt.setTalking(false)}
              onPointerLeave={() => rt.micOpen && rt.setTalking(false)}
              className={`btn ${rt.micOpen ? 'btn-err' : 'btn-ghost'}`}
              style={{ padding: '8px 12px', touchAction: 'none' }}
            >{rt.micOpen ? '●' : '🎤'}</button>
          ) : (
            <span title="Always listening" style={{ fontSize: 16, padding: '0 4px', color: 'var(--ok)' }}>●</span>
          )
        ) : speechSupported ? (
          <button type="button" aria-label="Talk (browser speech)" onClick={toggleListen} className={`btn ${listening ? 'btn-err' : 'btn-ghost'}`} style={{ padding: '8px 12px' }}>{listening ? '●' : '🎤'}</button>
        ) : null}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={rtActive ? (rt.interactionMode === 'push_to_talk' ? 'Hold 🎤 or type…' : 'Speak or type…') : speechSupported ? 'Speak or type…' : 'Type a request…'} style={{ flex: 1, fontSize: 13, padding: '9px 11px' }} />
        <button type="submit" className="btn btn-primary" style={{ padding: '8px 13px' }}>Send</button>
      </form>
      {!speechSupported && !rtActive && <div className="m" style={{ fontSize: 10.5, marginTop: 4 }}>Text mode (browser voice not available). Start realtime voice above when a provider is configured.</div>}
    </div>
  );
}
