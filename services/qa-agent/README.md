# qa-agent

> **Consolidation candidate (D-168):** `services/aos-agent-runtime` hosts a
> behaviorally-equivalent, characterization-tested copy of this service's
> logic on the same port/domain/serviceId. This service is **not
> deprecated** — it is the live production deployable today and remains so
> until a human deliberately repoints Dokploy at `aos-agent-runtime`. Once
> that cutover happens and is verified, this folder becomes superseded (not
> before). See `docs/deployment-plan.md` → "aos-agent-runtime cutover
> (transitional)".

QA acceptance verifier. Derives acceptance criteria from the goal and checks each
against the produced evidence. **Never passes without evidence.** Schema-validated
LLM reasoning with a deterministic fallback. Produces evidence-backed QA reports
and is allowed to fail.

## Endpoints
Standard factory surface. `POST /.factory/task` input:
`{ goal, evidenceSummary, evidenceIds?, forceFallback? }` → `{ qa: { passed, criteria, gaps, verdict, evidenceId } }`.

## Collections
`qa_reports`, plus `llm_traces`, `llm_cost_records`, `evidence_records`.

## Env
See `.env.example` (port 4107, subdomain qa.simorx.com).

## Deployment
Independent Dokploy app; see `deployment/dokploy/qa-agent.md`.
