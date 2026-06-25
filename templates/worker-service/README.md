# Template: worker-service

Scaffold for a new `worker-service`. Copy this folder into `services/<new-id>`, then:
1. Set identity in `src/factory/manifest.ts` (id, type, capabilities, deps, env).
2. Reserve a port + subdomain in `shared/src/constants`.
3. Implement routes on top of `@factory/service-kit` (`createFactoryService`).
4. Add `.env.example`, README, and a `deployment/dokploy/<id>.md`.
5. Update `docs/service-map.md`.

See `templates/agent-service` for a complete, working reference.
