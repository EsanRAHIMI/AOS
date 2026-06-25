# Gateway API (`gateway-api`)

## Purpose
Main entry point: auth, API routing, dashboard backend, task creation/status, approvals, infrastructure requests, service registry access, event stream.

## Public endpoints
- `GET /health` — liveness (unauthenticated)

## Internal endpoints (require `x-factory-internal-token`)
- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`
- Service-specific routes documented below.

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Deployment
Independently deployable on Dokploy. Root directory: `services/gateway-api` · Port `4101` · Domain `api.simorx.com`.

## Current status
Phase 1 — functional core.
