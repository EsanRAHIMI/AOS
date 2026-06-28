# internet-research-service

Governed, **read-only** internet research. Produces an evidence-backed research
report with cited, reliability-scored sources. Reasons through the shared LLM
router (schema-validated) with a curated deterministic fallback that is clearly
marked. No mutation actions.

## Purpose
Give the kernel current, sourced knowledge for planning — without scraping
secrets/private data and without performing any mutation.

## Endpoints
Standard factory surface: `GET /health` (public), and internal-token-guarded
`GET /.factory/{manifest,status,capabilities,logs}`, `POST /.factory/task`.

`POST /.factory/task` input: `{ topic, forceFallback? }` → research run + sources + report + evidence.

## Collections
`research_runs`, `research_sources`, `research_reports`, plus `llm_traces`,
`llm_cost_records`, `evidence_records`.

## Env
See `.env.example` (port 4115, subdomain research.simorx.com). LLM keys optional —
without them the service runs in clearly-marked deterministic fallback.

## Deployment
Independent Dokploy app; see `deployment/dokploy/internet-research-service.md`.
