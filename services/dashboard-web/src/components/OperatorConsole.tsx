'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { voiceStartAction, voiceEndSessionAction } from '@/app/voice/actions';
import { operatorCommandAction, getRuntimeSessionAction, decideRuntimePermissionAction, type RuntimeSessionView, type OperatorCommandResult } from '@/app/operator/actions';
import { useRealtimeVoiceSession, type RealtimeState } from '@/hooks/useRealtimeVoiceSession';
import { UtteranceGate } from '@/lib/utteranceGate';

/**
 * Phase X — Operator Console. The human interface to the Autonomous Operator
 * Runtime. Voice and text are equal input channels; every command goes to the
 * gateway runtime (`/v1/operator/command`), which plans, executes tools,
 * pauses for approvals, and reports. This component never executes anything
 * itself. Command hygiene (final-only, dedupe, echo suppression, single
 * in-flight) is enforced by the Phase 19.5 UtteranceGate + the server.
 */

type ConsoleState = 'idle' | 'listening' | 'capturing' | 'finalizing' | 'thinking' | 'waiting_approval' | 'executing' | 'speaking' | 'error';
interface LogItem { who: 'user' | 'operator'; text: string }

const ACTIVE_STATUSES = ['planning', 'running', 'verifying', 'waiting_approval'];
const STEP_GLYPH: Record<string, string> = { done: '✓', failed: '✕', running: '▸', pending: '○', skipped: '–', awaiting_approval: '⏸', manual_required: '!' };

export function OperatorConsole({ role }: { role: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [state, setStateRaw] = useState<ConsoleState>('idle');
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [input, setInput] = useState('');
  const [session, setSession] = useState<RuntimeSessionView | null>(null);
  const [capabilities, setCapabilities] = useState<OperatorCommandResult['groups']>([]);
  const [speaker, setSpeaker] = useState(true);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [hint, setHint] = useState('');

  const gateRef = useRef<UtteranceGate | null>(null);
  if (!gateRef.current) gateRef.current = new UtteranceGate();
  const gate = gateRef.current;

  const stateRef = useRef<ConsoleState>('idle');
  const setState = (s: ConsoleState): void => { stateRef.current = s; setStateRaw(s); };
  const recRef = useRef<{ stop?: () => void; abort?: () => void } | null>(null);
  const finalBufRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<LogItem[]>([]);
  const rtActiveRef = useRef(false);
  const speakerRef = useRef(true);
  const sessionRef = useRef<RuntimeSessionView | null>(null);
  speakerRef.current = speaker;
  logRef.current = log;
  sessionRef.current = session;

  const speechSupported = typeof window !== 'undefined' && (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window));

  const rt = useRealtimeVoiceSession(voiceSessionId, {
    onFinalUserUtterance: (text) => { void submitCommand(text, 'voice'); },
    onEnded: (meta) => {
      if (!voiceSessionId) return;
      const summary = logRef.current.slice(-6).map((m) => `${m.who}: ${m.text}`).join(' | ').slice(0, 800);
      void voiceEndSessionAction(voiceSessionId, { durationSec: meta.durationSec, connectionMode: 'realtime', interactionMode: rt.interactionMode, transcriptSummary: summary, errorSummary: meta.error, fallbackReason: meta.fallbackReason });
    },
  });
  const rtActive: boolean = (['connected', 'listening', 'speaking', 'thinking', 'interrupted'] as RealtimeState[]).includes(rt.state);
  rtActiveRef.current = rtActive;

  useEffect(() => {
    gate.markSpeaking(rt.state === 'speaking');
    if (rt.state === 'speaking' && stateRef.current !== 'executing') setState('speaking');
    if (rt.state !== 'speaking' && stateRef.current === 'speaking') setState(rtActive ? 'listening' : 'idle');
  }, [rt.state, rtActive, gate]);

  useEffect(() => {
    if (rtActive) { stopBrowserListening(); try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtActive]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [log, session, capabilities, interimText, rt.partialUserText, rt.partialAssistantText]);

  const showHint = (text: string): void => {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(''), 2500);
  };

  const speak = (text: string): void => {
    if (!speakerRef.current || !text) return;
    if (rtActiveRef.current) { rt.speak(text); return; }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 400));
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

  const say = (text: string): void => {
    if (!text || !gate.acceptAssistant(text)) return;
    setLog((c) => [...c, { who: 'operator', text }]);
    speak(text);
  };

  /* ------------------- session polling & narration ------------------- */
  const applySession = useCallback((next: RuntimeSessionView | null, announce: boolean): void => {
    const prev = sessionRef.current;
    setSession(next);
    if (!next) return;
    if (ACTIVE_STATUSES.includes(next.status)) {
      if (next.status === 'waiting_approval') { setState('waiting_approval'); if (announce && next.pendingPermission) say(`Approval needed: ${next.pendingPermission.prompt}`); }
      else setState('executing');
    } else {
      setState('idle');
      const finishedNow = !prev || ACTIVE_STATUSES.includes(prev.status) || prev.runtimeSessionId !== next.runtimeSessionId;
      if (announce && finishedNow) {
        if (next.status === 'completed') say(next.reportSummary || 'Goal completed.');
        else if (next.status === 'failed') say(`The goal failed. ${next.observations[next.observations.length - 1] ?? ''} Next: ${next.nextAction}`.trim());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (session && ACTIVE_STATUSES.includes(session.status)) {
      pollRef.current = setInterval(() => {
        void getRuntimeSessionAction(session.runtimeSessionId).then((s) => applySession(s, true));
      }, 4000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.runtimeSessionId, session?.status]);

  /* ---------------------- THE command entry point --------------------- */
  const submitCommand = useCallback(async (text: string, modality: 'voice' | 'text'): Promise<void> => {
    const verdict = gate.evaluate(text, true, { voice: modality === 'voice' });
    if (!verdict.accept) {
      if (verdict.reason === 'busy') showHint('Busy with the previous command — Stop or wait.');
      else if (verdict.reason === 'too_short' && modality === 'text') showHint('Command too short.');
      return;
    }
    if (modality === 'text' && gate.speaking) interrupt();
    gate.markSubmitted(text);
    setInterimText('');
    setCapabilities([]);
    setLog((c) => [...c, { who: 'user', text: text.trim() }]);
    setState('thinking');
    try {
      const r = await operatorCommandAction(text.trim());
      if (r.kind === 'ignored') { setLog((c) => c.slice(0, -1)); setState(rtActiveRef.current ? 'listening' : 'idle'); return; }
      if (r.kind === 'error') { say(r.reply); setState('error'); return; }
      if (r.kind === 'capabilities') { setCapabilities(r.groups); say(r.spoken); setState(rtActiveRef.current ? 'listening' : 'idle'); return; }
      if (r.kind === 'clarify') { say(r.reply); setState(rtActiveRef.current ? 'listening' : 'idle'); return; }
      // Runtime session started.
      if (r.reply) say(r.reply);
      applySession(r.session, true);
    } catch {
      say('Command failed — kernel unreachable.');
      setState('error');
    } finally {
      gate.markHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function decide(action: 'approve' | 'reject'): Promise<void> {
    if (!session?.pendingPermission) return;
    setState('executing');
    const next = await decideRuntimePermissionAction(session.pendingPermission.permissionId, action);
    if (action === 'reject') say('Rejected. The step was skipped.');
    applySession(next, true);
  }

  /* ------------- browser STT fallback (Phase 19.5 pipeline) ------------- */
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
    if (gate.speaking || gate.busy) { showHint('Busy — Stop or wait.'); return; }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor() as {
      lang: string; continuous: boolean; interimResults: boolean;
      onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
      onend: () => void; onerror: () => void; start: () => void; stop: () => void; abort: () => void;
    };
    rec.lang = 'en-US'; rec.continuous = false; rec.interimResults = true;
    finalBufRef.current = '';
    rec.onresult = (e) => {
      if (gate.speaking) return;
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) { if (i >= e.resultIndex || !finalBufRef.current.includes(txt.trim())) finalBufRef.current = `${finalBufRef.current} ${txt}`.trim(); }
        else interim += txt;
      }
      setInterimText(interim.trim());
      if (interim) setState('capturing');
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
    rec.onend = () => { setListening(false); if (!finalBufRef.current && !silenceTimerRef.current && (stateRef.current === 'listening' || stateRef.current === 'capturing')) setState('idle'); };
    rec.onerror = () => { setListening(false); setInterimText(''); };
    recRef.current = rec as unknown as { stop?: () => void; abort?: () => void };
    setListening(true); setState('listening');
    try { rec.start(); } catch { setListening(false); setState('idle'); }
  }

  async function startRealtime(): Promise<void> {
    let sid = voiceSessionId;
    if (!sid) { sid = await voiceStartAction(pathname); setVoiceSessionId(sid); }
    if (!sid) { say('I cannot reach the kernel right now.'); return; }
    stopBrowserListening();
    await rt.connect();
  }

  /* --------------------------------- UI --------------------------------- */
  const fmtClock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const stateColor: Record<ConsoleState, string> = {
    idle: 'var(--accent)', listening: 'var(--ok)', capturing: 'var(--ok)', finalizing: 'var(--warn)', thinking: 'var(--warn)',
    waiting_approval: 'var(--warn)', executing: 'var(--accent-2)', speaking: 'var(--accent)', error: 'var(--err)',
  };
  const rtLabel: Record<RealtimeState, string> = { idle: '', connecting: 'connecting', connected: 'realtime', listening: 'listening', speaking: 'speaking', thinking: 'thinking', interrupted: 'interrupted', permission_needed: 'mic blocked', fallback: 'fallback', error: 'link error' };
  const dotColor = rtActive ? (rt.state === 'speaking' ? 'var(--accent)' : 'var(--ok)') : stateColor[state];
  const statusText = session && ACTIVE_STATUSES.includes(session.status) ? session.status.replace(/_/g, ' ') : (rtActive || rt.state === 'connecting' ? rtLabel[rt.state] : state.replace(/_/g, ' '));

  function closeConsole(): void {
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
        aria-label="Open operator console"
        onClick={() => { setOpen(true); setState('idle'); if (log.length === 0) setLog([{ who: 'operator', text: 'Operator runtime online. Give me a goal — I plan, use tools, and ask before any change. Try “check the whole system” or “what can you do?”.' }]); }}
        style={{ position: 'fixed', right: 18, bottom: 'calc(18px + env(safe-area-inset-bottom))', zIndex: 60, height: 46, padding: '0 18px', borderRadius: 23, border: '1px solid var(--border-2)', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: '#06122b', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', boxShadow: '0 10px 30px -8px rgba(110,168,255,0.7)' }}
      >OPERATOR</button>
    );
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 60, width: 'min(420px, calc(100vw - 32px))', maxHeight: 'min(76vh, 640px)', display: 'flex', flexDirection: 'column' }} className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: `0 0 8px ${dotColor}`, flexShrink: 0 }} />
          <b style={{ fontSize: 13, letterSpacing: '0.02em' }}>Operator Console</b>
          <span className="m" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{statusText}</span>
          {rtActive && <span className="m" style={{ fontSize: 11 }}>{fmtClock(rt.elapsedSec)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Toggle speech output" onClick={() => { setSpeaker((s) => !s); interrupt(); }}>{speaker ? 'Audio on' : 'Audio off'}</button>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Interrupt" onClick={interrupt}>Stop</button>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} onClick={closeConsole}>Min</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        {rtActive ? (
          <>
            <span className="badge ok">realtime voice</span>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} onClick={() => rt.setInteractionMode(rt.interactionMode === 'push_to_talk' ? 'always_listening' : 'push_to_talk')}>
              {rt.interactionMode === 'push_to_talk' ? 'push-to-talk' : 'always listening'}
            </button>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} onClick={() => rt.disconnect('user')}>End voice</button>
            {rt.audioBlocked && <button type="button" className="chip" style={{ cursor: 'pointer', color: 'var(--warn)' }} onClick={rt.unlockAudio}>Enable audio</button>}
          </>
        ) : rt.state === 'connecting' ? (
          <span className="badge warn">connecting realtime</span>
        ) : (
          <>
            <span className={`badge ${speechSupported ? 'ok' : 'warn'}`}>{speechSupported ? 'voice + text' : 'text'}</span>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Low-latency realtime voice (requires configured provider)" onClick={() => void startRealtime()}>Start realtime</button>
            {rt.state === 'error' && <button type="button" className="chip" style={{ cursor: 'pointer', color: 'var(--warn)' }} onClick={() => void startRealtime()}>Reconnect</button>}
            {rt.state === 'permission_needed' && <span className="badge err">mic blocked</span>}
            {rt.state === 'fallback' && <span className="badge warn">fallback</span>}
          </>
        )}
        {hint && <span className="m" style={{ fontSize: 10.5, color: 'var(--warn)' }}>{hint}</span>}
      </div>
      {(rt.state === 'fallback' || rt.state === 'error' || rt.state === 'permission_needed') && rt.detail && <div className="m" style={{ fontSize: 10.5, marginBottom: 6 }}>{rt.detail}</div>}
      {rtActive && (
        <div title="Input level" style={{ height: 3, borderRadius: 2, background: 'var(--glass-2)', marginBottom: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round((rt.micOpen ? rt.micLevel : 0) * 100)}%`, background: rt.micOpen ? 'var(--ok)' : 'var(--border-2)', transition: 'width 120ms linear' }} />
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px', minHeight: 140 }}>
        {log.map((m, i) => (
          <div key={i} style={{ alignSelf: m.who === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
            <div className={m.who === 'user' ? 'glass' : ''} style={{ padding: '8px 11px', borderRadius: 10, fontSize: 13, background: m.who === 'operator' ? 'var(--glass-2)' : undefined, border: m.who === 'operator' ? '1px solid var(--border)' : undefined }}>{m.text}</div>
          </div>
        ))}

        {capabilities.length > 0 && (
          <div className="glass" style={{ padding: 10 }}>
            <div className="label" style={{ marginBottom: 8 }}>Live tool registry</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {capabilities.map((g, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 4 }}>{g.label.toUpperCase()}</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {g.tools.map((t, j) => (
                      <span key={j} className="chip" title={`${t.riskLevel} risk${t.requiresApproval ? ' · approval required' : ''}${t.available ? '' : ' · unavailable'}${t.example ? ` · e.g. “${t.example}”` : ''}`} style={{ fontSize: 10.5, opacity: t.available ? 1 : 0.45 }}>
                        {t.name}{t.requiresApproval ? ' *' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {session && (
          <div className="glass" style={{ padding: 10, border: '1px solid var(--border-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div className="label">Runtime session</div>
              <span className={`badge ${session.status === 'completed' ? 'ok' : session.status === 'failed' ? 'err' : 'warn'}`}>{session.status.replace(/_/g, ' ')}</span>
            </div>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}><span className="m">GOAL&nbsp;&nbsp;</span>{session.goal}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
              {session.plan.map((p, i) => (
                <div key={p.stepId} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline', opacity: p.status === 'pending' ? 0.55 : 1 }}>
                  <span style={{ width: 14, textAlign: 'center', color: p.status === 'failed' ? 'var(--err)' : p.status === 'done' ? 'var(--ok)' : p.status === 'awaiting_approval' || p.status === 'manual_required' ? 'var(--warn)' : 'var(--accent)' }}>{STEP_GLYPH[p.status] ?? '○'}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: i === session.currentStep ? 650 : 450 }}>{p.toolId.replace(/_/g, ' ')}</span>
                    {p.observation && <span className="m" style={{ fontSize: 11.5 }}> — {p.observation.slice(0, 140)}</span>}
                  </span>
                </div>
              ))}
            </div>
            {session.nextAction && <div style={{ fontSize: 12 }}><span className="m">NEXT&nbsp;&nbsp;</span>{session.nextAction}</div>}
            {session.evidenceCount > 0 && <div className="m" style={{ fontSize: 11, marginTop: 4 }}>{session.evidenceCount} evidence record{session.evidenceCount === 1 ? '' : 's'} stored</div>}

            {session.pendingPermission && (
              <div style={{ marginTop: 8, padding: 9, borderRadius: 8, border: `1px solid ${session.pendingPermission.riskLevel === 'critical' || session.pendingPermission.riskLevel === 'high' ? 'rgba(255,107,129,0.45)' : 'var(--border-2)'}`, background: 'var(--glass-2)' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span className={`badge ${session.pendingPermission.riskLevel === 'critical' || session.pendingPermission.riskLevel === 'high' ? 'err' : 'warn'}`}>{session.pendingPermission.riskLevel} risk</span>
                  {session.pendingPermission.ownerOnly && <span className="badge err">owner only</span>}
                </div>
                <div style={{ fontSize: 12, marginBottom: 8 }}>{session.pendingPermission.prompt}</div>
                <div className="actions">
                  <button type="button" className="btn btn-ok" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => void decide('approve')}>Approve</button>
                  <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => void decide('reject')}>Reject</button>
                </div>
              </div>
            )}
          </div>
        )}

        {(interimText || rt.partialUserText) && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '90%' }}>
            <div className="glass" style={{ padding: '8px 11px', borderRadius: 10, fontSize: 13, fontStyle: 'italic', opacity: 0.6 }}>{interimText || rt.partialUserText}…</div>
          </div>
        )}
        {rt.partialAssistantText && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
            <div style={{ padding: '8px 11px', borderRadius: 10, fontSize: 13, fontStyle: 'italic', opacity: 0.85, background: 'var(--glass-2)', border: '1px solid var(--border)' }}>Speaking: {rt.partialAssistantText}</div>
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); const t = input; setInput(''); void submitCommand(t, 'text'); }} style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {rtActive ? (
          rt.interactionMode === 'push_to_talk' ? (
            <button type="button" aria-label="Hold to talk" onPointerDown={() => rt.setTalking(true)} onPointerUp={() => rt.setTalking(false)} onPointerLeave={() => rt.micOpen && rt.setTalking(false)} className={`btn ${rt.micOpen ? 'btn-err' : 'btn-ghost'}`} style={{ padding: '8px 12px', touchAction: 'none', fontSize: 12.5 }}>{rt.micOpen ? 'Live' : 'Talk'}</button>
          ) : (
            <span title="Always listening" style={{ fontSize: 14, padding: '0 6px', color: 'var(--ok)', fontWeight: 700 }}>LIVE</span>
          )
        ) : speechSupported ? (
          <button type="button" aria-label="Talk (browser speech)" onClick={toggleListen} className={`btn ${listening ? 'btn-err' : 'btn-ghost'}`} style={{ padding: '8px 12px', fontSize: 12.5 }}>{listening ? 'Live' : 'Talk'}</button>
        ) : null}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Give the operator a goal…" style={{ flex: 1, fontSize: 13, padding: '9px 11px' }} />
        <button type="submit" className="btn btn-primary" style={{ padding: '8px 13px' }}>Send</button>
      </form>
    </div>
  );
}
