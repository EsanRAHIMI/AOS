# Dokploy — voice-operator-agent

Independent Dokploy application (no Docker locally; Dokploy builds from GitHub).

| Setting | Value |
|---|---|
| App name | voice-operator-agent |
| Domain | https://voice.simorx.com |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/voice-operator-agent |
| Build command | pnpm install --frozen-lockfile && pnpm --filter @factory/voice-operator-agent... build |
| Start command | node services/voice-operator-agent/dist/index.js |
| Health check | /health |
| Internal port | 4121 |

## Required env
```
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=<shared internal token>
MONGODB_URI=<atlas uri>
MONGODB_DB_NAME=autonomous_os_kernel
SERVICE_ID=voice-operator-agent
SERVICE_NAME=Voice Operator Agent
SERVICE_PORT=4121
SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com
# Optional realtime voice (else text + browser voice):
VOICE_PROVIDER=openai
VOICE_MODEL=gpt-4o-realtime-preview
OPENAI_API_KEY=
VOICE_REQUIRE_PUSH_TO_TALK=true
```

## Validate after deploy
`GET /health` ok → registered → `/.factory/manifest` requires the internal token (must NOT be public).
The realtime token endpoint never returns the API key — only a short-lived ephemeral client secret.
