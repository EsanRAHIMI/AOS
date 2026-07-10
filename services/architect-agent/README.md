# Architect Agent (`architect-agent`)

> **Consolidation candidate (D-168):** `services/aos-agent-runtime` hosts a
> behaviorally-equivalent, characterization-tested copy of this service's
> logic on the same port/domain/serviceId. This service is **not
> deprecated** — it is the live production deployable today and remains so
> until a human deliberately repoints Dokploy at `aos-agent-runtime`. Once
> that cutover happens and is verified, this folder becomes superseded (not
> before). See `docs/deployment-plan.md` → "aos-agent-runtime cutover
> (transitional)".

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
