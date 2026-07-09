# AOS Documentation Index

Start here when understanding or extending AOS.

## Current System Truth

- `vision.md` — long-term role-aware AI Government platform vision.
- `mission.md` — current and next operating mission.
- `architecture.md` — 19-service architecture; personal layer and Command Universe home now implemented (Phase AB/AC+/AF).
- `service-map.md` — canonical human-readable service list.
- `agent-map.md` — agent responsibilities and future agent direction.
- `data-model.md` — MongoDB collections (Phase 1–10 at full detail, Phase 11+ at collection-name level) and remaining future data-model direction.
- `living-command-universe-vision.md` — product diagnosis and plan for the `/` Jarvis Command Universe home; largely implemented (Phase AF.1–AF.4.4).

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

- `roadmap.md` — completed phases (1 through AF.4.4) and carried-forward directions not yet phase-lettered.
- `phase-log.md` — historical implementation log, current through Phase AF.4.4.
- `decision-log.md` — historical architecture decisions, current through D-128.
- `memory-strategy.md` — memory and learning rules.
- `personal-operating-layer.md` — user/tenant-scoped operating layer; Phase AB baseline implemented, multi-user/connectors still next.
- `multi-tenant-governance.md` — data isolation, tenant/user scopes, and role direction.

## Documentation Rule

Docs are operational context for future agents. If code changes service identity,
contracts, env, events, security, deployment, or memory behavior, update the
matching document in the same change.
