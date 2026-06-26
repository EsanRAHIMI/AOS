# Decision Log

Records significant engineering decisions and why. Newest first.

## 2026-06-26 — Phase 9 operational learning & memory intelligence

### D-043 Learning aggregates history; recommends; approval applies
The Historical Learning Engine reads 15 collections and produces reliability scores, patterns,
summaries, and recommendations. Nothing changes behavior automatically — recommendations are
evidence-backed, RBAC-gated (`approve_recommendation`), audited, and convert to a task/proposal on approval.

### D-042 Reliability + patterns are statistical, from many records (not one)
Reliability blends success/validation/incident/repair rates with a recent-vs-older trend and a
sample-size confidence. Patterns require support counts. This is the shift from single-decision
learning (Phase 8) to operational collective learning.

### D-041 Compressed memory first; raw history second
`memory_summaries` + `compressed_contexts` give future agents a low-token view of system state and
weak points, so they don't re-read raw history. Summaries cite source memory/evidence ids.

### D-040 Synthetic test history is marked and separate
Verification seeds history with `synthetic: true`; production analysis runs on real records. The
engine is pure over a history bundle, so it is testable without polluting production data.

## 2026-06-26 — Phase 8 learning governance & adaptive intelligence

### D-039 No silent learning: propose → approve → version → audit
Outcome reviews recommend scoring-weight changes, but they never apply automatically. A
`scoring_change_proposals` record is created; approval (RBAC) versions a new active
`scoring_profiles` entry and writes an audit log. Rejecting preserves the current profile.

### D-038 Active scoring profile drives the engine; scores reference the version
`scorePlans` takes the active profile's weights; every `plan_scores` row records `profileVersion`,
so decisions are reproducible and auditable across weight changes.

### D-037 Configurable policy with hardcoded safety overrides
`resolvePolicy` overlays scoped `policy_rules` on the code default, but `file_delete` and
`physical_action` are always blocked regardless of configuration — dangerous actions can never be
enabled by a config overlay.

### D-036 RBAC gates approvals; everything governance is audited
Roles owner/operator/viewer/agent with a permission catalog; `hasPermission` gates approval endpoints
(admin token → owner, internal token → agent). Approvals, denials, and scoring/policy changes all
write `audit_logs` entries with before/after.

## 2026-06-26 — Phase 7 strategic reasoning & policy-governed execution

### D-035 Planner never returns one plan; the scorer chooses with justification
`generateCandidatePlans` always yields ≥3 labelled plans (safe/fast/ambitious). `scorePlans`
ranks them across 10 dimensions and records the selection reason + rejection reasons, so every
choice is explainable and auditable.

### D-034 Policy engine gates every sensitive action; some are blocked outright
`evaluatePolicy` returns allowed / approval_required / blocked. `file_delete` and `physical_action`
are blocked by default; code/github/deploy/env/external/message/data/production require approval.
Decisions persist to `policy_decisions`. The selected plan's safe steps execute; sensitive steps
are gated by an approval.

### D-033 Reasoning is real but never trusted raw
The orchestrator reasons through the LLM router (real provider when keys are set). All output is
Zod-validated (`CandidatePlansSchema`); the deterministic fallback is itself validated. `promptVersion`
is recorded on every trace; `/v1/llm/status` shows real vs fallback. No raw LLM text mutates state.

### D-032 Decisions are remembered and become a skill
Each strategic decision writes a `decision_memories` record (+ a `decision_memory` Memory) capturing
options/choice/why/outcome/lessons, and reinforces `skill_strategic_planning` so future planning improves.

## 2026-06-26 — Phase 6 autonomous repair & execution

### D-031 Repair is diagnose→plan→approve→execute→re-verify; never faked
The monitor drives the loop deterministically. Execution runs only safe/approved actions and
re-runs the live activation check; the incident resolves and the capability returns to `active`
only when real HTTP evidence proves health. Incidents never close without an `incident_closed`
evidence record.

### D-030 Sensitive repair actions stay approval-gated
Env changes, code patches/PRs, and redeploys require approving the repair plan in the dashboard
before the executor runs. Safe artifacts are produced as evidence; nothing destructive or
production-changing happens automatically.

### D-029 Repair executor lives in the monitor (owns activation + incidents)
Diagnosis/plan engines are pure shared functions; the monitor persists and executes. Re-activation
uses `checkLiveService` directly so a re-check failure updates the existing incident instead of
opening a duplicate.

### D-028 Every repair produces learning
On resolution the kernel writes a `solution_memory`, reinforces a reusable
`skill_repair_service_activation`, and appends a `repair-log` doc.

## 2026-06-26 — Phase 5 live activation & runtime autonomy

### D-027 `active` is never faked — gated on live HTTP verification
`validated → active` requires the Live Service Activation Engine to pass real probes against
the service's domain (health, manifest, capabilities, safe task). If the service isn't
reachable, the capability stays `validated`, an incident opens, and a repair is proposed.

### D-026 Manual Dokploy flow kept; kernel guides, doesn't pretend to deploy
DevOps generates a precise checklist; the human creates the app; the kernel then runs the
activation check. The system never claims it deployed unless it actually did.

### D-025 Monitor owns activation + health; repair loop is deterministic-first
The monitor-agent runs activation checks and periodic scans, opening incidents + repair tasks
on failure. The first repair loop is deterministic (diagnosis + redeploy proposal, approval
required) — the model exists for richer automation later.

### D-024 Real modes behind credentials; status surfaced
GitHub delivery uses real REST when token+owner+repo are set (feature branch + PR only),
else prepared mode. LLM uses real providers when keys are set, else the schema-validated
fallback. `/v1/system/integrations` and `/v1/llm/status` make the mode visible; traces show
real vs fallback per call.

## 2026-06-26 — Phase 4 reality execution layer

### D-022 No claim without evidence; capability lifecycle gated on proof
`generated → validated` requires the runtime validation to pass; `validated → active`
requires the service-registry to confirm a reachable manifest. Every promotion and outcome
produces an `evidence_records` entry. The dashboard surfaces evidence on task/capability/
validation pages.

### D-021 GitHub delivery is feature-branch + PR only; prepared fallback offline
`GitHubDelivery` never pushes to the base branch — it creates a feature branch + PR (review
before merge), so it needs no extra approval gate. Real GitHub REST runs when `GITHUB_TOKEN`+
`GITHUB_OWNER`+`GITHUB_REPO` are set; otherwise a deterministic "prepared" operation records
the branch/files + git instructions. Pushing to main / prod deploy remain approval-gated.

### D-020 Validation co-located in the builder (owns the generated files)
The validation engine is a shared module run inside the builder-agent, which has the generated
files on its filesystem (avoids a cross-container shared volume). Static checks always run;
build/typecheck are opt-in via `ALLOW_BUILD_VALIDATION` so production containers don't shell out.

### D-019 Browser agent: Playwright with HTTP fallback, internal-only by default
`browser-testing-agent` uses `playwright-core` (optional dep, no browser auto-download) and
falls back to an HTTP-level check when no browser is present — still producing a real,
evidence-backed result. Targets are restricted to internal/owned hosts (`localhost`,
`*.simorx.com`); external targets require approval.

### D-018 browser_testing seeded as `generated`
Reflects the Phase 3 outcome (the agent was designed/generated). Phase 4 activates it. New
capability gaps can still be demoed with other capabilities (e.g. email, web research).

## 2026-06-26 — Phase 3 self-expanding capability engine

### D-017 LLM router with deterministic fallback; nothing unvalidated mutates state
`generateStructured(schema, { fallback })` returns only Zod-validated data. With no
provider key (local/test) the deterministic fallback is used and is itself validated.
This satisfies "an agent uses the LLM router for structured reasoning" while guaranteeing
no raw LLM text can mutate system state. Traces persist to `llm_traces` with cost/tokens.

### D-016 Capability analysis lives in the orchestrator; capability data in shared graph
The gap detector is part of goal handling (orchestrator owns decomposition). The capability
graph + gaps + proposals + evaluations are plain MongoDB collections read via the gateway —
no new always-on service required, keeping independent deployability intact. A dedicated
capability-service can be extracted later if needed.

### D-015 Expansion is approval-gated; approval converts a proposal into a build task
Detecting a missing capability never silently fails — it creates a proposal in
`waiting_approval`. Approving (gateway) emits `expansion.decided` and dispatches a
`build_from_proposal` task to the orchestrator. Sensitive self-expansion stays governed.

### D-014 Generator writes standard services to a configurable SERVICES_ROOT
The builder-agent scaffolds via `shared/generator` into `SERVICES_ROOT` (default a sandbox
dir, not the live repo) so a running container never clobbers source. Generated services are
real, build cleanly, and use the standard factory endpoints. GitHub-commit delivery is a
later refinement.

### D-013 Evaluation is deterministic from signals
`buildEvaluation` scores 10 dimensions from observed signals (docs updated, memory stored,
scaffold created, delegations succeeded, runtime validated, …) so the system never
hallucinates progress; recommendations flag what's missing (e.g. runtime validation).

## 2026-06-26 — Phase 2 first autonomous loop

### D-012 Test-only DB seam (`setTestDb`)
Added `setTestDb()` to `shared/db` so the real compiled pipeline/handlers can run
in-process against a fake Db for verification (the sandbox blocks downloading a
mongod binary). Clearly marked test-only; never used in production paths.

### D-011 Approval is the human-in-the-loop gate that drives the task
The orchestrator finishes the pipeline at `awaiting_approval` after devops creates the
infrastructure request. The gateway's approval decision endpoint then drives the linked
task: approve → `completed` + `task.completed`; reject → `cancelled` + `task.failed`.
Keeps the loop truthful (sensitive action gated) without a complex pause/resume engine.

### D-010 Orchestrator responds immediately; pipeline runs in background
`POST /.factory/task` returns `accepted` at once and runs the delegation pipeline
asynchronously with paced steps, so the dashboard shows a live, progressive timeline.

### D-009 Cross-service calls via env-configured peer URLs (`peerUrl`/`PeerClient`)
Resolution: `<SERVICE>_URL` env override → localhost default from `SERVICE_PORTS`.
Production sets these to subdomains. No shared runtime code, no registry hard-dependency
for the happy path — fully compatible with independent Dokploy deployment.

## 2026-06-25 — Phase 1 foundation

### D-008 Verified-current dependency versions
Pinned to June 2026 stable: Node 24 LTS (engines `>=22 <25` for sandbox compat),
Next.js 16.2, React 19, Fastify 5.8, Zod 4.4, MongoDB driver 6.x, AWS SDK v3,
TypeScript 5.9, pino 9. Verified via official sources before pinning.

### D-007 SSE via event-bus + dashboard server proxy
Event bus persists events to MongoDB and fans out over SSE. The dashboard
subscribes through a server-side Next.js route (`/api/stream`) that holds the
internal token, so browser secrets are never exposed. Redis/NATS backplane
deferred until multi-instance scale requires it.

### D-006 Internal vs admin tokens (RBAC later)
Two tokens now: internal (service-to-service) and admin (human/dashboard),
compared in constant time. Designed to evolve into full RBAC without breaking
the contract.

### D-005 MongoDB Atlas primary; AWS S3 objects
Per brief. No PostgreSQL. One `MongoClient` per process; `FileStorage` wraps S3
with presigned URLs; object metadata tracked in `s3_objects`.

### D-004 `@factory/service-kit` separate from `@factory/shared`
`shared` stays framework-agnostic (contracts/schemas/db/storage/utils). The
Fastify bootstrap lives in a second workspace package so the Next.js dashboard
and any non-Fastify consumer don't pull Fastify transitively. `createFactoryService`
gives every backend service identical standard endpoints, auth, registration,
and lifecycle.

### D-003 pnpm workspaces monorepo, independently deployable services
Chosen by owner. Shared code linked at build time; each service builds and
deploys independently on Dokploy (own root dir, env, port, subdomain). Runtime
communication is HTTP + internal tokens only.

### D-002 Standard factory endpoint surface
Every service exposes `/health` + `/.factory/{manifest,status,capabilities,task,logs}`
so the registry, dashboard, and agents can treat services uniformly.

### D-001 Production domain `simorx.com`
Subdomains derived in `shared/src/constants` (api., factory., orchestrator., …).
Swappable via `ROOT_DOMAIN` + env.
