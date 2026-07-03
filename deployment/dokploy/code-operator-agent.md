# Dokploy — code-operator-agent

Independent Dokploy application (no Docker locally; Dokploy builds from GitHub).

| Setting | Value |
|---|---|
| App name | code-operator-agent |
| Domain | https://code.simorx.com |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/code-operator-agent |
| Build command | pnpm install --frozen-lockfile && pnpm --filter @factory/code-operator-agent... build |
| Start command | node services/code-operator-agent/dist/index.js |
| Health check | /health |
| Internal port | 4122 |

## Required env
```
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=<shared internal token>
MONGODB_URI=<atlas uri>
MONGODB_DB_NAME=autonomous_os_kernel
SERVICE_ID=code-operator-agent
SERVICE_NAME=Code Operator Agent
SERVICE_PORT=4122
SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com
# Code workspace (REQUIRED for code tools — without it they report
# not_configured cleanly). Use a DEDICATED git checkout, e.g. a volume:
CODE_WORKSPACE_ROOT=/workspace/autonomous-os-kernel
# Git/GitHub (optional — enables commit/push/PR):
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=autonomous-os-kernel
GITHUB_DEFAULT_BRANCH=main
LOG_LEVEL=info
```

## Volume
Mount a persistent volume at `/workspace` and clone the repo into it once
(`git clone https://github.com/<owner>/autonomous-os-kernel /workspace/autonomous-os-kernel`).
The agent works ONLY inside this checkout, on isolated branches — never in the
running application directory.

## Safety notes
- Protected-core paths (services/gateway-api/, services/dashboard-web/, shared/src/)
  are refused on edit unless the gateway passes an explicit owner approval flag.
- Edits on the default branch are refused; a work branch is mandatory.
- All mutating tools are approval-gated upstream in the gateway runtime loop.
