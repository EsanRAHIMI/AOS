# Development Rules

These rules keep AOS fast, safe, and easy for future agents to extend.

## Baseline

- TypeScript everywhere, strict mode, Zod at boundaries.
- One service per folder, port, domain, env file, manifest, README, Dokploy doc.
- Runtime communication over HTTP only; no importing another service's runtime code.
- `@factory/shared` owns constants, schemas, contracts, governance, policy, and helpers.
- `@factory/service-kit` owns the standard factory surface.
- Every important behavior emits events, evidence, audit logs, memory, or documentation.
- User/tenant data must be scoped explicitly; global kernel state must be marked global.

## Local Development

- No local Docker requirement. Services run from the pnpm workspace.
- Use `pnpm -r run typecheck` before considering the repo healthy.
- Use focused smoke scripts when changing runtime, voice, workspace, Dokploy, or security flows.
- Keep `.env.example` and `deployment/env/*.env.example` updated with new env needs.

## Code Evolution

Use `code-operator-agent` and isolated workspaces for self-development:

1. Inspect current code and docs.
2. Create/copy/generate in `.workspaces/`.
3. Apply bounded edits.
4. Typecheck/build/boot/probe.
5. Run fix loop.
6. Produce evidence and migration plan.
7. Promote only after approval.

Protected core (`gateway-api`, `dashboard-web`, `shared/src`) requires owner
approval and should prefer PR/open-review flow.

## Documentation Rule

Any service, contract, env, event, security, or deployment change must update
the matching docs in the same work item. Stale docs are treated as operational
debt because agents use them as context.

## Multi-User Rule

Software development is global and coordinated. User data is not. New features
must separate:

- global kernel state: services, schemas, capabilities, prompts, deployment, docs
- tenant state: organization, department, team policy, and records
- user state: profile, memory, connectors, briefings, approvals
- case state: citizen/public-service workflows with strict access boundaries

## Future-Ready Engineering Direction

- Prefer stable, widely adopted technologies over novelty.
- Add OpenTelemetry before the system becomes hard to debug.
- Add Redis/NATS only when multi-instance runtime needs it; keep contracts stable.
- Add generated OpenAPI/AsyncAPI from schemas rather than manually drifting specs.
- Add connector write-actions only after read-only ingestion, tests, policy, and approval UX.
