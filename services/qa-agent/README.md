# qa-agent

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
