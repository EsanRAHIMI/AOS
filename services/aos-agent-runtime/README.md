# AOS Agent Runtime (`aos-agent-runtime`)

## Status: CODE-LEVEL CANDIDATE ONLY — PRODUCTION TOPOLOGY UNCHANGED (D-172)

Two independent batches live in this one package, at two different
operational stages:

- **Batch 1** (architect/qa/reviewer/report, D-168): code-complete, fully
  characterization-tested, and has a full deployment spec + verify script +
  rollback runbook — but cutover is **`BLOCKED_ON_MANUAL_DEPLOYMENT`**
  (D-169, re-confirmed D-171: this sandbox has no network egress at all,
  confirmed against a neutral control target, not just the Dokploy host).
- **Batch 2A** (documentation-service, memory-agent,
  internet-research-service, D-172): **code-level candidate only** — built
  and characterization-tested this pass, but **no deployment spec, no
  verify script, and no Dokploy work has been done for it**, per explicit
  instruction not to touch Dokploy in this pass. Do not treat Batch 2A as
  cutover-ready; it hasn't been through the same operational-readiness
  steps Batch 1 has.

Today, production still runs all 7 original services below as 7 separate
Dokploy apps, unchanged. **What the owner needs to do** for Batch 1 (only —
Batch 2A has no cutover plan yet), in order:
1. Read `deployment/dokploy/aos-agent-runtime.md` — exact Dokploy app spec,
   env vars, and the full cutover sequence (Batch 1 only).
2. Create the Dokploy app and deploy it as a parallel app (do not touch the
   4 Batch-1 originals yet).
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

K1 Consolidation Prep (`docs/master-direction.md` §C.1, decision-log D-168/
D-172). Hosts 7 of the eventual ~9 logical agent workers as one deployable
process, each still bound to its historical port/domain/serviceId:

| Worker | serviceId | Port | Historical domain | Batch |
|---|---|---|---|---|
| Architect Agent | `architect-agent` | 4103 | `architect.simorx.com` | 1 (D-168) |
| Reviewer Agent | `reviewer-agent` | 4106 | `reviewer.simorx.com` | 1 (D-168) |
| QA Agent | `qa-agent` | 4107 | `qa.simorx.com` | 1 (D-168) |
| Memory Agent | `memory-agent` | 4109 | `memory.simorx.com` | 2A (D-172) |
| Documentation Service | `documentation-service` | 4110 | `docs.simorx.com` | 2A (D-172) |
| Report Agent | `report-agent` | 4114 | `reports.simorx.com` | 1 (D-168) |
| Internet Research Service | `internet-research-service` | 4115 | `research.simorx.com` | 2A (D-172) |

The Batch-1 four were chosen because they are confirmed, code-read (not
assumed) thin shells: each is ~60 lines of `createFactoryService`
boilerplate around a single already-shared reasoning function
(`runArchitecturePlan`, `runQa`, `runReview`, `runReport`). The Batch-2A
three were chosen after a full-source re-read (decision-log D-170/D-172)
confirmed none has a filesystem write, a write-capable external API call, a
spawned OS process, or a background timer — memory-agent and
documentation-service are pure Mongo CRUD; internet-research-service adds
only an LLM-router call and an optional read-only web-search call, the same
risk class already accepted for Batch 1's LLM calls.

## Why one process, seven listeners (not one port)

This is a compatibility-shim consolidation, not a contract change:
orchestrator-agent's `PeerClient`, the dashboard's static service catalog,
and Dokploy's existing domain routing all resolve peers by historical
port/domain, unchanged. Each worker below is built via its own
`createFactoryService()` call with its own manifest and its own
`SERVICE_PORTS[...]`-derived port — nothing is read from this process's own
`SERVICE_ID`/`SERVICE_PORT` env (see `src/index.ts`'s top comment and
`test/characterization.consolidated*.test.ts`'s explicit proof that
poisoning those two env vars does not leak into any worker).

## Source duplication is deliberate

`src/workers/*.ts` are duplicated from each original service's
`src/server.ts` (Batch 1) or `src/index.ts`-turned-`server.ts` (Batch 2A),
not imported — every service in this repo is independently deployable/
buildable and none imports another service's source. The two copies are
kept behaviorally identical by this package's
`test/characterization.consolidated.test.ts` (Batch 1) and
`test/characterization.consolidated.batch2a.test.ts` (Batch 2A), which
re-run each original service's own `test/characterization.baseline.test.ts`
assertions against this build. **If you change one copy, change both and
re-run both suites.**

## Public endpoints

- `GET /health` on each of the 7 ports above (liveness, unauthenticated)

## Internal endpoints (require `x-factory-internal-token`), per port

- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`
- `documentation-service`'s port additionally exposes `POST /docs`, `GET /docs`, `GET /docs/:slug` (internal-token guarded), unchanged from the original.

## Environment variables

See `.env.example`. `SERVICE_ID`/`SERVICE_PORT` describe this process's own
identity for its own logs only — see the table above for what each worker
actually binds to. All other keys (`MONGODB_URI`, `FACTORY_INTERNAL_TOKEN`,
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, etc.) are shared across all 7 workers,
same as they were shared implicitly (via 7 separate `.env` files with
identical values) before consolidation. `TAVILY_API_KEY` is optional and
only read by the `internet-research-service` worker.

## Dependencies

Same as the 7 original services combined: `gateway-api`, `event-bus-service`,
`service-registry`, `memory-agent`, `documentation-service`, `file-asset-service`
(declared per-worker in each `src/workers/*.ts` manifest, unchanged from the
originals).

## Task queue (K1 BullMQ, D-173, optional)

`REDIS_URL` unset (the default) means all 7 workers process tasks over HTTP
`/.factory/task` only — identical to before this feature existed. Setting
`REDIS_URL` additionally starts one `bullmq` `Worker` per worker (queue
`agent-tasks:{serviceId}`), each processing through that worker's SAME
`handleTask` function the HTTP route already calls — both paths work in
parallel, nothing is removed. See `docs/decision-log.md` D-173,
`docs/deployment-plan.md`'s "BullMQ Task Queue" section, and
`scripts/agent-queue-verify.mjs` for a real-Redis+Mongo end-to-end check.
No orchestrator/gateway call site has been rewired to dispatch through the
queue yet — this pass only builds and proves the consumer side.

## Deployment

Not yet deployed. Batch 1: **BLOCKED_ON_MANUAL_DEPLOYMENT (D-169/D-171)** —
see `deployment/dokploy/aos-agent-runtime.md` for the exact Dokploy app spec
and `docs/deployment-plan.md` → "aos-agent-runtime cutover (transitional)"
for the full human-executed sequence, verification, and rollback path.
Batch 2A: **no deployment spec written yet** — code-level candidate only.

## Current status

Code-level consolidation candidate for all 7 workers. Batch 1's cutover is
blocked on manual deployment (network-isolated sandbox, confirmed twice —
D-169, D-171). Batch 2A has no cutover attempt or spec at all. Full
characterization-test equivalence to all 7 original services (Batch 1: 35
tests, including real-port-binding and env-non-contamination proofs — also
validated against real, actually-listening instances with
`scripts/aos-agent-runtime-cutover-verify.mjs`, 20/20 checks passed; Batch
2A: see `test/characterization.consolidated.batch2a.test.ts`, including a
combined 7-worker real-port-binding proof). Production topology has NOT
changed for either batch.

## Future improvements

Fold in the remaining confirmed-must-remain-separate services only if a
future, separately-designed sandboxed/isolated-runtime approach is
proposed end-to-end (builder-agent, devops-agent, monitor-agent,
voice-operator-agent, browser-testing-agent — each classified
must-remain-separate in decision-log D-170 due to filesystem writes, real
GitHub API writes, live secret minting, or a spawned browser process; not
started here). Eventually collapse the 7 ports into path-based routing
under one domain once orchestrator-agent's peer env is deliberately updated
(a separate, larger, approval-gated step — not done here).
