# Development Rules

## Local development
- **No local Docker.** Services run side-by-side from the monorepo. Containers
  are created later via Dokploy on the host.
- Clean codebase, independent service folders, clear contracts, strong docs,
  `.env.example` per service, GitHub-ready, Dokploy-ready.

## Code
- TypeScript everywhere. Zod for validation. Explicit error handling.
- Structured logs (pino) with `serviceId`. Validate env at startup (fail fast).
- Consistent API envelope. Concise comments for non-obvious logic only.
- Every service has `src/{config,routes,services,models,schemas,utils,factory}`
  and exposes `/health`, `/.factory/manifest`, `/.factory/status`.

## Naming
Clear, boring, scalable. Good: `orchestrator-agent`, `service-registry`.
Bad: `core`, `app`, `bot`, `ai1`, `demo`.

## Shared vs runtime
`@factory/shared` is build-time only. Never call another service by importing
its code — call it over HTTP with an internal token.

## Adding a new service
1. Copy `templates/agent-service` (or another template).
2. Set manifest (id, capabilities, deps, env), port, subdomain in constants.
3. Implement routes; keep the standard surface from `@factory/service-kit`.
4. Add `.env.example`, README, Dokploy doc, and update docs/service-map.md.
5. Have the devops-agent emit an infrastructure request for Dokploy.
