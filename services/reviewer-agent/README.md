# reviewer-agent

> **Consolidation candidate (D-168):** `services/aos-agent-runtime` hosts a
> behaviorally-equivalent, characterization-tested copy of this service's
> logic on the same port/domain/serviceId. This service is **not
> deprecated** — it is the live production deployable today and remains so
> until a human deliberately repoints Dokploy at `aos-agent-runtime`. Once
> that cutover happens and is verified, this folder becomes superseded (not
> before). See `docs/deployment-plan.md` → "aos-agent-runtime cutover
> (transitional)".

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
