# Orchestrator Agent (`orchestrator-agent`)

## Purpose
Central brain: receives goals, decomposes into phases/tasks, assigns specialist agents, tracks progress, requests approval, generates reports and evolution proposals.

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
Root directory: `services/orchestrator-agent` · Port `4102` · Domain `orchestrator.simorx.com`.

## Current status
Phase 1 — running skeleton: standard endpoints, persisted agent runs, event
emission. Domain reasoning logic to be expanded in later phases.

## Future improvements
LLM router integration, tool execution, retries/backoff, richer task planning.
