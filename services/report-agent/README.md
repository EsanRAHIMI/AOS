# report-agent

Produces executive/system intelligence reports from kernel state and task
results (research, plan, review, QA, costs, system health). Grounded only in the
supplied data — never invents metrics or exposes secrets. Schema-validated LLM
reasoning with a deterministic fallback.

## Endpoints
Standard factory surface. `POST /.factory/task` input:
`{ title, kind?, inputs, evidenceIds?, forceFallback? }` → `{ report: { reportId, title, headline, sections, highlights, evidenceId } }`.

## Collections
`intelligence_reports`, plus `llm_traces`, `llm_cost_records`, `evidence_records`.

## Env
See `.env.example` (port 4114, subdomain reports.simorx.com).

## Deployment
Independent Dokploy app; see `deployment/dokploy/report-agent.md`.
