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

## Task dispatch (K1 BullMQ, D-173/D-174)
`REDIS_URL` unset (the default) — this service dispatches and receives every task over HTTP only,
unchanged from before D-173. Setting `REDIS_URL` additionally starts a BullMQ `Worker` consuming
`agent-tasks:orchestrator-agent` (wired to the same `handleTask` the HTTP route calls), and —
independently, gated by `AGENT_DISPATCH_MODE` (`http` default | `queue_with_http_fallback` |
`queue_only`) — lets `pipeline.ts`'s 12 dispatch calls to the 7 `aos-agent-runtime` consolidated
workers (architect/qa/reviewer/report/memory/documentation-service/internet-research-service) route
through BullMQ instead of HTTP, via `dispatchPeerTask`. The 13 dispatch calls to isolated services
(`builder-agent`/`devops-agent`/`monitor-agent`/`browser-testing-agent`) are unaffected — HTTP only,
by design (see decision-log D-170/D-174). See `docs/decision-log.md` D-174 and
`docs/service-communication-protocol.md`'s "Task Dispatch" section for the full design.

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Dependencies
Declared in `src/factory/manifest.ts`.

## Deployment
Independently deployable on Dokploy. See `deployment/dokploy/agent-services.md`.
Root directory: `services/orchestrator-agent` · Port `4102` · Domain `orchestrator.simorx.com`.

## Current status
Standard endpoints, persisted agent runs, event emission, and the full delegation/build/activation/
repair/strategic/governance/learning/improvement pipelines (`src/pipeline.ts`). K1 BullMQ Producer
Adoption (D-174) added optional queue-mode dispatch (see above) and this service's first test suite
(`test/pipeline.dispatch.test.ts`, 3 tests) — `tsc --noEmit`/`vitest run` verified clean.

## Future improvements
Broader test coverage (pipeline.ts's other 9 sub-pipelines have no test coverage yet), queue-enable
the isolated services once a security-isolation-aware queue design exists for them (D-170), richer
task planning.
