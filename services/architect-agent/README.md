# Architect Agent (`architect-agent`)

## Purpose
System and service architecture: designs services, defines boundaries, API contracts, database collections, event flows, env vars, and deployment requirements.

## Responsibilities
See `docs/agent-map.md` for the full responsibility list.

## Public endpoints
- `GET /health` — liveness (unauthenticated)

## Internal endpoints (require `x-factory-internal-token`)
- `GET /.factory/manifest`
- `GET /.factory/status`
- `GET /.factory/capabilities`
- `POST /.factory/task`
- `GET /.factory/logs`

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Dependencies
Declared in `src/factory/manifest.ts`.

## Deployment
Independently deployable on Dokploy. See `deployment/dokploy/agent-services.md`.
Root directory: `services/architect-agent` · Port `4103` · Domain `architect.simorx.com`.

## Current status
Phase 1 — running skeleton: standard endpoints, persisted agent runs, event
emission. Domain reasoning logic to be expanded in later phases.

## Future improvements
LLM router integration, tool execution, retries/backoff, richer task planning.
