# Dokploy Setup

## Prerequisites
- Dokploy installed on the host; DNS for `simorx.com` pointing at it.
- MongoDB Atlas cluster reachable; AWS S3 bucket + IAM user created.
- Repo pushed to GitHub; `GITHUB_TOKEN`/owner configured if private.

## Creating a service (generic)
1. New Application → from GitHub repo (the monorepo).
2. Build context = repo root; **Root Directory** = `services/<id>`.
3. Build command:
   `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/<id>... run build`
4. Start command: `pnpm --filter @factory/<id> run start`
5. Set the **Domain** to the service subdomain and **Port** to its port.
6. Add environment variables from `deployment/env/<id>.env.example`.
7. Health check path `/health`.
8. Deploy. Confirm `https://<subdomain>/health` returns `{ "status": "ok" }`.

## Why build from repo root
pnpm workspace links `@factory/shared` and `@factory/service-kit` at build time.
The `--filter @factory/<id>...` (with trailing `...`) builds the service and its
workspace dependencies. The running container only needs the built service.

## After creation
The system validates: domain reachable, `/health` ok, internal token accepted,
manifest available, and registration in the service-registry succeeded.
