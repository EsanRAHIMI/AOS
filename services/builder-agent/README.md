# Builder Agent (`builder-agent`)

## Purpose
Implementation: generates and modifies code, scaffolds service folders, API endpoints, frontend components, workers and tests following existing architecture.

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
Root directory: `services/builder-agent` · Port `4104` · Domain `builder.simorx.com`.

## Current status
Phase 1 — running skeleton: standard endpoints, persisted agent runs, event
emission. Domain reasoning logic to be expanded in later phases.

## Future improvements
LLM router integration, tool execution, retries/backoff, richer task planning.
