# Deployment Plan

AOS deploys as one Dokploy application per service. The monorepo remains the
source; each app builds its own workspace package plus shared dependencies.

## Deployment Order

1. Managed dependencies: MongoDB Atlas, AWS S3/CloudFront, DNS, GitHub repo.
2. `service-registry`
3. `event-bus-service`
4. `gateway-api`
5. Core agents: `orchestrator-agent`, `architect-agent`, `builder-agent`, `devops-agent`
6. Knowledge/ops: `memory-agent`, `documentation-service`, `monitor-agent`, `report-agent`
7. Quality/research: `reviewer-agent`, `qa-agent`, `internet-research-service`, `browser-testing-agent`
8. Assets and operator services: `file-asset-service`, `voice-operator-agent`, `code-operator-agent`
9. `dashboard-web`

## Per-App Pattern

- Repository: monorepo.
- Root directory: `services/<id>`.
- Build from repo root so pnpm workspace dependencies resolve.
- Build command:
  `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/<id>... run build`
- Start command:
  `pnpm --filter @factory/<id> run start`
- Health path: `/health`.
- Domain and port: from `shared/src/constants/index.ts`.
- Env: service `.env.example` plus `deployment/env/*.env.example`.

## Required Gates

Before marking a deploy healthy:

- `/health` is ok.
- `/.factory/manifest`, `/status`, `/capabilities` respond.
- Token-guarded routes reject missing/invalid tokens.
- Service appears in registry.
- Gateway/dashboard can read it.
- Events are flowing.
- No new security or monitor incident is open.

## Production Hardening Path

- OIDC/OAuth2 login and per-user RBAC.
- Tenant-aware data isolation checks before enabling multiple users.
- Redis for distributed rate limiting and safe-mode propagation.
- Redis Streams or NATS behind event bus if multiple instances are needed.
- OpenTelemetry traces and metrics.
- Backup drills, secret rotation drills, rollback rehearsal.
