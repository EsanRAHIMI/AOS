# report-agent

> **Consolidation candidate (D-168):** `services/aos-agent-runtime` hosts a
> behaviorally-equivalent, characterization-tested copy of this service's
> logic on the same port/domain/serviceId. This service is **not
> deprecated** — it is the live production deployable today and remains so
> until a human deliberately repoints Dokploy at `aos-agent-runtime`. Once
> that cutover happens and is verified, this folder becomes superseded (not
> before). See `docs/deployment-plan.md` → "aos-agent-runtime cutover
> (transitional)".

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
