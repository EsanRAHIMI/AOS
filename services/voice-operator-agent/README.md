# voice-operator-agent

Realtime voice operator brain (Phase 18). Mints short-lived ephemeral realtime
tokens (server-side; the raw API key never reaches the browser), produces
context-grounded explanations (LLM optional, deterministic router fallback), and
extracts memory + learning from finished sessions. It **never mutates kernel
state** — every action is routed through the gateway's voice endpoints under RBAC,
safe mode and approvals.

## Endpoints
Standard factory surface. `POST /.factory/task` input `{ action }`:
`realtime_token` → ephemeral session (or "not configured"), `derive_learning` →
voice_learning_event + voice_memories, default → status + guardrails.

## Collections
`voice_learning_events`, `voice_memories` (+ shared agent_runs/events). No secrets stored.

## Env
See `.env.example` (port 4121, subdomain voice.simorx.com). VOICE_* are optional —
without them the dock runs text + browser voice and shows "voice provider not configured".

## Deployment
Independent Dokploy app; see `deployment/dokploy/voice-operator-agent.md`.
