# AOS Documentation Index

Start here when understanding or extending AOS.

## Current System Truth

- `vision.md` — long-term role-aware AI Government platform vision.
- `mission.md` — current and next operating mission.
- `architecture.md` — 19-service architecture and future personal layer.
- `service-map.md` — canonical human-readable service list.
- `agent-map.md` — agent responsibilities and future agent direction.
- `data-model.md` — MongoDB collections and future personal data model.

## Operating Rules

- `development-rules.md` — how code and docs must evolve.
- `agent-operating-protocol.md` — how agents plan, act, verify, and report.
- `security-and-permissions.md` — approval, RBAC, safe mode, sensitive actions.
- `service-communication-protocol.md` — HTTP, tokens, startup, failure posture.
- `api-contracts.md` — factory and gateway API contract summary.
- `event-contracts.md` — event envelope, naming, transport, scale direction.

## Deployment and Recovery

- `deployment-plan.md` — deployment order and health gates.
- `dokploy-setup.md` — per-service Dokploy setup and rollback.
- `environment-variables.md` — env groups and future env direction.
- `backup-and-recovery.md` — backups, secret rotation, safe mode, drills.

## Strategy and History

- `roadmap.md` — completed phases and next phases AA-AE.
- `phase-log.md` — historical implementation log.
- `decision-log.md` — historical architecture decisions.
- `memory-strategy.md` — memory and learning rules.
- `personal-operating-layer.md` — next user/tenant-scoped operating layer.
- `multi-tenant-governance.md` — data isolation, tenant/user scopes, and role direction.

## Documentation Rule

Docs are operational context for future agents. If code changes service identity,
contracts, env, events, security, deployment, or memory behavior, update the
matching document in the same change.
