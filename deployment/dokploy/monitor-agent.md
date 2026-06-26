# Dokploy: monitor-agent

| Setting | Value |
|---|---|
| App name | monitor-agent |
| Domain | monitor.simorx.com |
| Port | 4113 |
| Root directory | services/monitor-agent |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/monitor-agent... run build` |
| Start command | `pnpm --filter @factory/monitor-agent run start` |
| Health check | /health |

## Env
MONGODB_URI, MONGODB_DB_NAME, FACTORY_INTERNAL_TOKEN, SERVICE_* identity,
SERVICE_REGISTRY_URL, EVENT_BUS_URL, MONITOR_INTERVAL_MS (default 60000; 0 disables
the background scan), LOG_LEVEL.

## Notes
Runs live activation checks (`activate_service`) and periodic health scans. Creates
incidents + repair tasks on failure. Promotes capabilities to `active` only after the
live service passes activation.
