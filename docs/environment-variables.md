# Environment Variables

Each service has its own `.env` (copy from its `.env.example`). Real values are
never committed. Service-specific examples also live in `deployment/env/`.

## Shared (most services)
| Var | Purpose |
|---|---|
| NODE_ENV | development \| test \| production |
| FACTORY_ENV | local \| staging \| production |
| FACTORY_INTERNAL_TOKEN | service-to-service auth (required) |
| FACTORY_ADMIN_TOKEN | human/dashboard privileged auth |
| SERVICE_ID / SERVICE_NAME / SERVICE_DOMAIN / SERVICE_PORT | service identity |
| SERVICE_REGISTRY_URL | registry base URL for self-registration/discovery |
| EVENT_BUS_URL | event-bus base URL for publishing/streaming |
| LOG_LEVEL | trace…fatal |

## Database (all stateful services)
| Var | Purpose |
|---|---|
| MONGODB_URI | MongoDB Atlas connection string (required) |
| MONGODB_DB_NAME | default `autonomous_os_kernel` |

## Object storage (file-asset-service)
| Var | Purpose |
|---|---|
| AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY | IAM credentials |
| AWS_REGION / AWS_S3_BUCKET | bucket location + name |

## LLM (thinking agents)
| Var | Purpose |
|---|---|
| OPENAI_API_KEY / ANTHROPIC_API_KEY | provider keys |
| LLM_DEFAULT_PROVIDER | anthropic \| openai (router default) |

## Dashboard (server-side only)
| Var | Purpose |
|---|---|
| FACTORY_API_URL | gateway base URL |
| FACTORY_ADMIN_TOKEN | admin token used server-side |
| EVENT_BUS_URL + FACTORY_INTERNAL_TOKEN | for the `/api/stream` SSE proxy |

Validation: `shared/src/env` parses these with Zod at startup and fails fast on
missing/invalid values.

## Peer service URLs (Phase 2 — service-to-service discovery)
For each peer a service calls, set `<SERVICE_ID_UPPER_SNAKE>_URL` (e.g.
`ARCHITECT_AGENT_URL=https://architect.simorx.com`). If unset, the caller falls
back to `http://localhost:<port>` from the canonical `SERVICE_PORTS`. This is how
the orchestrator reaches specialists and the gateway reaches the orchestrator —
HTTP only, so every service stays independently deployable on Dokploy.

Orchestrator needs: ARCHITECT_AGENT_URL, BUILDER_AGENT_URL, DEVOPS_AGENT_URL,
MEMORY_AGENT_URL, DOCUMENTATION_SERVICE_URL.
Gateway needs: ORCHESTRATOR_AGENT_URL.
