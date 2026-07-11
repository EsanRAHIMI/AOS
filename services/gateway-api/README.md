# Gateway API (`gateway-api`)

## Purpose
The system's single public front door: authentication/RBAC, task intake and
timelines, approvals, the operator/Jarvis runtime (command loop, live-state,
approval decisions), voice session mediation, Dokploy operations, and every
governance/learning/reality-execution route the dashboard and agents depend
on. This README summarizes the surface; the authoritative route list is
`src/routes/*.ts` and `docs/api-contracts.md`.

## Structure (K1.3 split)
- `src/index.ts` — production bootstrap only (loadEnv → build → listen).
- `src/server.ts` — `buildGatewayService(env, {connectDb})`: hooks, collection
  handles, guards/security helpers, the cross-group runtime (operations
  executor, voice kernel-task helper, personal graph loaders, operator/Jarvis
  subsystem), and the flat `GatewayDeps` object handed to every route module.
  Exported for tests — the characterization suite builds the real gateway
  in-process with an injected fake Db (`test/helpers/`).
- `src/routes/{tasks,capabilities,governance,security,operations,intelligence,
  voice,personal,operator,system}.ts` — route registrations, bodies moved
  verbatim from the pre-split monolith; each destructures what it uses from
  `GatewayDeps` (`src/routes/deps.ts`).
- `test/characterization.*.test.ts` — 254 tests pinning auth, envelopes,
  RBAC/safe-mode/rate-limit behavior, and the task/approval/infra flows.
  They must stay green through any refactor of this service.

## Public endpoints
- `GET /health` — liveness (unauthenticated)

## Internal endpoints (require `x-factory-internal-token`)
- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`

## Route groups (`/v1/*`, dashboard/admin auth + RBAC)
- **Tasks & approvals** — `/v1/tasks`, `/v1/tasks/:id`, `/v1/tasks/:id/timeline`, `/v1/approvals`
- **Agent job / DLQ operations (K1 BullMQ Producer Adoption, D-174)** — `GET /v1/agent-jobs/dead-letters?serviceId=`, `GET /v1/agent-jobs/:jobRunId`, `POST /v1/agent-jobs/:jobRunId/{replay,cancel}` (owner/operator only — `manage_agent_jobs`, safe-mode-blocked, audited)
- **Operator / Jarvis runtime (Phase X, AD–AF.4.4)** — `POST /v1/operator/command`, `GET /v1/operator/live-state` (persistent snapshot: active/recent sessions, pending approvals, recent tasks/events — see `docs/decision-log.md` D-120–D-128), `GET /v1/operator/sessions/active`, `POST /v1/operator/permissions/:id/decision`, `/v1/operator/{tools,capabilities,sessions,memories}`
- **Personal reality / Jarvis intelligence (Phase AB, AD–AE.1)** — `/v1/me/reality/*` (ingest, review, next-actions decision), `/v1/me/universe` (the 9-zone Command Universe contract), `/v1/jarvis/briefing`
- **Voice** — `/v1/voice/{realtime-token, realtime/sdp, session, message, tool-confirm, permission, sessions, memories, tool-calls}`
- **Services & registry** — `/v1/services`, `/v1/system/status`, `/v1/system/integrations`
- **Governance** — policy, scoring, RBAC, audit-log routes
- **Operations & Dokploy** — operation plans/targets/diagnostics/sync/retry/rollback
- **Intelligence** — LLM status/costs/prompts/traces, research, reviews, QA, reports
- **Learning** — schedules, triggers, reliability, patterns, recommendations, impact
- **Workspace evolution (Phase Y/Z)** — workspaces, runs, verification matrix, migration, rollback

Full route inventory: `docs/api-contracts.md`. Contract rules (auth, `not_configured`
vs fake success, tenant/scope enforcement) are also documented there.

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Deployment
Independently deployable on Dokploy. Root directory: `services/gateway-api` · Port `4101` · Domain `api.simorx.com`.

## Current status
Functional core through Phase AF.4.4 (2026-07-09) — see `docs/phase-log.md` for
the full phase-by-phase history. `tsc --noEmit` verified clean after every
recent phase; this sandbox cannot run a live Dokploy deploy to verify
end-to-end.
