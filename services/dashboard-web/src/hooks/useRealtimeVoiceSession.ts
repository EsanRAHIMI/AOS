'use client';
/**
 * Phase 19 — useRealtimeVoiceSession: full realtime WebRTC voice session hook.
 *
 * Safety architecture (do not weaken):
 * - The browser only ever holds a SHORT-LIVED ephemeral client secret minted
 *   server-side by the voice-operator-agent. The real API key never reaches here.
 * - SDP offer/answer goes through the gateway proxy (`/v1/voice/realtime/sdp`)
 *   so connection events are recorded sanitized. OpenAI also supports direct
 *   browser SDP with the ephemeral token; we keep the proxy as the single path.
 * - The realtime model NEVER acts. `turn_detection.create_response = false`:
 *   the model cannot answer on its own. Every final user transcript is handed
 *   to the caller (`onFinalUserUtterance`), which routes it through the
 *   deterministic tool-mediation endpoint `/v1/voice/message`. Only the
 *   kernel-produced reply text is then spoken via `speak()` — so audio output
 *   is always grounded in deterministic kernel responses, and raw model output
 *   can neither mutate state nor claim it did.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceRealtimeTokenAction, voiceRealtimeSdpAction, type RealtimeGrant } from '@/app/voice/actions';

export type RealtimeState =
  | 'idle' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'thinking'
  | 'interrupted' | 'permission_needed' | 'fallback' | 'error';

export type InteractionMode = 'push_to_talk' | 'always_listening';

export interface RealtimeVoiceApi {
  state: RealtimeState;
  /** Why we are in fallback/error, human-readable and safe to display. */
  detail: string;
  model: string;
  /** 0..1 microphone input level (for the listening indicator). */
  micLevel: number;
  elapsedSec: number;
  maxSessionSeconds: number;
  interactionMode: InteractionMode;
  /** True while the mic track is live and streaming to the provider. */
  micOpen: boolean;
  /** Autoplay was blocked; call unlockAudio() from a user gesture. */
  audioBlocked: boolean;
  partialUserText: string;
  partialAssistantText: string;
  connect: () => Promise<void>;
  disconnect: (reason?: string) => void;
  interrupt: () => void;
  /** Push-to-talk: open/close the mic. In always_listening the mic stays open. */
  setTalking: (on: boolean) => void;
  setInteractionMode: (m: InteractionMode) => void;
  /** Speak kernel-produced text through the realtime voice (verbatim). */
  speak: (text: string) => void;
  unlockAudio: () => void;
}

export interface RealtimeCallbacks {
  /** Final user utterance → caller routes it through deterministic mediation and MAY call speak() with the kernel reply. */
  onFinalUserUtterance: (text: string) => void;
  onUserTranscript?: (text: string, final: boolean) => void;
  onAssistantTranscript?: (text: string, final: boolean) => void;
  onStateChange?: (s: RealtimeState) => void;
  onEnded?: (meta: { durationSec: number; error: string; fallbackReason: string }) => void;
}

interface RtEvent { type?: string; delta?: string; transcript?: string; text?: string; error?: { message?: string } }

export function useRealtimeVoiceSession(sessionId: string | null, cb: RealtimeCallbacks): RealtimeVoiceApi {
  const [state, setStateRaw] = useState<RealtimeState>('idle');
  const [detail, setDetail] = useState('');
  const [model, setModel] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [maxSessionSeconds, setMaxSessionSeconds] = useState(600);
  const [interactionMode, setInteractionModeRaw] = useState<InteractionMode>('push_to_talk');
  const [micOpen, setMicOpen] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [partialUserText, setPartialUserText] = useState('');
  const [partialAssistantText, setPartialAssistantText] = useState('');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const apiVariantRef = useRef<'ga' | 'beta'>('ga');
  const modeRef = useRef<InteractionMode>('push_to_talk');
  const stateRef = useRef<RealtimeState>('idle');
  /** Phase 19.5 — echo guard: when assistant audio last stopped (ms epoch). */
  const speakingEndedAtRef = useRef(0);
  const ECHO_GUARD_MS = 400;
  const errorsRef = useRef<string[]>([]);
  const cbRef = useRef(cb);
  cbRef.current = cb;

  const setState = useCallback((s: RealtimeState): void => {
    stateRef.current = s; setStateRaw(s); cbRef.current.onStateChange?.(s);
  }, []);

  const dcSend = useCallback((payload: Record<string, unknown>): void => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') { try { dc.send(JSON.stringify(payload)); } catch { /* channel raced closed */ } }
  }, []);

  /* ------------------------------ teardown ------------------------------ */
  const disconnect = useCallback((reason = ''): void => {
    const wasActive = pcRef.current !== null;
    if (levelTimerRef.current) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null; }
    try { dcRef.current?.close(); } catch { /* already closed */ }
    try { pcRef.current?.close(); } catch { /* already closed */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close().catch(() => undefined);
    dcRef.current = null; pcRef.current = null; micRef.current = null; audioCtxRef.current = null;
    if (audioElRef.current) { audioElRef.current.srcObject = null; audioElRef.current.remove(); audioElRef.current = null; }
    setMicOpen(false); setMicLevel(0); setPartialUserText(''); setPartialAssistantText('');
    if (wasActive) {
      const durationSec = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
      cbRef.current.onEnded?.({ durationSec, error: errorsRef.current.join('; ').slice(0, 400), fallbackReason: reason });
    }
    if (reason && reason !== 'user') setDetail(reason);
    setState(reason && reason !== 'user' && reason !== 'session_limit' ? 'error' : 'idle');
    if (reason === 'session_limit') { setDetail('Session time limit reached — reconnect to continue.'); setState('error'); }
  }, [setState]);

  useEffect(() => () => { disconnect('user'); }, [disconnect]);

  /* --------------------------- provider events --------------------------- */
  const handleEvent = useCallback((raw: string): void => {
    let e: RtEvent; try { e = JSON.parse(raw) as RtEvent; } catch { return; }
    const t = e.type ?? '';
    // User speech lifecycle (server VAD). Barge-in: speech during playback cancels it.
    if (t === 'input_audio_buffer.speech_started') {
      if (stateRef.current === 'speaking') { dcSend({ type: 'response.cancel' }); dcSend({ type: 'output_audio_buffer.clear' }); }
      setPartialUserText(''); setState('listening');
      return;
    }
    if (t === 'input_audio_buffer.speech_stopped') { setState('thinking'); return; }
    // User transcript (GA + beta event names).
    if (t === 'conversation.item.input_audio_transcription.delta' && e.delta) {
      setPartialUserText((p) => p + e.delta); cbRef.current.onUserTranscript?.(e.delta, false); return;
    }
    if (t === 'conversation.item.input_audio_transcription.completed') {
      const text = (e.transcript ?? '').trim();
      setPartialUserText('');
      // Phase 19.5 echo guard: a "user" transcript that finalizes while the
      // assistant is speaking (or right after) is the system hearing itself —
      // drop it. Real barge-in still works: speech_started already cancelled
      // playback, which flips state off 'speaking' before transcription lands.
      const echo = stateRef.current === 'speaking' || Date.now() - speakingEndedAtRef.current < ECHO_GUARD_MS;
      if (text && !echo) { cbRef.current.onUserTranscript?.(text, true); setState('thinking'); cbRef.current.onFinalUserUtterance(text); }
      else setState(modeRef.current === 'always_listening' ? 'listening' : 'connected');
      return;
    }
    // Assistant speech transcript (GA `output_audio_transcript`, beta `audio_transcript`).
    if ((t === 'response.output_audio_transcript.delta' || t === 'response.audio_transcript.delta') && e.delta) {
      setPartialAssistantText((p) => p + e.delta); cbRef.current.onAssistantTranscript?.(e.delta, false); return;
    }
    if (t === 'response.output_audio_transcript.done' || t === 'response.audio_transcript.done') {
      const text = e.transcript ?? '';
      setPartialAssistantText('');
      if (text) cbRef.current.onAssistantTranscript?.(text, true);
      return;
    }
    if (t === 'response.created') { setState('speaking'); return; }
    if (t === 'response.done') { speakingEndedAtRef.current = Date.now(); setState(modeRef.current === 'always_listening' ? 'listening' : 'connected'); return; }
    if (t === 'error') {
      const msg = e.error?.message ?? 'provider error';
      errorsRef.current.push(msg);
      // Non-fatal provider errors (e.g. cancel with nothing active) shouldn't kill the session.
      if (/session|token|expired|auth/i.test(msg)) disconnect(`provider error: ${msg}`);
    }
  }, [dcSend, disconnect, setState]);

  /* ------------------------------- connect ------------------------------- */
  const connect = useCallback(async (): Promise<void> => {
    if (!sessionId || pcRef.current) return;
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') { setDetail('WebRTC is not available in this browser.'); setState('fallback'); return; }
    errorsRef.current = [];
    setDetail(''); setState('connecting');

    // 1) Server-issued ephemeral grant (never the real API key).
    let grant: RealtimeGrant;
    try { grant = await voiceRealtimeTokenAction(); } catch { grant = { ok: false, maxSessionSeconds: 600, error: 'kernel unreachable' }; }
    if (!grant.ok || !grant.clientSecret || !grant.model) {
      setDetail(grant.error === 'voice provider not configured' || !grant.error ? 'Realtime voice provider not configured — using browser voice / text.' : `Realtime unavailable: ${grant.error}`);
      setState('fallback'); return;
    }
    setModel(grant.model); setMaxSessionSeconds(grant.maxSessionSeconds);
    apiVariantRef.current = grant.apiVariant ?? 'ga';

    // 2) Microphone.
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setDetail(name === 'NotAllowedError' ? 'Microphone permission denied — voice input disabled, text still works.' : name === 'NotFoundError' ? 'No microphone found — text still works.' : 'Could not open the microphone — text still works.');
      setState(name === 'NotAllowedError' ? 'permission_needed' : 'fallback');
      return;
    }
    micRef.current = mic;
    // Push-to-talk default: track muted until the user opens it.
    mic.getAudioTracks().forEach((tr) => { tr.enabled = modeRef.current === 'always_listening'; });
    setMicOpen(modeRef.current === 'always_listening');

    // Input level meter (local analysis only; nothing leaves the browser here).
    try {
      const actx = new AudioContext();
      audioCtxRef.current = actx;
      const src = actx.createMediaStreamSource(mic);
      const analyser = actx.createAnalyser(); analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      levelTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setMicLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      }, 120);
    } catch { /* meter is cosmetic */ }

    // 3) Peer connection + remote audio + data channel.
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));
    pc.ontrack = (ev) => {
      const el = document.createElement('audio');
      el.autoplay = true; el.srcObject = ev.streams[0]; el.style.display = 'none';
      document.body.appendChild(el);
      audioElRef.current = el;
      el.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        errorsRef.current.push(`peer ${pc.connectionState}`);
        disconnect('Network connection lost — press Reconnect.');
      }
    };
    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.onmessage = (ev) => handleEvent(String(ev.data));
    dc.onopen = () => {
      // Configure the session: transcription on, AUTOMATIC RESPONSES OFF.
      // The model only speaks when speak() injects kernel-produced text.
      const instructions = 'You are the voice of a system operator console. Speak ONLY the response text you are given via response instructions, naturally and concisely. Never invent system state, never claim an action was taken, never offer to execute anything yourself. All actions are handled by the kernel outside this conversation.';
      if (apiVariantRef.current === 'beta') {
        dcSend({ type: 'session.update', session: { instructions, input_audio_transcription: { model: 'whisper-1' }, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: true } } });
      } else {
        dcSend({ type: 'session.update', session: { type: 'realtime', instructions, audio: { input: { transcription: { model: 'whisper-1' }, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: true } } } } });
      }
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      clockRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - startedAtRef.current) / 1000);
        setElapsedSec(secs);
        if (secs >= maxSessionSecondsRef.current) disconnect('session_limit');
      }, 1000);
      setState(modeRef.current === 'always_listening' ? 'listening' : 'connected');
    };
    dc.onclose = () => { if (stateRef.current !== 'idle' && stateRef.current !== 'error') disconnect('Realtime channel closed.'); };

    // 4) SDP offer → gateway proxy → provider answer.
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await voiceRealtimeSdpAction({ sessionId, clientSecret: grant.clientSecret, model: grant.model, sdp: offer.sdp ?? '', apiVariant: apiVariantRef.current });
      if (!r.ok || !r.sdp) { errorsRef.current.push(r.error ?? 'sdp failed'); disconnect(r.error ?? 'SDP exchange failed.'); return; }
      await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
    } catch (err) {
      errorsRef.current.push(err instanceof Error ? err.message : 'webrtc setup failed');
      disconnect('Could not establish the realtime connection.');
    }
  }, [sessionId, dcSend, disconnect, handleEvent, setState]);

  // Keep the session cap readable inside the interval without re-arming it.
  const maxSessionSecondsRef = useRef(600);
  useEffect(() => { maxSessionSecondsRef.current = maxSessionSeconds; }, [maxSessionSeconds]);

  /* ------------------------------- controls ------------------------------ */
  const interrupt = useCallback((): void => {
    dcSend({ type: 'response.cancel' });
    dcSend({ type: 'output_audio_buffer.clear' });
    speakingEndedAtRef.current = Date.now();
    setPartialAssistantText('');
    if (pcRef.current) setState(modeRef.current === 'always_listening' ? 'listening' : 'interrupted');
  }, [dcSend, setState]);

  const setTalking = useCallback((on: boolean): void => {
    const mic = micRef.current;
    if (!mic) return;
    if (modeRef.current === 'always_listening' && !on) return; // stop via mode toggle, visibly
    mic.getAudioTracks().forEach((tr) => { tr.enabled = on; });
    setMicOpen(on);
    if (on && stateRef.current === 'speaking') interrupt();
    if (on) setState('listening');
    else if (stateRef.current === 'listening') setState('connected');
  }, [interrupt, setState]);

  const setInteractionMode = useCallback((m: InteractionMode): void => {
    modeRef.current = m; setInteractionModeRaw(m);
    const mic = micRef.current;
    if (mic) {
      const open = m === 'always_listening';
      mic.getAudioTracks().forEach((tr) => { tr.enabled = open; });
      setMicOpen(open);
      if (pcRef.current) setState(open ? 'listening' : 'connected');
    }
  }, [setState]);

  const speak = useCallback((text: string): void => {
    const clean = text.trim().slice(0, 1200);
    if (!clean || !dcRef.current || dcRef.current.readyState !== 'open') return;
    // Kernel-grounded speech only: the instruction embeds the exact reply text.
    dcSend({ type: 'response.create', response: { instructions: `Say this to the user, naturally but without changing the meaning or adding anything: ${clean}` } });
  }, [dcSend]);

  const unlockAudio = useCallback((): void => {
    audioElRef.current?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
  }, []);

  return {
    state, detail, model, micLevel, elapsedSec, maxSessionSeconds, interactionMode, micOpen, audioBlocked,
    partialUserText, partialAssistantText,
    connect, disconnect, interrupt, setTalking, setInteractionMode, speak, unlockAudio,
  };
}
