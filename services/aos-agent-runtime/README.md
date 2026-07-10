# AOS Agent Runtime (`aos-agent-runtime`)

## Status: BLOCKED_ON_MANUAL_DEPLOYMENT (D-169)

Code-complete and fully characterization-tested (see decision-log D-168).
Cutover to production is **blocked on manual deployment** — this session's
sandbox has no network path to Dokploy (confirmed: `curl` to the Dokploy API
host times out from this environment) and, independent of that, actually
creating a Dokploy app and stopping four live production services is an
irreversible, production-affecting action that requires a human to execute
and approve, not something an agent should do unattended even where
credentials happen to be reachable. Today, production still runs the four
original services below as four separate Dokploy apps, unchanged.

**What the owner needs to do**, in order:
1. Read `deployment/dokploy/aos-agent-runtime.md` — exact Dokploy app spec,
   env vars, and the full cutover sequence.
2. Create the Dokploy app and deploy it as a **fifth**, parallel app (do not
   touch the 4 originals yet).
3. Run `scripts/aos-agent-runtime-cutover-verify.mjs` against it directly,
   before any domain repoint.
4. Repoint one domain at a time, re-verifying after each, per the sequence
   in the deployment doc.
5. Only after all 4 are repointed and verified: stop (not delete) the 4
   original apps.
6. If anything fails at any point: `scripts/aos-agent-runtime-rollback.md`.
7. After an observation period, decide separately whether to delete the old
   app definitions and repo folders — not part of this cutover.

This README describes what this service IS and WILL DO after cutover — read
`docs/deployment-plan.md` → "aos-agent-runtime cutover (transitional)" for
the actual current/target split.

## Purpose

K1 Consolidation Prep (`docs/master-direction.md` §C.1, decision-log D-168).
Hosts 4 of the eventual ~9 logical agent workers as one deployable process,
each still bound to its historical port/domain/serviceId:

| Worker | serviceId | Port | Historical domain |
|---|---|---|---|
| Architect Agent | `architect-agent` | 4103 | `architect.simorx.com` |
| Reviewer Agent | `reviewer-agent` | 4106 | `reviewer.simorx.com` |
| QA Agent | `qa-agent` | 4107 | `qa.simorx.com` |
| Report Agent | `report-agent` | 4114 | `reports.simorx.com` |

These four were chosen because they are confirmed, code-read (not assumed)
thin shells: each is ~60 lines of `createFactoryService` boilerplate around
a single already-shared reasoning function (`runArchitecturePlan`, `runQa`,
`runReview`, `runReport`, all living in `@factory/shared`) — there is no
unique logic in the original service folders to preserve.

## Why one process, four listeners (not one port)

This is a compatibility-shim consolidation, not a contract change:
orchestrator-agent's `PeerClient`, the dashboard's static service catalog,
and Dokploy's existing domain routing all resolve peers by historical
port/domain, unchanged. Each worker below is built via its own
`createFactoryService()` call with its own manifest and its own
`SERVICE_PORTS[...]`-derived port — nothing is read from this process's own
`SERVICE_ID`/`SERVICE_PORT` env (see `src/index.ts`'s top comment and
`test/characterization.consolidated.test.ts`'s explicit proof that poisoning
those two env vars does not leak into any worker).

## Source duplication is deliberate

`src/workers/*.ts` are duplicated from `services/{architect,qa,reviewer,
report}-agent/src/server.ts`, not imported — every service in this repo is
independently deployable/buildable and none imports another service's
source. The two copies are kept behaviorally identical by this package's
`test/characterization.consolidated.test.ts`, which re-runs each original
service's own `test/characterization.baseline.test.ts` assertions against
this build. **If you change one copy, change both and re-run both suites.**

## Public endpoints

- `GET /health` on each of the 4 ports above (liveness, unauthenticated)

## Internal endpoints (require `x-factory-internal-token`), per port

- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`

## Environment variables

See `.env.example`. `SERVICE_ID`/`SERVICE_PORT` describe this process's own
identity for its own logs only — see the table above for what each worker
actually binds to. All other keys (`MONGODB_URI`, `FACTORY_INTERNAL_TOKEN`,
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, etc.) are shared across all 4 workers,
same as they were shared implicitly (via 4 separate `.env` files with
identical values) before consolidation.

## Dependencies

Same as the 4 original services combined: `gateway-api`, `event-bus-service`,
`service-registry`, `memory-agent`, `documentation-service` (declared per-worker
in each `src/workers/*.ts` manifest, unchanged from the originals).

## Deployment

Not yet deployed. **BLOCKED_ON_MANUAL_DEPLOYMENT (D-169)** — see
`deployment/dokploy/aos-agent-runtime.md` for the exact Dokploy app spec and
`docs/deployment-plan.md` → "aos-agent-runtime cutover (transitional)" for
the full human-executed sequence, verification, and rollback path.

## Current status

Code-level consolidation candidate, cutover blocked on manual deployment.
Characterization-tested equivalent to the 4 original services (35 tests,
including real-port-binding and env-non-contamination proofs) — that proof
was also validated against real, actually-listening instances with
`scripts/aos-agent-runtime-cutover-verify.mjs` (20/20 checks passed) as part
of proving the verification script itself works, not just that the workers
do. Production topology has NOT changed.

## Future improvements

Fold in the remaining confirmed-thin shells one group at a time
(builder-agent, devops-agent, documentation-service, memory-agent,
internet-research-service, voice-operator-agent, browser-testing-agent,
monitor-agent — each needs its own read-first pass per decision-log D-168).
Eventually collapse the 4 ports into path-based routing under one domain
once orchestrator-agent's peer env is deliberately updated (a separate,
larger, approval-gated step — not done here).
