# Runbook: aos-agent-runtime rollback (K1 Consolidation Prep, D-168/D-169)

Use this during or after an `aos-agent-runtime` cutover attempt
(`deployment/dokploy/aos-agent-runtime.md`) if any check fails. This is an
incident runbook — short and actionable, not the full deployment spec.

## Trigger conditions (any one is enough to roll back)

- `scripts/aos-agent-runtime-cutover-verify.mjs` reports any `[FAIL]` for
  any of the 4 workers, at any point (pre-repoint, post-repoint, or during
  the observation window).
- Orchestrator dispatch to any of `architect-agent` / `reviewer-agent` /
  `qa-agent` / `report-agent` fails or errors.
- Mongo writes or published events stop appearing for any of the 4 workers.
- Error rate rises for `aos-agent-runtime` in monitor-agent/logs during the
  observation window.

## Step 1 — stop the bleeding

If you're mid-cutover and only some domains have been repointed: repoint
the affected domain(s) back to the corresponding **original** app's port.
The original apps were never stopped until cutover step 4, so this is
instant with zero data loss.

| Domain | Roll back to |
|---|---|
| `architect.simorx.com` | `architect-agent` app, port 4103 |
| `reviewer.simorx.com` | `reviewer-agent` app, port 4106 |
| `qa.simorx.com` | `qa-agent` app, port 4107 |
| `reports.simorx.com` | `report-agent` app, port 4114 |

If the original apps were already stopped (cutover step 4 already
happened): restart them from their last successful deploy. Their code and
repo folders are untouched by the consolidation — they still build and run
exactly as before.

## Step 2 — confirm rollback succeeded

```bash
FACTORY_INTERNAL_TOKEN=<token> node scripts/aos-agent-runtime-cutover-verify.mjs
```

All 4 workers' checks must show `[PASS]` again, now served by the original
apps. `ALL CHECKS PASSED` / exit 0 means rollback is confirmed.

## Step 3 — record it

Add an entry to `docs/decision-log.md` (or a short incident note) stating:
what triggered the rollback, which domain(s) were affected, how long the
new runtime was live, and what needs fixing in `aos-agent-runtime` before
attempting cutover again. Do not re-attempt cutover until the root cause is
understood.

## No data migration either direction

All 4 workers — old or new — write to the same Mongo collections
(`llm_traces`, `evidence_records`, `qa_reports`, `review_reports`,
`intelligence_reports`, `agent_runs`). Rolling back does not lose or
duplicate any data.
