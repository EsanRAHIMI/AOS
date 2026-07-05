# API Contracts

Typed contracts live in `shared/src/contracts/index.ts` and Zod schemas live in
`shared/src/schemas/*`. This document describes the stable surfaces, not every
route implementation detail.

## Factory Service Surface

Every backend service exposes:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | liveness probe |
| GET | `/.factory/manifest` | public metadata | service identity, capabilities, env, deps |
| GET | `/.factory/status` | public metadata | uptime and dependency status |
| GET | `/.factory/capabilities` | public metadata | capability list |
| POST | `/.factory/task` | internal token | accept a unit of work |
| GET | `/.factory/logs` | internal token | recent logs for probes/operator |

The response envelope remains `{ ok: true, data }` or
`{ ok: false, error: { code, message, details? } }`.

## Gateway Surface

Gateway routes are grouped by capability:

- Tasks and timelines: `/v1/tasks`, `/v1/tasks/:id`, `/v1/tasks/:id/timeline`.
- Services and registry: `/v1/services`, `/v1/system/status`, `/v1/system/integrations`.
- Approvals and governance: `/v1/approvals`, policy, scoring, RBAC, audit routes.
- Operations and Dokploy: operation plans, targets, diagnostics, sync, retry, rollback.
- Intelligence: LLM status/costs/prompts/traces, research, reviews, QA, reports.
- Learning: schedules, triggers, reliability, patterns, recommendations, impact.
- Voice/operator: realtime token/SDP, voice sessions, operator command/tools/sessions.
- Workspace evolution: workspaces, runs, verification, migration, rollback.

## Contract Rules

- All mutation routes require dashboard/admin auth, role propagation, and policy checks.
- Service-to-service calls use `x-factory-internal-token`.
- Dashboard server code keeps privileged tokens server-side.
- Schema validation happens at boundaries: request bodies, stored records, LLM outputs.
- Unsupported real-world actions return `manual_required`, never fake success.
- Missing external providers return `not_configured` or explicit `fallback`.
- Future user-data routes must enforce `tenantId`, `userId`, role, consent, and policy.
- Global kernel routes must be explicitly marked global and must not silently read user data.
- Public-service/citizen routes require stricter audit fields and case/department scope.

## Future Contract Work

- Generate OpenAPI from the shared schemas for gateway and factory routes.
- Generate AsyncAPI or event catalog documentation from `EVENT_TYPES`.
- Add contract tests so every service proves the factory surface before deployment.
- Version personal-data connector contracts before enabling write actions.
- Add tenant/user/case scope fields to connector, briefing, memory, and public-service APIs.
