# voice-operator-agent

Realtime voice operator brain (Phase 18; full WebRTC wired in Phase 19). Mints
short-lived ephemeral realtime tokens (server-side; the raw API key never reaches
the browser), produces context-grounded explanations (LLM optional, deterministic
router fallback), and extracts memory + learning from finished sessions. It
**never mutates kernel state** — every action is routed through the gateway's
voice endpoints under RBAC, safe mode and approvals.

## Endpoints
Standard factory surface. `POST /.factory/task` input `{ action }`:
`realtime_token` → ephemeral client secret + model + apiVariant + maxSessionSeconds
(or "not configured"), `derive_learning` → voice_learning_event + voice_memories,
default → status + guardrails.

## Realtime WebRTC path (Phase 19)
1. Dashboard asks the gateway for a token (`POST /v1/voice/realtime-token` → this
   service). GA mint `POST /v1/realtime/client_secrets` first, beta
   `POST /v1/realtime/sessions` fallback. Only the ephemeral secret leaves the server.
2. The browser's `useRealtimeVoiceSession` hook builds an `RTCPeerConnection`
   (mic + `oai-events` data channel) and sends its SDP offer to the gateway proxy
   `POST /v1/voice/realtime/sdp`, which forwards it with the ephemeral secret
   (GA `/v1/realtime/calls`, beta `/v1/realtime?model=` fallback) and records a
   sanitized connection event — never SDP contents or secrets. (OpenAI also supports
   direct browser SDP with the ephemeral token; the proxy is kept as the single
   audited path.)
3. The realtime session is configured with `create_response: false` — the model
   cannot answer on its own. Every final transcript goes through the deterministic
   mediation endpoint `POST /v1/voice/message`; only kernel-produced reply text is
   spoken back. Barge-in = `response.cancel` + `output_audio_buffer.clear`.
4. Session end → `POST /v1/voice/session/:id/end` stores duration, connection mode
   (`realtime` / `browser_speech` / `text`), interaction mode (push-to-talk default),
   transcript summary, errors, fallback reason and tool-call count.

## Collections
`voice_learning_events`, `voice_memories` (+ shared agent_runs/events). No secrets stored.

## Env
See `.env.example` (port 4121, subdomain voice.simorx.com). VOICE_* are optional —
without them the dock runs text + browser voice and shows "voice provider not configured".

## Deployment
Independent Dokploy app; see `deployment/dokploy/voice-operator-agent.md`.
