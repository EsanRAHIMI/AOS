# Data Model (MongoDB Atlas)

Primary datastore for all text/structured data, logs, task records, memory,
documents, agent traces, and system state. Collection names are defined once in
`shared/src/constants/index.ts` (`COLLECTIONS`) — never hardcode strings.

## Collections
| Collection | Purpose | Schema (shared/src/schemas) |
|---|---|---|
| users | Operators / admins | — |
| sessions | Auth/session records | — |
| services | Registry records (manifest + lifecycle) | service-manifest.ts |
| agents | Agent definitions | — |
| tasks | Goals tracked end-to-end | task.ts (TaskSchema) |
| task_runs | Per-attempt task execution | task.ts |
| agent_runs | One execution of an agent on a task | agent-run.ts (AgentRunSchema) |
| agent_messages | Prompts/responses/tool-calls (for memory + training) | agent-run.ts |
| events | All system events (event bus persistence) | event.ts (SystemEventSchema) |
| logs | Structured logs | — |
| approvals | Sensitive-action decisions | approval.ts (ApprovalSchema) |
| infrastructure_requests | Dokploy infra the human must create | infrastructure-request.ts |
| memories | Compact reusable memory records | memory.ts (MemorySchema) |
| skills | Promoted reusable patterns | memory.ts (SkillSchema) |
| documents | Documentation store (versioned by slug) | — |
| decision_logs | Architecture/decision records | — |
| phase_logs | Phase completion records | — |
| research_reports | Cited research summaries | — |
| files / s3_objects | S3 object metadata | s3-object.ts (S3ObjectSchema) |
| deployments | Deployment records | — |
| environment_specs | Required env per service | — |
| service_manifests | Manifest history | service-manifest.ts |
| api_contracts | Stored API contracts | — |
| cost_records | Token/cost tracking | — |
| system_settings | Admin-configurable settings | — |
| evolution_proposals | Self-improvement proposals | — |

## Conventions
- IDs are prefixed (`task_…`, `arun_…`, `evt_…`) via `genId(prefix)`.
- Timestamps are ISO-8601 strings (`createdAt`, `updatedAt`).
- Indexes: unique on natural id (`serviceId`, `taskId`, `objectId`, …);
  time/compound indexes on `events` for fast streaming/history.
