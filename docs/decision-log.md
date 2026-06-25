# Decision Log

Records significant engineering decisions and why. Newest first.

## 2026-06-26 — Phase 2 first autonomous loop

### D-012 Test-only DB seam (`setTestDb`)
Added `setTestDb()` to `shared/db` so the real compiled pipeline/handlers can run
in-process against a fake Db for verification (the sandbox blocks downloading a
mongod binary). Clearly marked test-only; never used in production paths.

### D-011 Approval is the human-in-the-loop gate that drives the task
The orchestrator finishes the pipeline at `awaiting_approval` after devops creates the
infrastructure request. The gateway's approval decision endpoint then drives the linked
task: approve → `completed` + `task.completed`; reject → `cancelled` + `task.failed`.
Keeps the loop truthful (sensitive action gated) without a complex pause/resume engine.

### D-010 Orchestrator responds immediately; pipeline runs in background
`POST /.factory/task` returns `accepted` at once and runs the delegation pipeline
asynchronously with paced steps, so the dashboard shows a live, progressive timeline.

### D-009 Cross-service calls via env-configured peer URLs (`peerUrl`/`PeerClient`)
Resolution: `<SERVICE>_URL` env override → localhost default from `SERVICE_PORTS`.
Production sets these to subdomains. No shared runtime code, no registry hard-dependency
for the happy path — fully compatible with independent Dokploy deployment.

## 2026-06-25 — Phase 1 foundation

### D-008 Verified-current dependency versions
Pinned to June 2026 stable: Node 24 LTS (engines `>=22 <25` for sandbox compat),
Next.js 16.2, React 19, Fastify 5.8, Zod 4.4, MongoDB driver 6.x, AWS SDK v3,
TypeScript 5.9, pino 9. Verified via official sources before pinning.

### D-007 SSE via event-bus + dashboard server proxy
Event bus persists events to MongoDB and fans out over SSE. The dashboard
subscribes through a server-side Next.js route (`/api/stream`) that holds the
internal token, so browser secrets are never exposed. Redis/NATS backplane
deferred until multi-instance scale requires it.

### D-006 Internal vs admin tokens (RBAC later)
Two tokens now: internal (service-to-service) and admin (human/dashboard),
compared in constant time. Designed to evolve into full RBAC without breaking
the contract.

### D-005 MongoDB Atlas primary; AWS S3 objects
Per brief. No PostgreSQL. One `MongoClient` per process; `FileStorage` wraps S3
with presigned URLs; object metadata tracked in `s3_objects`.

### D-004 `@factory/service-kit` separate from `@factory/shared`
`shared` stays framework-agnostic (contracts/schemas/db/storage/utils). The
Fastify bootstrap lives in a second workspace package so the Next.js dashboard
and any non-Fastify consumer don't pull Fastify transitively. `createFactoryService`
gives every backend service identical standard endpoints, auth, registration,
and lifecycle.

### D-003 pnpm workspaces monorepo, independently deployable services
Chosen by owner. Shared code linked at build time; each service builds and
deploys independently on Dokploy (own root dir, env, port, subdomain). Runtime
communication is HTTP + internal tokens only.

### D-002 Standard factory endpoint surface
Every service exposes `/health` + `/.factory/{manifest,status,capabilities,task,logs}`
so the registry, dashboard, and agents can treat services uniformly.

### D-001 Production domain `simorx.com`
Subdomains derived in `shared/src/constants` (api., factory., orchestrator., …).
Swappable via `ROOT_DOMAIN` + env.
