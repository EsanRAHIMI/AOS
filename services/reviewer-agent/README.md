# reviewer-agent

Independent reviewer of plans, code, architecture, security and policy
compliance. **Allowed to FAIL outputs** — never rubber-stamps. Schema-validated
LLM reasoning with a deterministic checklist fallback. Produces evidence-backed
review reports; never mutates the thing it reviews.

## Endpoints
Standard factory surface. `POST /.factory/task` input:
`{ target, content, evidenceIds?, forceFallback? }` → `{ review: { passed, issues, risks, requiredFixes, recommendations, evidenceId } }`.

## Collections
`review_reports`, plus `llm_traces`, `llm_cost_records`, `evidence_records`.

## Env
See `.env.example` (port 4106, subdomain reviewer.simorx.com).

## Deployment
Independent Dokploy app; see `deployment/dokploy/reviewer-agent.md`.
