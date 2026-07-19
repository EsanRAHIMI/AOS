# Environment Variables

Each service validates env at startup through `shared/src/env`. Invalid env must
fail fast with a readable error. Real secrets are never committed.

## Shared Service Env

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production` |
| `FACTORY_ENV` | `local`, `staging`, or `production` |
| `SERVICE_ID`, `SERVICE_NAME`, `SERVICE_DOMAIN`, `SERVICE_PORT` | service identity |
| `FACTORY_INTERNAL_TOKEN` | service-to-service auth |
| `FACTORY_ADMIN_TOKEN` | privileged gateway/dashboard auth (legacy path — see below) |
| `FACTORY_ALLOW_LEGACY_ROLE_AUTH` | default `true`. Kill switch (K1, D-164) for the legacy admin-token + self-declared `x-factory-role` path. Set `false` to stop trusting the role header (resolves to `viewer` instead) once real gateway sessions are in place everywhere that needs them. |
| `FACTORY_OWNER_PASSWORD_HASH` | no default. Must be a `scrypt$<saltHex>$<hashHex>` value produced by `node scripts/hash-password.mjs '<password>'`. Required to seed the owner's real login credential (`user_accounts`) — if unset or malformed, seeding is skipped with a warning, never a generated password. |
| `FACTORY_OWNER_EMAIL` | default `owner@local`. Email for the owner's seeded `user_accounts` row. |
| `SERVICE_REGISTRY_URL` | registry base URL |
| `EVENT_BUS_URL` | event bus base URL |
| `LOG_LEVEL` | pino log level |
| `REDIS_URL` | K1 Redis Backbone (D-167). Only read by `gateway-api` and `event-bus-service`. Default `''` (unset) = local/single-instance mode — event fan-out and rate limiting stay in-process, byte-identical to pre-D-167 behavior. Set to a real, reachable Redis URL (e.g. `redis://host:6379`) to make event fan-out and rate limits cross-instance-correct across N replicas behind one load balancer. Must be the **same** Redis for both services — they share one backbone. Never crashes the service if unreachable; degrades to local behavior with one throttled warning log. |
| `REDIS_KEY_PREFIX` | default `factory:`. Namespaces all keys/channels this backbone writes, so one Redis instance can safely be shared with other, unrelated key spaces if needed. |
| `AGENT_QUEUE_MAX_ATTEMPTS` | K1 BullMQ Task Queue (D-173). Default `3`. Read by every BullMQ producer/worker in the kernel (`aos-agent-runtime`'s 7 workers, `gateway-api`, `orchestrator-agent` — reuses `REDIS_URL` above; unset means queue code simply doesn't run, HTTP-only, unchanged from pre-D-173 behavior). Max delivery attempts per job before it's marked `dead_lettered`. |
| `AGENT_QUEUE_BACKOFF_MS` | default `2000`. Base exponential backoff delay (ms) between retry attempts. |
| `AGENT_QUEUE_CONCURRENCY` | default `4`. Max jobs a single worker instance processes concurrently, per serviceId queue. |
| `AGENT_QUEUE_TIMEOUT_MS` | default `30000`. A handler invocation slower than this is treated as a failure and feeds the same retry/backoff/dead-letter path as any other error. Also reused (D-174) as the `waitForCompletion` budget for `orchestrator-agent`'s synchronous-style pipeline dispatches (`dispatchPeerTask`) — how long to wait for a queued job run to reach a terminal state before degrading to HTTP. |
| `AGENT_DISPATCH_MODE` | K1 BullMQ Producer Adoption (D-174). One of `http` \| `queue_with_http_fallback` \| `queue_only`. Default `http` — every gateway→orchestrator-agent and orchestrator→{architect,qa,reviewer,report,memory,documentation-service,internet-research-service} dispatch uses HTTP only, byte-identical to pre-D-174 behavior, queue code is never entered. Read independently by `gateway-api` and `orchestrator-agent` — they do not have to match, though running them in different modes long-term is an unusual, not-recommended configuration. Set `queue_with_http_fallback` to route real traffic through BullMQ while keeping HTTP as an explicit, observable (`agent.dispatch.degraded` event + `Task.dispatchMode`) fallback. `queue_only` additionally removes the fallback — a queue failure is reported as a failure, not silently absorbed by HTTP; not recommended until the queue path has real-Redis operational history. |

## Data and Assets

| Var | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_DB_NAME` | persistent state |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | file asset service |
| `CLOUDFRONT_DOMAIN` | optional public asset delivery |

## Intelligence and Voice

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | real LLM/realtime providers |
| `LLM_DEFAULT_PROVIDER` | default provider selection |
| `LLM_MAX_COST_PER_TASK_USD` | per-task budget gate |
| `LLM_SAFE_MODE_FALLBACK` | force deterministic fallback |
| `VOICE_*` | realtime voice model/session settings |
| `TAVILY_API_KEY` | Phase AG — real web search grounding for `internet-research-service` (`shared/src/research`). **Must be set on `internet-research-service` itself** — that is the only process that calls Tavily; read once at boot, so the service needs a **restart** after the key is set or changed. Optional elsewhere: unset falls back to LLM-recall/curated knowledge, honestly marked via `sourceMode: 'llm_only' \| 'curated_fallback'` on every research record, never silently upgraded to "real". Setting it on `gateway-api` too is optional — it only makes `GET /v1/system/integrations`'s `research.configured` flag accurate; gateway-api never calls Tavily directly, it always delegates to `internet-research-service` (Phase AG.1 — see decision-log D-136). |

## Delivery and Operations

| Var | Purpose |
|---|---|
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_DEFAULT_BRANCH` | real PR delivery |
| `DOKPLOY_BASE_URL`, `DOKPLOY_API_TOKEN` | Dokploy diagnostics/execution |
| `CODE_WORKSPACE_ROOT` | isolated checkout for code operator work |
| `WORKSPACE_ROOT`, `SERVICES_ROOT`, `REPO_SERVICES_ROOT` | validation/generation roots |
| `ALLOW_BUILD_VALIDATION` | opt-in build validation |

## Dashboard

| Var | Purpose |
|---|---|
| `FACTORY_API_URL` | gateway URL |
| `DASHBOARD_SESSION_SECRET` | signed session cookies |
| `DASHBOARD_*_PASSWORD_HASH` | login credentials |
| `DASHBOARD_*_ROLE` | owner/operator/viewer role mapping |

## Future Env Direction

- Move user auth to OIDC/OAuth2/JWT and persistent per-user RBAC.
- Add tenant, organization, and public-service identity provider configuration.
- Add connector consent and permission scopes per tenant/user.
- ~~Add Redis URL when distributed rate limits/safe mode/session invalidation are implemented.~~
  Done for event fan-out and rate limits (D-167, `REDIS_URL`/`REDIS_KEY_PREFIX` above). Session
  invalidation across instances is not yet built — sessions still resolve from Mongo per-request
  (already cross-instance-correct on read) but there is no instant cross-instance revocation signal
  yet.
- Redis Streams/BullMQ for a real durable task queue (`POST /v1/tasks` is still direct
  forward-and-forget HTTP to orchestrator-agent) — deliberately deferred, D-167. Redis pub/sub above
  covers event fan-out only, not a persistent/replayable queue.
- Add connector-specific env only after read-only connector contracts are documented.

## CIN v2 (D-179/D-180)

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `CIN_PQC_SIGNING` | gateway-api (shared/cin) | unset | `1` = new entity keys use post-quantum `ml-dsa-65` when the runtime supports it (Node ≥ 24.7 + OpenSSL 3.5); otherwise `ed25519`. Detection is automatic — this only opts in. |
| `JARVIS_HEARTBEAT_INTERVAL_MS` | gateway-api | `300000` | Background heartbeat pulse cadence (proactive events). `0` disables the in-process pulse. |
| `LIVING_LOOP_INTERVAL_MS` | gateway-api | `60000` | Autonomous Living Loop background tick cadence. `0` disables. |
