# Architecture

## Shape
A monorepo of independently deployable services. Each service is a separate
Dokploy app with its own subdomain, port, environment, and lifecycle. Shared
**contracts** (`@factory/shared`) are a build-time dependency only; at runtime
services communicate exclusively over **HTTP with internal tokens**.

```
                 ┌────────────────────────────────────────────┐
   Human ─────►  │  dashboard-web (factory.simorx.com)         │
                 └───────────────┬────────────────────────────┘
                                 │ admin token (server-side)
                                 ▼
                 ┌────────────────────────────────────────────┐
                 │  gateway-api (api.simorx.com)               │  front door
                 └───┬───────────────┬───────────────┬────────┘
       internal token│               │               │
            ┌────────▼───┐   ┌────────▼────────┐  ┌───▼─────────────┐
            │ orchestrator│──►│ specialist agents│  │ service-registry │
            │   -agent    │   │ architect/builder│  │ (registry.*)     │
            └─────┬───────┘   │ devops/memory…   │  └──────────────────┘
                  │           └───────┬──────────┘
                  │ emits events      │ emits events
                  ▼                   ▼
            ┌──────────────────────────────────┐    ┌───────────────────┐
            │ event-bus-service (events.*)      │    │ file-asset-service │
            │ persist + SSE fan-out             │    │ (assets.*) ──► S3  │
            └──────────────┬───────────────────┘    └───────────────────┘
                           │ SSE (proxied by dashboard /api/stream)
                           ▼
                     live dashboard updates

   Persistent state: MongoDB Atlas (all services)   |  Objects: AWS S3
```

## Standard service surface
Every backend service exposes:
- `GET /health` — public liveness
- `GET /.factory/manifest` — identity + capabilities + deps + required env
- `GET /.factory/status` — uptime + dependency reachability
- `GET /.factory/capabilities`
- `POST /.factory/task` — accept a unit of work
- `GET /.factory/logs` — recent log lines

These are provided uniformly by `@factory/service-kit`.

## Data flow (goal → execution)
1. Human/dashboard `POST /v1/tasks` → gateway persists a `tasks` doc, emits `task.created`.
2. Gateway forwards the goal to the orchestrator's `POST /.factory/task`.
3. Orchestrator decomposes and dispatches to specialist agents (Phase 2 delegation).
4. Each agent records an `agent_runs` doc and emits run lifecycle events.
5. Event bus persists every event and streams it to the dashboard.
6. Sensitive steps create `approvals`; the human decides; decisions are logged.
7. Memory agent summarizes outcomes; documentation service updates docs.

## Why this shape
See `decision-log.md`. Key: independent deployability + contract-driven HTTP
communication = services scale and ship separately without runtime coupling.
