# AOS Agent Runtime (`aos-agent-runtime`)

## Status: transitional consolidation candidate — NOT yet in production

This service does not replace anything until a human deliberately repoints
Dokploy at it. Today (as of D-168), production still runs the four original
services below as four separate Dokploy apps. This README describes what
this service IS and WILL DO after cutover — read `docs/deployment-plan.md` →
"aos-agent-runtime cutover (transitional)" for the actual current/target
split and the manual steps required to move from one to the other.

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

Not yet deployed. See `docs/deployment-plan.md` → "aos-agent-runtime
cutover (transitional)" for the exact, human-executed Dokploy steps required
before this service carries any real traffic, and the rollback path if
cutover needs to be reversed.

## Current status

Code-level consolidation candidate. Characterization-tested equivalent to
the 4 original services (35 tests, including real-port-binding and
env-non-contamination proofs). Production topology has NOT changed.

## Future improvements

Fold in the remaining confirmed-thin shells one group at a time
(builder-agent, devops-agent, documentation-service, memory-agent,
internet-research-service, voice-operator-agent, browser-testing-agent,
monitor-agent — each needs its own read-first pass per decision-log D-168).
Eventually collapse the 4 ports into path-based routing under one domain
once orchestrator-agent's peer env is deliberately updated (a separate,
larger, approval-gated step — not done here).
