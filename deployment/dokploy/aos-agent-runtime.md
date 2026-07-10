# Dokploy — aos-agent-runtime (K1 Consolidation Prep, D-168/D-169)

**Status: BLOCKED_ON_MANUAL_DEPLOYMENT.** This app does not exist in Dokploy yet.
Production still runs `architect-agent`, `reviewer-agent`, `qa-agent`, and
`report-agent` as four separate apps — see their individual specs
(`deployment/dokploy/{architect,reviewer,qa,report}-agent.md`), which remain
accurate and unchanged. This document is what the owner needs to create the
new app; it is not a record of something already deployed.

## What this app replaces (only after cutover is verified)

| Worker | serviceId | Historical domain | Port |
|---|---|---|---|
| Architect Agent | `architect-agent` | `architect.simorx.com` | 4103 |
| Reviewer Agent | `reviewer-agent` | `reviewer.simorx.com` | 4106 |
| QA Agent | `qa-agent` | `qa.simorx.com` | 4107 |
| Report Agent | `report-agent` | `reports.simorx.com` | 4114 |

## Dokploy app settings

| Setting | Value |
|---|---|
| App name | `aos-agent-runtime` |
| Repository | `github.com/<owner>/autonomous-os-kernel` |
| Root directory | `services/aos-agent-runtime` |
| Build context | repo root (pnpm workspace) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/aos-agent-runtime... run build` |
| Start command | `pnpm --filter @factory/aos-agent-runtime run start` |
| Health check | `/health` on port 4103 (any of the 4 ports works equally; pick one) |
| **Exposed ports** | **4103, 4106, 4107, 4114 — all four, from this one container.** This is the one setting that differs from every other single-port app in this repo; most Dokploy setups expose one port per app; this one needs four. |
| Domain routing | Route each of the 4 historical domains above to its matching port on this container — no new domains, no DNS changes. |

## Required environment

Union of the 4 original services' env (identical shape across all 4 today):

```env
NODE_ENV=production
FACTORY_ENV=production
FACTORY_INTERNAL_TOKEN=<same shared internal token the 4 originals use today>
FACTORY_ADMIN_TOKEN=

# Process-identity only — NOT read by any of the 4 workers (see D-168).
# Never used to route or authenticate anything; purely for this process's
# own structured logs.
SERVICE_ID=aos-agent-runtime
SERVICE_NAME=AOS Agent Runtime
SERVICE_PORT=4199

SERVICE_REGISTRY_URL=https://registry.simorx.com
EVENT_BUS_URL=https://events.simorx.com

MONGODB_URI=<same Atlas URI the 4 originals use today>
MONGODB_DB_NAME=autonomous_os_kernel

# Optional — enables real LLM reasoning (else deterministic fallback):
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_DEFAULT_PROVIDER=anthropic

LOG_LEVEL=info
```

No new secrets are required — this is the same `FACTORY_INTERNAL_TOKEN` and
`MONGODB_URI` the 4 original apps already use. No Redis dependency (none of
these 4 workers touch Redis — see decision-log D-167/D-168).

## Cutover sequence (near-zero downtime, human-executed)

1. **Deploy `aos-agent-runtime` as a NEW, fifth app.** Do not touch the 4
   original apps yet — they keep serving all production traffic.
2. **Verify in isolation**, before any routing change: run
   `scripts/aos-agent-runtime-cutover-verify.mjs` against the new app's
   internal/direct addresses (not yet the public domains). All checks must
   pass — see that script's own output for the exact list.
3. **Repoint one domain at a time.** For each of the 4 domains: change its
   Dokploy routing target from the old app's port to the new app's matching
   port, then immediately re-run the verify script against that public
   domain, then move to the next domain only if it passes. Stop and roll
   back (see below) immediately if any check fails.
4. **Only once all 4 domains are repointed and verified**, stop (do not
   delete) the 4 original Dokploy apps.
5. **Observe.** Watch monitor-agent / logs / error rates for an agreed
   period (recommend at least 48h covering a full task-dispatch cycle from
   orchestrator-agent) before deleting the old app definitions or the old
   service folders from the repo.

## Post-cutover verification (repeat after step 3 and again after step 4)

Run `scripts/aos-agent-runtime-cutover-verify.mjs` — it checks, per worker:
`/health`, `/.factory/manifest` (correct serviceId), `/.factory/status`,
`/.factory/capabilities`, and a real `POST /.factory/task` round trip
(writes the expected Mongo collections, returns `accepted:true`). It also
optionally verifies orchestrator-agent can dispatch to all 4 serviceIds
through the new runtime — pass `--orchestrator-url` to enable that check.

## Rollback

**Trigger conditions:** any worker fails `/health` post-repoint; orchestrator
dispatch fails/errors for any of the 4 serviceIds; Mongo writes or published
events stop appearing for any worker; error rate rises during the
observation window.

**Procedure:** if the affected domain(s) were just repointed (step 3) and the
old apps are still running (not yet stopped), repoint the domain(s) back to
the old app's port — instant, no data loss. If the old apps were already
stopped (step 4), restart them from their last successful deploy — their
code and folders are untouched and still independently buildable. No data
migration is needed either direction: all 4 workers write to the same Mongo
collections (`llm_traces`, `evidence_records`, `qa_reports`,
`review_reports`, `intelligence_reports`, `agent_runs`) regardless of which
deployable produced them.

## Cleanup (separate step, only after the observation period)

Deleting `services/{architect,qa,reviewer,report}-agent` from the repo and
their Dokploy app definitions is a **separate, later, explicitly-approved
step** — not part of this cutover. Do this only after `aos-agent-runtime`
has been healthy in production for the agreed observation period.
