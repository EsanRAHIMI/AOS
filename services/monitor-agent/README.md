# Monitor Agent (`monitor-agent`)

## Purpose
Runtime autonomy: keeps the system honest about what is actually alive.

## Responsibilities
- Periodic health scan of all registered services (latency + status) → `monitor_runs`.
- **Live service activation** (`activate_service`): runs the activation engine against a
  validated service; on pass promotes the capability to `active`, on fail opens an incident
  and proposes a repair task. Every check produces evidence.
- Incident detection → `incidents`; repair proposals → `repair_tasks`.

## Internal endpoints
- `POST /.factory/task` with `input.action`:
  - `monitor_scan` — run one health scan now.
  - `activate_service` — `{ serviceName, capability, baseUrl?, registered? }`.
- Plus the standard factory surface via `@factory/service-kit`.

## Deployment
Independently deployable on Dokploy. Root `services/monitor-agent` · Port `4113` ·
Domain `monitor.simorx.com`.
