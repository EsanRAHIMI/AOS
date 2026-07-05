# Agent Map

Each agent is an independent HTTP service with a manifest in
`services/<id>/src/factory/manifest.ts`. The registry stores the live manifest;
this document explains ownership and operating intent.

## Command and Coordination

| Agent | Main Responsibility | Must Produce |
|---|---|---|
| `orchestrator-agent` | Convert authorized user/tenant goals into governed plans and specialist work | task phases, events, approvals, final report |
| `code-operator-agent` | Inspect, evolve, verify, and prepare code in isolated workspaces | workspace run, verification matrix, migration/PR plan |
| `voice-operator-agent` | Voice/text mediation for operator commands | safe interpretation, permission requests, session memory |

## Build, Quality, and Operations

| Agent | Main Responsibility | Must Produce |
|---|---|---|
| `architect-agent` | Design boundaries, APIs, data, events, deployment shape | architecture plan + risks |
| `builder-agent` | Scaffold and implement code through existing patterns | generated/changed files + implementation notes |
| `reviewer-agent` | Fail unsafe, low-quality, or non-compliant output | findings with severity and evidence |
| `qa-agent` | Verify output against original goal and acceptance criteria | pass/fail report grounded in evidence |
| `devops-agent` | Deployment specs, Dokploy actions, env readiness | checklist, target mapping, rollback notes |
| `monitor-agent` | Runtime health, incidents, repair proposals | scans, incidents, repair tasks |

## Knowledge, Memory, and Intelligence

| Agent/Service | Main Responsibility | Must Produce |
|---|---|---|
| `memory-agent` | Compress outcomes into durable memories and skills | memory summaries, reusable patterns |
| `report-agent` | Convert system state into executive reports | concise operational intelligence reports |
| `internet-research-service` | Governed research with sources | cited findings; `fallback` clearly marked when no real search provider exists |
| `documentation-service` | Keep docs, decisions, and phase context alive | updated docs/decision/phase records |
| `browser-testing-agent` | UI/browser verification | screenshot/evidence or HTTP fallback result |

## Future User/Tenant Operating Agents

These are the priority agents for turning AOS into a real operating system for
Esan first, then for teams, institutions, government roles, and citizens:

- `daily-briefing-agent`: "What matters today?" priorities, risks, appointments, opportunities.
- `personal-strategy-agent`: monthly/quarterly life, career, business, and learning strategy.
- `opportunity-agent`: income ideas, jobs/projects, SaaS/product opportunities, market signals.
- `finance-intelligence-agent`: income/expense awareness, risk, runway, investment learning.
- `brand-resume-agent`: CV, portfolio, GitHub, LinkedIn, and public credibility growth.
- `tenant-governance-agent`: tenant policy, role boundaries, consent, audit posture.
- `public-service-agent`: citizen/government case workflows with strict permissions.

Future agents start read-only, become action-capable only after evidence, policy,
RBAC, and owner approval are in place.
