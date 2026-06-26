# Phase Log

## Phase 1 — Foundation — COMPLETE (2026-06-25)
Delivered:
- Root pnpm-workspace monorepo, base tsconfig, lint/ignore/env scaffolding.
- `@factory/shared`: constants, Zod schemas (manifest, task, agent-run, infra
  request, event, approval, memory, s3-object), contracts, env validation,
  pino logging, MongoDB Atlas connection layer, AWS S3 abstraction, internal-token
  auth, API envelope, manifest/status helpers, event publisher, registry client.
- `@factory/service-kit`: Fastify bootstrap with standard endpoints, auth,
  registry self-registration, event publishing, graceful shutdown.
- Services (independently deployable): gateway-api, service-registry,
  event-bus-service (SSE), file-asset-service (S3), documentation-service,
  orchestrator/architect/builder/devops/memory agents.
- dashboard-web (Next.js 16): overview, agents, services, tasks, tasks/:id,
  infrastructure, approvals, memory, skills, docs, events, logs, research,
  settings; server-side gateway client; live SSE feed via `/api/stream`.
- Data models for tasks, agent runs, infrastructure requests, approvals, events.
- Documentation set (this folder) + Dokploy deployment specs + env examples.

Verification: `pnpm install` + full workspace `tsc` build/typecheck **passing**
for shared, service-kit, all 10 backend services, and the dashboard.

Known gaps (by design, Phase 2): real agent reasoning/LLM router, agent-to-agent
delegation, approval/infra workflows end-to-end, memory extraction, docs
auto-update, reviewer/qa/monitor/report agents, internet-research-service.

## Phase 2 — First Autonomous Loop — COMPLETE (2026-06-26)
Output-first: the kernel now runs a real end-to-end loop, visible live in the dashboard.

Delivered:
- **Peer discovery** in `@factory/shared` (`peerUrl`, `PeerClient`): env-configurable
  service URLs with localhost defaults — HTTP-only, independent-deploy compatible.
- **Orchestrator delegation pipeline** (`orchestrator-agent/src/pipeline.ts`): accepts a
  goal, runs architect → builder → devops → documentation → memory in the background,
  emits a descriptive live timeline, opens an approval gate, compiles a final report.
- **Real specialist handlers**: architect (design plan), builder (scaffold), devops
  (persists a real Dokploy `InfrastructureRequest` + emits `infra.request.created`),
  memory (writes a compact `memories` doc + `memory.written`), documentation-service
  (appends phase-log/decision-log + per-task doc + `doc.updated`).
- **Approval-driven tasks**: gateway approval decision completes/cancels the linked task
  and emits `task.completed`/`task.failed`; infra confirm marks the request fulfilled.
- **Dashboard interactions**: create-task form, live SSE-filtered task timeline + final
  report on `/tasks/:id`, approve/reject on `/approvals`, confirm on `/infrastructure`.

Verification:
- Full workspace build + typecheck **passing** (shared, service-kit, 10 services, dashboard).
- In-process runtime smoke of the **real compiled pipeline** against a fake DB + fake
  peers: task → 5 delegations → infra request → approval gate → docs updated → memory
  stored → report assembled (status `awaiting_approval`), all artifacts validated against
  the shared Zod schemas. Result: **PASS**.

Acceptance criteria 1–10 met. Notes: agent reasoning is still deterministic (no LLM calls
yet); reviewer/qa/monitor/report agents and internet-research-service remain Phase 3. A
test-only DB seam (`setTestDb`) exists in `shared/db` for in-process verification.

## Phase 3 — Self-Expanding Capability Engine — COMPLETE (2026-06-26)
The kernel can now understand, expand, evaluate, and govern its own capabilities.

Delivered:
- **Capability graph** (`capabilities`) — first-class model of what the kernel can do,
  seeded on orchestrator startup; plus `capability_gaps`, `expansion_proposals`,
  `capability_evaluations`, `llm_traces` collections and Zod schemas (documented in
  data-model.md).
- **Capability gap detector** — the orchestrator analyzes a goal's required capabilities
  (via the LLM router, deterministic fallback), diffs against the active graph, and creates
  a `CapabilityGap` + `ExpansionProposal` + approval gate when something is missing.
- **Expansion proposal system** — proposals appear in the dashboard; approve / reject /
  request-changes; approving converts the proposal into a build task.
- **Service generator** (`shared/generator`) — scaffolds a real, standard, independently
  deployable service (package.json, tsconfig, src/index.ts using @factory/service-kit
  standard endpoints, manifest, README, .env). Builder-agent uses it; generated services
  build cleanly.
- **Build-from-proposal pipeline** — scaffold → infrastructure request → docs → memory +
  skill → evaluation → register capability (status `generated`) → final report.
- **LLM router** (`shared/llm`) — provider abstraction (Anthropic/OpenAI/deterministic
  Mock), model-by-task-type, retries, cost/token tracking, and **schema-validated
  structured output**. The orchestrator uses it for capability analysis. No unvalidated
  output mutates state (the fallback is itself schema-validated).
- **Evaluation engine** (`shared/evaluation`) — 10-dimension scoring → `Evaluation` records
  + events after each task/expansion.
- **Skill library** — memory-agent extracts/updates reusable `Skill`s after tasks.
- **Dashboard** — /capabilities, /capabilities/:id, /gaps, /expansion-proposals (with
  approve/reject/changes), /evaluations, /skills, /llm-traces; live + event-driven.

Verification:
- Full workspace build + typecheck **passing** (shared, service-kit, 10 services, dashboard).
- **Demo scenario PASS** ("Add browser testing capability"): analysis → gap `browser_testing`
  → proposal `browser-testing-agent` (Playwright) → approval gate → approve → build pipeline
  scaffolds the service (which **builds cleanly** and uses the standard factory endpoints) →
  infrastructure request → docs → memory + skill → evaluation 0.80 → capability registered
  as `generated` → final report. Ran against the real compiled pipelines + real generator.
- All 18 Phase 3 acceptance criteria met; independently deployable per service; no Docker;
  no sensitive action bypasses approval (LLM output schema-validated; expansion gated).

## Phase 4 — Reality Execution Layer — COMPLETE (2026-06-26)
The kernel now proves generated capabilities actually work — validated, committed, evidenced, activated.

Delivered:
- **Runtime Validation Engine** (`shared/validation`) — static factory-standard checks on a
  generated service (files, package.json, manifest contract, standard `/.factory` surface via
  service-kit, env docs, capability linkage) + optional build/typecheck; results persisted to
  `runtime_validations` with evidence.
- **GitHub Delivery Engine** (`shared/github`) — real GitHub REST when `GITHUB_TOKEN`+owner+repo
  set, else a deterministic "prepared" branch/commit/PR with ready-to-run git instructions;
  persisted to `github_operations`. Only ever creates a feature branch + PR (never pushes to main).
- **Reality Evidence Store** (`shared/evidence`, `evidence_records`) — the kernel never claims
  success without proof; build/validation/manifest/test_report/screenshot/github/approval evidence.
- **Capability lifecycle** — `proposed → approved → generated → validated → active`; promotion
  `generated→validated` only after validation passes, `validated→active` only after the registry
  confirms a reachable service.
- **Real browser-testing-agent** (`services/browser-testing-agent`) — permission-governed
  (internal/owned allowlist), Playwright when available else HTTP fallback, screenshot→S3,
  structured `BrowserTestReport`, evidence.
- **Activation pipeline** (orchestrator) — validate → promote → GitHub deliver → safe internal
  browser test → docs → memory + skill → evaluation → registry check → report. Builder gained
  `validate_service`; devops gained `github_deliver`.
- **Dashboard** — /validations (+:id with checks & evidence), /github, /evidence; capability
  detail shows the lifecycle ladder + evidence; task detail shows an evidence panel.

Verification:
- Full workspace build + typecheck **passing** (13 packages incl browser-testing-agent).
- **Activation demo PASS** ("Activate browser testing capability"): the **real** validation
  engine scored the **real** browser-testing-agent 1.0 (16/16 checks); GitHub delivery produced
  a `feat/browser-testing-agent-*` branch (prepared mode); capability promoted
  `generated → validated`; browser test passed; 5 evidence records
  (validation_report, manifest_check_result, github_commit, test_report, approval_decision);
  task completed with a final report. Stops at `validated` (not `active`) because the service
  isn't deployed yet — exactly per the promotion rule.
- All 20 Phase 4 acceptance criteria met. No Docker; independent Dokploy deployment intact;
  sensitive actions gated (GitHub stays on a feature branch + PR; LLM output schema-validated;
  nothing claimed without evidence).

Notes/limits (honest): GitHub runs in "prepared" mode until `GITHUB_TOKEN`/`GITHUB_REPO` are set;
the browser agent uses the HTTP fallback until `playwright-core` + a browser are installed;
build/typecheck validation is opt-in via `ALLOW_BUILD_VALIDATION`.
