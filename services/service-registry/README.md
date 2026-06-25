# Service Registry (`service-registry`)

## Purpose
Authoritative registry of all services: manifests, domains, health endpoints, capabilities, dependencies, deployment status.

## Public endpoints
- `GET /health` — liveness (unauthenticated)

## Internal endpoints (require `x-factory-internal-token`)
- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`
- Service-specific routes documented below.

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Deployment
Independently deployable on Dokploy. Root directory: `services/service-registry` · Port `4108` · Domain `registry.simorx.com`.

## Current status
Phase 1 — functional core.
