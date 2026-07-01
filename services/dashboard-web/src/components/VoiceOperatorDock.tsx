'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { voiceStartAction, voiceSendAction, voiceConfirmAction, voiceDecidePermissionAction, type VoiceTurn } from '@/app/voice/actions';

type Mode = 'collapsed' | 'listening' | 'speaking' | 'thinking' | 'waiting_for_permission' | 'executing' | 'reporting' | 'error';
interface ChatItem { who: 'user' | 'agent'; text: string }
interface Pending { turn: VoiceTurn }

/** Floating, always-available voice + text operator. Works with text and the
 *  browser's native speech (STT/TTS); no provider key required. The gateway
 *  enforces RBAC / safe mode / approvals on every action. */
export function VoiceOperatorDock({ role }: { role: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('collapsed');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [speaker, setSpeaker] = useState(true);
  const [pushToTalk, setPushToTalk] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<unknown>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const speechSupported = typeof window !== 'undefined' && (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window));

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [chat, pending]);

  const speak = (text: string): void => {
    if (!speaker || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.slice(0, 400)); window.speechSynthesis.speak(u); } catch { /* ignore */ }
  };
  const interrupt = (): void => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };

  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    const id = await voiceStartAction(pathname);
    setSessionId(id);
    return id;
  }

  async function send(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    setInput('');
    setChat((c) => [...c, { who: 'user', text: t }]);
    setMode('thinking');
    const sid = await ensureSession();
    if (!sid) { setChat((c) => [...c, { who: 'agent', text: 'I cannot reach the kernel right now.' }]); setMode('error'); return; }
    const turn = await voiceSendAction(sid, t, pathname);
    setChat((c) => [...c, { who: 'agent', text: turn.reply }]);
    speak(turn.reply);
    if (turn.blocked) { setMode('reporting'); setPending(null); }
    else if (turn.confirm === 'light' || turn.confirm === 'approval') { setMode('waiting_for_permission'); setPending({ turn }); }
    else { setMode('reporting'); setPending(null); }
  }

  async function confirmPending(): Promise<void> {
    if (!pending) return;
    const { turn } = pending;
    setMode('executing'); setPending(null);
    let summary = '';
    if (turn.confirm === 'approval' && turn.permissionId) {
      const r = await voiceDecidePermissionAction(turn.permissionId, 'approve');
      summary = r.message || `Permission ${r.status}. Review and execute on Overview.`;
    } else if (turn.toolCallId) {
      const r = await voiceConfirmAction(turn.toolCallId);
      summary = r.summary;
    }
    setChat((c) => [...c, { who: 'agent', text: summary }]);
    speak(summary);
    setMode('reporting');
  }
  async function rejectPending(): Promise<void> {
    if (!pending) return;
    if (pending.turn.confirm === 'approval' && pending.turn.permissionId) await voiceDecidePermissionAction(pending.turn.permissionId, 'reject');
    setPending(null); setChat((c) => [...c, { who: 'agent', text: 'Cancelled. No action taken.' }]); setMode('reporting');
  }

  function toggleListen(): void {
    if (!speechSupported) return;
    if (listening) { (recRef.current as { stop?: () => void } | null)?.stop?.(); setListening(false); return; }
    interrupt();
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor() as { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void };
    rec.lang = 'en-US'; rec.continuous = false; rec.interimResults = false;
    rec.onresult = (e) => { const said = e.results?.[0]?.[0]?.transcript ?? ''; if (said) void send(said); };
    rec.onend = () => setListening(false);
    recRef.current = rec; setListening(true); setMode('listening');
    try { rec.start(); } catch { setListening(false); }
  }

  const modeColor: Record<Mode, string> = { collapsed: 'var(--accent)', listening: 'var(--ok)', speaking: 'var(--accent)', thinking: 'var(--warn)', waiting_for_permission: 'var(--warn)', executing: 'var(--accent-2)', reporting: 'var(--ok)', error: 'var(--err)' };

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open voice operator"
        onClick={() => { setOpen(true); setMode('reporting'); if (chat.length === 0) setChat([{ who: 'agent', text: 'Hi — I\'m your operator copilot. Ask me what\'s happening, to run a health check, analyze history, run a security check, or research. I always ask before any change.' }]); }}
        style={{ position: 'fixed', right: 18, bottom: 'calc(18px + env(safe-area-inset-bottom))', zIndex: 60, width: 54, height: 54, borderRadius: '50%', border: '1px solid var(--border-2)', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: '#06122b', fontSize: 22, cursor: 'pointer', boxShadow: '0 10px 30px -8px rgba(110,168,255,0.7)' }}
      >🎙</button>
    );
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 60, width: 'min(380px, calc(100vw - 32px))', maxHeight: 'min(70vh, 560px)', display: 'flex', flexDirection: 'column' }} className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: modeColor[mode], boxShadow: `0 0 8px ${modeColor[mode]}` }} />
          <b style={{ fontSize: 13 }}>Voice Operator</b>
          <span className="m" style={{ fontSize: 11 }}>{mode.replace(/_/g, ' ')}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Mute speaker" onClick={() => { setSpeaker((s) => !s); interrupt(); }}>{speaker ? '🔊' : '🔇'}</button>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} title="Interrupt" onClick={interrupt}>⏹</button>
          <button type="button" className="chip" style={{ cursor: 'pointer' }} onClick={() => { setOpen(false); setMode('collapsed'); }}>—</button>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px', minHeight: 120 }}>
        {chat.map((m, i) => (
          <div key={i} style={{ alignSelf: m.who === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div className={m.who === 'user' ? 'glass' : ''} style={{ padding: '8px 11px', borderRadius: 12, fontSize: 13, background: m.who === 'agent' ? 'var(--glass-2)' : undefined, border: m.who === 'agent' ? '1px solid var(--border)' : undefined }}>{m.text}</div>
          </div>
        ))}
        {pending && (
          <div className="glass" style={{ padding: 10, border: `1px solid ${pending.turn.riskLevel === 'critical' || pending.turn.riskLevel === 'high' ? 'rgba(255,107,129,0.4)' : 'var(--border-2)'}` }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className={`badge ${pending.turn.riskLevel === 'critical' || pending.turn.riskLevel === 'high' ? 'err' : pending.turn.riskLevel === 'medium' ? 'warn' : 'ok'}`}>{pending.turn.riskLevel} risk</span>
              {pending.turn.ownerOnly && <span className="badge err">owner only</span>}
              {pending.turn.safeMode && <span className="badge warn">safe mode</span>}
            </div>
            <div className="m" style={{ fontSize: 11.5, marginBottom: 8 }}>{pending.turn.confirm === 'approval' ? 'This needs approval before any change. Approving creates a plan you finish on Overview.' : 'Confirm to run this read/low-risk action.'}</div>
            <div className="actions">
              <button type="button" className="btn btn-ok" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={confirmPending}>{pending.turn.confirm === 'approval' ? 'Approve' : 'Confirm'}</button>
              <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={rejectPending}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {speechSupported && (
          <button type="button" aria-label="Push to talk" onMouseDown={pushToTalk ? toggleListen : undefined} onClick={pushToTalk ? undefined : toggleListen} className={`btn ${listening ? 'btn-err' : 'btn-ghost'}`} style={{ padding: '8px 12px' }}>{listening ? '●' : '🎤'}</button>
        )}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={speechSupported ? 'Speak or type…' : 'Type a request…'} style={{ flex: 1, fontSize: 13, padding: '9px 11px' }} />
        <button type="submit" className="btn btn-primary" style={{ padding: '8px 13px' }}>Send</button>
      </form>
      {!speechSupported && <div className="m" style={{ fontSize: 10.5, marginTop: 4 }}>Text mode (browser voice not available). Realtime voice activates when a provider is configured.</div>}
    </div>
  );
}
