# API Contracts

Typed contracts live in `shared/src/contracts/index.ts`. Two surfaces:

## 1. Factory service surface (every backend service)
- `GET /health` → `{ status: "ok", serviceId }`
- `GET /.factory/manifest` → `ServiceManifest`
- `GET /.factory/status` → `ServiceStatus`
- `GET /.factory/capabilities` → `{ capabilities: string[] }`
- `POST /.factory/task` (body `TaskRequest`) → `{ taskId, accepted }`
- `GET /.factory/logs` → `{ lines: string[] }`

All `/.factory/*` routes require header `x-factory-internal-token`.

## 2. Gateway surface (api.simorx.com, `/v1`)
Auth: `x-factory-admin-token` (human/dashboard) **or** internal token (services).
- `POST /v1/tasks` (body `TaskRequest`) → `Task`
- `GET /v1/tasks` → `Task[]`
- `GET /v1/tasks/:id` → `Task`
- `GET /v1/tasks/:id/timeline` → `SystemEvent[]`
- `GET /v1/services` → `ServiceManifest[]` (proxied from registry)
- `GET /v1/approvals` → `Approval[]`
- `POST /v1/approvals/:id/decision` (body `{ action, reason? }`) → `Approval`
- `GET /v1/infrastructure` → `InfrastructureRequest[]`
- `POST /v1/infrastructure/:id/confirm` → `InfrastructureRequest`
- `GET /v1/events?limit=` → `SystemEvent[]`
- `GET /v1/system/status` → `{ taskCount, pendingApprovals, env }`

## Response envelope
Success: `{ ok: true, data, meta? }`  ·  Error: `{ ok: false, error: { code, message, details? } }`
