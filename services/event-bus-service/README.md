# Event Bus Service (`event-bus-service`)

## Purpose
Internal real-time event backbone: ingests events, persists to MongoDB, fans out to subscribers via SSE for live dashboard updates.

## Public endpoints
- `GET /health` — liveness (unauthenticated)

## Internal endpoints (require `x-factory-internal-token`)
- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`
- Service-specific routes documented below.

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Deployment
Independently deployable on Dokploy. Root directory: `services/event-bus-service` · Port `4111` · Domain `events.simorx.com`.

## Current status
Phase 1 — functional core.
