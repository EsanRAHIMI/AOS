# Autonomous OS Kernel

The core engine of an autonomous AI operating system — a scalable, modular,
observable, multi-agent, multi-service factory kernel that can think, plan,
execute, monitor, document, and improve, while keeping a human in control.

> This is **not** an MVP or a toy. It is the production-grade foundation of a
> long-term autonomous intelligence infrastructure.

## Architecture at a glance
- **Monorepo** (pnpm workspaces) of independently deployable services.
- Each service is its own Dokploy app with its own subdomain, port, and env.
- Services communicate over **HTTP + internal tokens**, never by sharing runtime code.
- **MongoDB Atlas** is the primary datastore. **AWS S3** is the object store.
- Real-time visibility via an **event bus (SSE)** and a **Next.js dashboard**.
- **Human approval** gates every sensitive/irreversible action.

## Workspace layout
```
autonomous-os-kernel/
├── shared/                  @factory/shared — contracts, schemas, db, storage, utils
├── packages/service-kit/    @factory/service-kit — Fastify factory bootstrap
├── services/                independently deployable services (one Dokploy app each)
│   ├── gateway-api/         api.simorx.com — front door
│   ├── dashboard-web/       factory.simorx.com — control room (Next.js 16)
│   ├── orchestrator-agent/  orchestrator.simorx.com — central brain
│   ├── architect-agent/     architect.simorx.com
│   ├── builder-agent/       builder.simorx.com
│   ├── devops-agent/        devops.simorx.com
│   ├── memory-agent/        memory.simorx.com
│   ├── documentation-service/ docs.simorx.com
│   ├── service-registry/    registry.simorx.com
│   ├── event-bus-service/   events.simorx.com
│   └── file-asset-service/  assets.simorx.com
├── templates/               scaffolds for new services
├── deployment/              Dokploy + env specs
├── docs/                    living documentation (read docs/architecture.md first)
└── scripts/                 operational runbooks
```

## Local development
```bash
corepack enable
pnpm install
pnpm --filter @factory/shared run build      # build shared first
pnpm --filter @factory/service-kit run build
# run a service (after copying .env.example -> .env and filling values)
pnpm --filter @factory/gateway-api run dev
```
No local Docker required. Containers are created later via Dokploy.

## Where to start reading (for humans and future agents)
1. `docs/architecture.md` — the system shape and data flow
2. `docs/service-map.md` + `docs/agent-map.md` — what each service does
3. `docs/data-model.md` — MongoDB collections
4. `docs/service-communication-protocol.md` — how services talk
5. `docs/decision-log.md` — why things are the way they are
6. `docs/roadmap.md` + `docs/phase-log.md` — what's done and what's next

## Status
**Phase 1 foundation complete** — see `docs/phase-log.md`.
