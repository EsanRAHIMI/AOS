# Deployment Plan

## Model
GitHub → Dokploy on the production host. Each service = one Dokploy app with its
own subdomain, port, env, and (optional) volume. The kernel **generates exact
infrastructure requests**; the human creates them in Dokploy, then confirms. The
system does not assume host control.

## Order of deployment
1. **MongoDB Atlas** (managed) — get `MONGODB_URI`. See deployment/dokploy/mongodb-atlas.md.
2. **AWS S3** bucket + IAM keys. See deployment/dokploy/aws-s3.md.
3. **service-registry** (registry.simorx.com) — others register against it.
4. **event-bus-service** (events.simorx.com).
5. **gateway-api** (api.simorx.com).
6. **Agent services** (orchestrator first, then architect/builder/devops/memory).
7. **file-asset-service** (assets.simorx.com).
8. **documentation-service** (docs.simorx.com).
9. **dashboard-web** (factory.simorx.com).

## Per-app Dokploy settings (pattern)
- Repository: the monorepo. Build context: repo root (pnpm workspace).
- Root directory: `services/<id>`.
- Build: `pnpm install --frozen-lockfile && pnpm --filter @factory/<id>... run build`
- Start: `pnpm --filter @factory/<id> run start`
- Health check: `/health`.
- Domain: the service's subdomain. Port: the service's port.
- Env: from deployment/env/<id>.env.example (fill real values).

See deployment/dokploy/domains.md for the full subdomain list.
