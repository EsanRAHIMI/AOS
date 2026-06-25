# Service Map

| Service | ID | Type | Port | Subdomain | Purpose |
|---|---|---|---|---|---|
| Gateway API | gateway-api | gateway | 4101 | api.simorx.com | Front door: tasks, approvals, infra, registry proxy, events |
| Dashboard Web | dashboard-web | web | 4100 | factory.simorx.com | Real-time control room (Next.js 16) |
| Orchestrator Agent | orchestrator-agent | agent | 4102 | orchestrator.simorx.com | Decompose goals, coordinate agents |
| Architect Agent | architect-agent | agent | 4103 | architect.simorx.com | Service/system architecture |
| Builder Agent | builder-agent | agent | 4104 | builder.simorx.com | Code generation/modification |
| DevOps Agent | devops-agent | agent | 4105 | devops.simorx.com | Dokploy/infra instructions |
| Memory Agent | memory-agent | agent | 4109 | memory.simorx.com | Memory + skill extraction |
| Documentation Service | documentation-service | infra | 4110 | docs.simorx.com | Living documentation store |
| Service Registry | service-registry | infra | 4108 | registry.simorx.com | Knows every service |
| Event Bus Service | event-bus-service | infra | 4111 | events.simorx.com | Persist + SSE fan-out |
| File Asset Service | file-asset-service | infra | 4112 | assets.simorx.com | S3 files + metadata |

## Planned (Phase 2+)
reviewer-agent (4106), qa-agent (4107), monitor-agent (4113),
report-agent (4114), internet-research-service (4115). Ports/subdomains are
reserved in `shared/src/constants`.
