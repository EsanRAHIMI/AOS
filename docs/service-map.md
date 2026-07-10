# Service Map

Current truth: AOS has **19 independently deployable services**. Service ids,
ports, and production subdomains are canonical in `shared/src/constants/index.ts`;
this document is the human-readable operating map.

## Control Plane

| Service | ID | Type | Port | Subdomain | Role |
|---|---|---|---:|---|---|
| Dashboard Web | `dashboard-web` | web | 4100 | `factory.simorx.com` | Living Command Universe home (`/`), Personal Command Center (`/me/*`), Mission Control (`/operations`), Operator Console, approvals, voice/text interface |
| Gateway API | `gateway-api` | gateway | 4101 | `api.simorx.com` | Public/API front door, auth, RBAC, task intake, operator executor, approvals |
| Orchestrator Agent | `orchestrator-agent` | agent | 4102 | `orchestrator.simorx.com` | Goal decomposition, pipeline coordination, policy-gated delegation |

## Specialist Intelligence Agents

| Service | ID | Type | Port | Subdomain | Role |
|---|---|---|---:|---|---|
| Architect Agent | `architect-agent` | agent | 4103 | `architect.simorx.com` | System design, service boundaries, API/data/event plans |
| Builder Agent | `builder-agent` | agent | 4104 | `builder.simorx.com` | Code generation, scaffolding, implementation planning |
| DevOps Agent | `devops-agent` | agent | 4105 | `devops.simorx.com` | Dokploy specs, env plans, deployment readiness |
| Reviewer Agent | `reviewer-agent` | agent | 4106 | `reviewer.simorx.com` | Independent code/architecture/security review |
| QA Agent | `qa-agent` | agent | 4107 | `qa.simorx.com` | Acceptance verification against goals and evidence |
| Memory Agent | `memory-agent` | agent | 4109 | `memory.simorx.com` | Memory summaries, reusable skills, decision/history compression |
| Monitor Agent | `monitor-agent` | agent | 4113 | `monitor.simorx.com` | Health scans, incidents, repair tasks, activation checks |
| Report Agent | `report-agent` | agent | 4114 | `reports.simorx.com` | Executive/system intelligence reports |
| Internet Research Service | `internet-research-service` | integration | 4115 | `research.simorx.com` | Governed research; real web search (Tavily, when `TAVILY_API_KEY` set on THIS service) grounds LLM synthesis, honest `sourceMode` when not configured — Phase AG. Reached synchronously from gateway-api's `research_topic`/`find_opportunities` Jarvis tools via `/.factory/task` (Phase AG.1), not just from orchestrator's async research pipeline. |
| Browser Testing Agent | `browser-testing-agent` | agent | 4116 | `browser-testing.simorx.com` | Playwright/HTTP UI validation, screenshots, evidence |
| Voice Operator Agent | `voice-operator-agent` | agent | 4121 | `voice.simorx.com` | Realtime voice session orchestration; never mutates directly |
| Code Operator Agent | `code-operator-agent` | agent | 4122 | `code.simorx.com` | Workspace-scoped repo search/edit/typecheck/build/git/PR operations |

## Infrastructure Services

| Service | ID | Type | Port | Subdomain | Role |
|---|---|---|---:|---|---|
| Service Registry | `service-registry` | infra | 4108 | `registry.simorx.com` | Service discovery, manifests, capability index |
| Documentation Service | `documentation-service` | infra | 4110 | `docs.simorx.com` | Living docs, phase logs, decisions, token-efficient context |
| Event Bus Service | `event-bus-service` | infra | 4111 | `events.simorx.com` | Persisted events + SSE fan-out to dashboard |
| File Asset Service | `file-asset-service` | infra | 4112 | `assets.simorx.com` | S3 files/artifacts + MongoDB metadata |

## Standard Service Surface

Every backend service must expose:

- `GET /health` public liveness.
- `GET /.factory/manifest` public identity/capability metadata.
- `GET /.factory/status` public uptime/dependency status.
- `GET /.factory/capabilities` public capability list.
- `POST /.factory/task` token-guarded work intake.
- `GET /.factory/logs` token-guarded recent logs.

This surface is provided by `@factory/service-kit` and verified by workspace
runtime probes before promotion.

## Transitional: aos-agent-runtime consolidation candidate (D-168/D-172)

**This section describes a candidate, not current production reality.** The
19-service table above is still accurate: production runs all 19 services
listed, unchanged, today. `services/aos-agent-runtime` (K1 Consolidation
Prep) is a parallel, characterization-tested replacement candidate for 7 of
the services above, built in two batches:

- Batch 1 (D-168): Architect, Reviewer, QA, Report agents. Has a full
  Dokploy cutover spec, verify script, and rollback runbook — cutover
  itself is `BLOCKED_ON_MANUAL_DEPLOYMENT` (D-169, re-confirmed D-171).
- Batch 2A (D-172): Memory Agent, Documentation Service, Internet Research
  Service. **Code-level candidate only — no cutover spec written yet.**

All 7 are hosted as one deployable process, each still bound to its own
historical port/domain/serviceId from the table above. Neither batch has
been deployed; neither carries production traffic.

Cutting production over from any of these 7 separate services to this one
deployable requires a human to manually repoint Dokploy — see
`docs/deployment-plan.md` → "aos-agent-runtime cutover (transitional)" for
Batch 1's exact steps and rollback path (Batch 2A has none yet). Until that
happens, this table's count of 19 production deployables remains correct;
this section exists so future agents/readers know the candidates exist and
where to find them, without mistaking their existence for a completed
migration.

## Growth Direction

The next services should extend AOS from a self-development kernel into a
multi-user operating layer. Esan remains the platform owner; each future user,
team, department, or citizen gets isolated data and role-scoped capabilities.

- `identity-and-tenant-service`: users, tenants, roles, consent, delegation.
- `personal-context-service`: user/tenant profiles, goals, preferences, constraints.
- `calendar-connector`, `email-connector`, `drive-connector`: read-first personal data ingestion.
- `opportunity-agent`: income, project, market, and technology opportunity analysis.
- `daily-briefing-agent`: daily/weekly planning, priorities, risks, and approvals.
- `knowledge-ingestion-service`: trusted web/file/email notes with citations and freshness.
- `public-service-case-service`: government/citizen workflows with strict audit and privacy.

All future services keep the same rules: isolated deployment, schema contracts,
evidence, approval for sensitive actions, no fake success.
