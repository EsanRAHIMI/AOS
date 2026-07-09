# Architecture

AOS is a TypeScript monorepo of **19 independently deployable HTTP services**.
It is designed as a governed multi-agent factory today, and as a multi-user,
role-aware operating layer next. Esan is the primary owner and first operator;
future users and roles must share the same software kernel while keeping their
data isolated.

## Current Shape

```text
Authorized user / Operator / Role
  -> dashboard-web
       `/` Living Command Universe home (Presence Bar, 9 domain-specific zones,
           domain actions, persistent Live Activity feed — Phase AC+/AF.1-4.4)
       `/me/*` Personal Command Center (Phase AB)
       persistent Operator Console dock (Jarvis, voice/text, inline approvals)
       `/operations` Mission Control + ~55 engine-room pages (self-dev kernel)
  -> gateway-api (auth, RBAC, task intake, operator runtime, approval gate,
       persistent live-state snapshot, Jarvis briefing/memory endpoints)
  -> orchestrator-agent (planning, delegation, intelligence pipeline)
  -> specialist agents (architect, builder, reviewer, QA, devops, monitor, memory, report)
  -> infra services (registry, events, docs, assets, research, browser testing, code operator)

State: MongoDB Atlas
Files/artifacts: AWS S3
Realtime: event-bus-service via SSE + dashboard-side block-invalidation model (UniverseProvider)
Deploy: Dokploy, one app per service
Code evolution: isolated workspaces through code-operator-agent
```

The Command Universe home and Personal Command Center are not new services —
they are pages/routes inside the existing `dashboard-web` service, backed by
existing `gateway-api` routes and `shared/src/{personal,jarvis,operator}`
modules. See `docs/phase-log.md` (Phase AB, AC+, AD–AF.4.4) for what each
phase actually added, and `docs/living-command-universe-vision.md` for the
product reasoning behind the home surface.

## Core Principles

1. **One service = one deployable app.** Each service has a stable id, port,
   domain, env, manifest, and lifecycle.
2. **HTTP at runtime.** `@factory/shared` and `@factory/service-kit` are build
   dependencies. Services call peers over HTTP with internal tokens.
3. **Schema-first contracts.** Zod schemas define data boundaries; raw model
   text never mutates state.
4. **No fake success.** Missing providers, unsupported APIs, failed probes, and
   manual steps are represented honestly.
5. **Human in control.** Protected core, deploy, mutation, external action, and
   irreversible operations are approval-gated.
6. **Evidence and memory.** Every important action should create events,
   evidence, audit records, memory, or documentation updates.

## Standard Service Surface

Every backend service exposes the factory surface from `@factory/service-kit`:

- `GET /health`
- `GET /.factory/manifest`
- `GET /.factory/status`
- `GET /.factory/capabilities`
- `POST /.factory/task`
- `GET /.factory/logs`

Public metadata endpoints allow registry/workspace probes. Task and logs routes
are token-guarded.

## Runtime Flow

1. An authorized user enters a goal from dashboard, Operator Console, voice, or API.
2. Gateway authenticates, applies tenant/RBAC/safe-mode/policy, persists task state.
3. Orchestrator creates a plan and delegates to specialist agents.
4. Agents run bounded work, emit events, store evidence, and request approvals.
5. Reviewer/QA/monitor/report close the loop with checks and readable output.
6. Memory and documentation compress the outcome for future runs.

## Workspace Evolution

Code changes must flow through isolated workspaces:

1. Create disposable workspace under `.workspaces/`.
2. Copy or generate service code.
3. Apply bounded multi-file edits.
4. Run typecheck/build and boot on a temporary port.
5. Probe health, manifest, status, capabilities, token guards, and logs.
6. Iterate through the fix loop until green or fail honestly.
7. Produce migration/PR plan; promote only after approval.

## Future Architecture: User Operating Layer

The next architecture layer should add:

- **Identity and tenant service:** users, tenants, roles, consent, delegation, session revocation.
- **Context service:** user/tenant profiles, values, goals, constraints, preferences.
- **Connectors:** calendar, email, drive/files, tasks, GitHub, finance, and approved public-service sources; read-only first.
- **Research fabric:** real search/fetch, source scoring, recency checks, citation storage.
- **Planning loops:** user-specific daily briefing, weekly review, monthly strategy, opportunity pipeline.
- **Action mediation:** every external action has policy, preview, approval, evidence, and rollback where possible.
- **Public-service layer:** case records, department roles, citizen-facing workflows, strict audit boundaries.

Recommended production hardening path:

- OIDC/OAuth2 login + per-user RBAC store.
- Tenant-aware authorization and row-level access checks in every user-data route.
- Redis for distributed rate limits, session invalidation, and safe-mode propagation.
- Redis Streams or NATS for multi-instance event fan-out when SSE outgrows one process.
- OpenTelemetry traces/metrics/log correlation across gateway, agents, event bus, and database calls.
- OpenAPI/AsyncAPI generation from shared schemas for contract verification.
