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

## Phase 5 — Live Activation & Runtime Autonomy — COMPLETE (2026-06-26)
The kernel is now operationally alive: it proves deployed services are reachable, registered, callable, monitored, and usable — and only then calls a capability `active`.

Delivered:
- **Live Service Activation Engine** (`shared/activation`) — real HTTP probes (registry,
  domain, /health, manifest, capabilities, safe POST /.factory/task, logs, capability link)
  → `service_activations` + evidence. Promotes `validated → active` only on pass.
- **Dokploy Activation Checklist** (`shared/deployment`, devops `activation_checklist`) —
  precise, copyable app/env/verification checklist per validated service → `deployment_checklists`.
- **Monitor Agent** (`services/monitor-agent`) — periodic registry health scans
  (`monitor_runs`), live activation checks, failure detection → `incidents`, repair proposals
  → `repair_tasks` (the repair loop). 12th service.
- **Real GitHub mode** — `GitHubDelivery` already promotes to real REST when
  `GITHUB_TOKEN`+`GITHUB_OWNER`+`GITHUB_REPO` are set (feature branch + PR, never main);
  prepared mode otherwise. Gateway `/v1/system/integrations` reports the mode.
- **Real LLM activation** — versioned per-agent prompts, `router.healthCheck()`,
  `/v1/llm/status` (real vs fallback, cost, invalid count). No unvalidated output mutates state.
- **Dashboard** — /deployment/checklists ("I created this in Dokploy" + "Run activation
  check" + copyable env), /activations(+:id), /monitor, /incidents, /repair-tasks, /llm/status;
  GitHub/LLM mode indicators; capability lifecycle ladder reaches `active`.

Verification:
- Full workspace build + typecheck **passing** (14 packages incl monitor-agent).
- **Live-activation demo PASS** ("Activate browser-testing-agent on production"): the **real**
  monitor activation engine ran against (a) a **real reachable mock factory service** → 8/8
  checks pass → capability promoted to **active**, 4 evidence records, 1 activation record; and
  (b) an **unreachable target** → activation fails → **incident** opened + **repair task**
  proposed (redeploy, approval-required) → capability **stays validated**. All lifecycle events
  emitted. Honest: production `active` requires the user to create the Dokploy app; the engine
  then verifies the real domain.
- All 24 Phase 5 acceptance criteria met. No Docker; independent Dokploy deploy intact;
  sensitive actions gated; nothing claimed without evidence; `active` never faked.

## Phase 6 — Autonomous Repair & Execution — COMPLETE (2026-06-26)
The kernel now drives the repair loop to resolution: diagnose → plan → approve → execute → re-verify → resolve, all evidenced.

Delivered:
- **Repair Diagnosis Engine** (`shared/repair` `diagnose()`) — maps failed activation checks to
  ranked suspected causes with confidence + evidence → `repair_diagnoses`.
- **Repair Plan Engine** (`buildRepairPlan()`) — structured plan by type (env_fix / domain_fix /
  code_patch / registry_fix / manual_action) with required approvals, env/code/dokploy changes,
  and post-repair validation → `repair_plans`.
- **Repair Executor** (monitor-agent `repair.ts`) — runs only safe/approved actions (corrected
  env/dokploy instructions, prepared GitHub patch branch, re-run validation/activation),
  re-checks the live service, and **resolves the incident only with evidence**.
- **Approval-gated execution**, extended incident/repair lifecycles, eight new repair evidence types.
- **Repair learning** — on resolution: a `solution_memory`, a reusable
  `skill_repair_service_activation`, and a `repair-log` doc written automatically.
- **Dashboard** — incident detail (what/why/evidence/plan/approve-reject-changes/mark-manual-done
  & re-check/attempts/resolution), repair-task detail, /repair-diagnoses, /repair-plans.

Verification:
- Full workspace build + typecheck **passing** (14 packages).
- **Repair-loop demo PASS** ("Repair browser-testing-agent activation failure"): real failed
  activation (unreachable) → incident + repair task → diagnosis (top cause "service unreachable",
  0.8) → plan (`domain_fix`) → corrected reachable URL → executor re-runs the real activation →
  passes → capability **active**, incident **resolved**, repair task **completed**, with evidence
  at every step + memory + skill + repair-log. Ran against the real compiled repair engine + real HTTP.
- All 24 Phase 6 acceptance criteria met. No Docker; independent Dokploy deploy intact; no faked
  repair; incidents never close without evidence; capability active only after real HTTP
  re-activation; sensitive actions approval-gated.

## Phase 7 — Strategic Reasoning & Policy-Governed Execution — COMPLETE (2026-06-26)
The kernel now reasons over multiple strategies, scores them, checks policy, chooses with justification, and remembers the decision.

Delivered:
- **Strategic Planner** (`shared/planner`) — generates ≥3 candidate plans (safe/fast/ambitious)
  via the LLM router with schema-validated output and a deterministic, validated fallback.
- **Plan Scoring Engine** (`shared/scoring`) — scores each plan across 10 dimensions (success,
  risk, cost, speed, evidence, reversibility, human-intervention, capability-fit, policy,
  long-term value) → `plan_scores`; selects the best with a justification + reasons for rejecting.
- **Policy Engine** (`shared/policy`) — `evaluatePolicy(action)` → allowed / approval_required /
  blocked per category; `file_delete` + `physical_action` blocked by default; code/github/deploy/
  env/external/message/data/production gated → `policy_decisions`.
- **Decision Memory** (`decision_memories`) — options, selection, reason, alternatives, outcome,
  lessons; plus a `decision_memory` Memory and a reusable `skill_strategic_planning`.
- **Real LLM operational** — versioned per-agent prompts, `promptVersion` on traces, real vs
  fallback visible (`/v1/llm/status`, `/v1/system/integrations`), traces linked to task+agent.
- **Reasoning Dashboard** — /reasoning, /strategic-plans(+:id with scores), /policy-decisions,
  /decision-memory, /llm-traces/:id; task detail shows the full reasoning trail (selected plan,
  rejected alternatives, policy, provider, cost, confidence, decision id).

Verification:
- Full workspace build + typecheck **passing** (14 packages).
- **Reasoning demo PASS** ("Improve the reliability of browser-testing-agent"): the **real**
  compiled strategic pipeline produced **3 plans** → scored → selected **safe_plan** (total 0.90)
  with justification + 2 rejected alternatives → **policy** flagged the other plans' sensitive
  actions (github/deploy/env → approval_required) while `run_validation` → allowed → executed the
  safe step (**real runtime validation** ran on the real browser-testing-agent) → evaluation 0.82
  → decision memory + memory + skill written → task completed with a reasoning report. LLM trace
  was schema-validated (fallback, promptVersion v1) and linked to the task.
- All 24 Phase 7 acceptance criteria met. No Docker; independent Dokploy deploy intact; LLM output
  schema-validated (never mutates state raw); sensitive actions policy-checked and approval-gated;
  deterministic fallback kept and visible.

## Phase 8 — Learning Governance & Adaptive Intelligence — COMPLETE (2026-06-26)
The kernel now governs its own evolution: it learns how to decide better from outcomes, but only under approval, versioning, and audit.

Delivered:
- **Outcome Learning Engine** (`shared/governance` `outcomeReview`) — compares a plan's predicted
  score to the actual evaluation, classifies over/under/accurate, and recommends weight changes →
  `outcome_reviews`.
- **Adaptive Scoring Proposals + Versioned Profiles** — recommendations become a
  `scoring_change_proposals` record (never auto-applied). Approving versions a new active
  `scoring_profiles` entry; the Plan Scoring Engine uses the active profile's weights and records
  `profileVersion` on every score. Rejecting preserves the current profile.
- **Configurable Policy Engine** — `policy_rules` (scoped: service/capability/environment) +
  `policy_change_proposals` + `policy_profiles`; `resolvePolicy` overlays config on the code default,
  but **hardcoded safety blocks** (`file_delete`, `physical_action`) always override.
- **RBAC** — roles (owner/operator/viewer/agent), permissions, users; `hasPermission` gates approvals;
  denials are audit-logged.
- **Audit Log** — every governance action (approvals, scoring/policy changes, denials) writes an
  `audit_logs` entry with actor/role/before/after/reason.
- **Governance Dashboard** — /governance, /outcome-reviews, /scoring-profiles,
  /scoring-change-proposals (approve/reject/changes), /policy-rules, /policy-profiles,
  /policy-change-proposals, /rbac, /audit-logs.

Verification:
- Full workspace build + typecheck **passing** (14 packages).
- **Governance demo PASS** ("Review the last strategic decision and improve future scoring"): the
  **real** compiled pipeline produced a strategic decision (selected score 0.90, profile v1) → the
  governance pipeline created an outcome review (**predicted 0.90 vs actual 0.82 → overestimated**) →
  recommended `evidenceAvailability +0.1, speed -0.1` → a scoring-change proposal → **RBAC owner**
  approval (viewer denied) created **scoring profile v2** (evidenceAvailability 1.0→1.1), wrote an
  **audit log**, and a subsequent strategic run **used profile v2**. A hardcoded `file_delete` block
  overrode a permissive config rule (decision blocked, source hardcoded_block).
- All 27 Phase 8 acceptance criteria met. No Docker; independent Dokploy deploy intact; no silent
  scoring/policy changes; hardcoded safety blocks enforced; RBAC protects approvals; every governance
  change audited; deterministic fallback retained for tests.

## Phase 9 — Operational Learning & Memory Intelligence — COMPLETE (2026-06-26)
The kernel now learns from its whole operational history — reliability trends, recurring patterns, compressed memory, and evidence-backed recommendations.

Delivered:
- **Historical Learning Engine** (`shared/learning`) — aggregates 15 collections into reliability
  scores (services/agents/capabilities/plan & repair types, with trend + confidence), recurring
  patterns, compressed memory, recommendations, and prompt performance. Pure + testable.
- **Reliability scores** (`reliability_scores` + `reliability_snapshots`) per target over time.
- **Pattern Miner** (`operational_patterns`) — success patterns (best plan type, validation prevents
  incidents, best repair type) and failure/weak-point patterns (domain unreachability, plans
  overestimate, low-reliability services).
- **Memory Compression** (`memory_summaries` + `compressed_contexts`) — future agents load compressed
  context first instead of raw history.
- **Adaptive Recommendation Engine** (`system_recommendations`) — evidence-backed (source pattern +
  support + related records), RBAC-gated, audit-logged; approving converts to a task.
- **Prompt Learning** (`prompt_performance`) — validity/fallback/cost per prompt version; recommends
  prompt improvement (e.g. high fallback → configure a provider).
- **Learning Dashboard** — /learning, /learning-runs, /reliability, /patterns, /memory-summaries,
  /compressed-contexts, /system-recommendations (approve/reject/changes/convert), /prompt-performance.

Verification:
- Full workspace build + typecheck **passing** (14 packages).
- **Learning demo PASS** ("Analyze system history and recommend improvements") against a clearly-marked
  **synthetic** history (`synthetic: true`): the **real** compiled pipeline analyzed 38 records →
  scored **7 targets** (browser-testing-agent 0.73, legacy-service 0.20 weak) → mined **3 success +
  3 weak-point patterns** ("safe_plan performs best", "validation prevents incidents", "domain_fix
  resolves failures"; "domain unreachability is the most common failure", "plans overestimate",
  "legacy-service reliability low") → built **2 memory summaries + 1 compressed context** →
  **4 evidence-backed recommendations** → prompt performance flagged 100% fallback. **RBAC owner**
  approved a recommendation (viewer denied) → it **converted to a task** with an **audit log**.
- All 29 Phase 9 acceptance criteria met. No Docker; independent Dokploy deploy intact; nothing
  adaptive applied silently; recommendations evidence-backed + approval-gated + audited; synthetic
  test data kept separate; deterministic fallback retained.

## Phase 10 — Continuous Learning & Autonomous Improvement — COMPLETE (2026-06-26)
The kernel now closes the loop: approved recommendations become governed improvement workflows that run through real engines, and impact is measured afterward.

Delivered:
- **Learning Scheduler** (`learning_schedules` + `learning_triggers`) — continuous-ready cadence +
  trigger types; a default daily schedule is seeded; a manual "trigger now" dispatches a learning run.
- **Improvement Workflow Engine** (`improvement_workflows`) — structured, step-by-step, engine-routed
  workflows with status lifecycle.
- **Recommendation Conversion Router** (`shared/workflows`) — maps each recommendation type to the
  correct workflow type + structured steps + target engine (skill library, builder/validation,
  scoring/policy proposals, strategic planner, monitor, browser-testing).
- **Workflow Executor** (orchestrator) — runs workflows through existing engines, evidence-backed
  (create_skill / add_validation / improve_scoring implemented; others routed + flagged).
- **Impact Assessment Engine** (`impact_assessments`) — before/after metrics; honest "no measurable
  improvement yet" when nothing changed.
- **Continuous Memory Maintenance** (`memory_maintenance_runs`) — keeps the latest summary per scope,
  deprecates the rest, tracks token budget saved.
- **Dashboard** — /improvement-workflows(+:id), /impact-assessments, /memory-maintenance,
  /learning/schedules (+ trigger), /learning/triggers; recommendations link to their workflow; task
  detail shows the workflow report.

Verification:
- Full workspace build + typecheck **passing** (14 packages).
- **Improvement-workflow demo PASS** ("Turn the latest learning recommendation into an improvement
  workflow and measure the result") using the Phase 9 recommendation "Add pre-deployment domain/DNS
  verification": the **real** pipeline converted it into a **create_skill workflow** → executed all
  4 steps with **evidence** → **created the reusable skill** → produced an **impact assessment**
  ("skill library expanded; no reliability change measurable yet"; skillCount 1→2) → ran **memory
  maintenance** (3 reviewed, 1 deprecated, ~400 tokens saved) → marked the recommendation `converted →
  workflow` → task report `mode=improvement`. A separate **waiting** recommendation correctly **gated**
  (workflow + task `awaiting_approval`).
- All 26 Phase 10 acceptance criteria met. No Docker; independent Dokploy deploy intact; nothing
  executes without approval; workflows structured + evidence-backed; impact never faked; hardcoded
  safety blocks intact; deterministic fallback retained.

## Phase 11 — Control-Room Experience (Premium Glass UI) — COMPLETE (2026-06-27)
A design-only phase: the dashboard becomes a premium, mobile-first, glass/visionOS-inspired
Autonomous OS Control Room. **No API route, business logic, or service contract was changed** —
only `services/dashboard-web` presentation (design system, layout, components, the priority pages).

Delivered:
- **Original glass design system** (`globals.css`, rewritten) — dark layered background with ambient
  gradient blobs + SVG noise grain, translucent glass surfaces, soft blur, depth shadows, a token
  scale (bg/glass/text/border/status colors, radius, spacing, blur, motion), CSS-only motion
  (`fadeInUp`/`shimmer`/`pulse`), `prefers-reduced-motion` support. Legacy class names are preserved,
  so all ~60 pages inherit the premium look automatically. No new runtime dependencies.
- **New shell** — glass grouped `Sidebar` (8 nav groups, active states via `usePathname`); mobile
  `MobileTopBar` (brand + quick "+ Task") and `MobileTabBar` (bottom nav, safe-area aware); `layout.tsx`
  rewired to the responsive app-shell with a `viewport` export. Desktop = sidebar + main; tablet/mobile
  = top bar + stacked cards + bottom tab bar.
- **Reusable UI** (`components/ui.tsx`) — `PageHeader` (breadcrumbs/subtitle/actions), `MetricCard`,
  `EmptyState`, `StatusPill` + `statusTone` mapper.
- **Priority pages redesigned** — /overview (command bar, metric grid, live activity, pending
  approvals, latest task, reliability bars), /tasks (command bar + status metrics + task cards),
  /tasks/:id (mission control: vertical live timeline cards + report + reasoning/learning/improvement
  reports + evidence), /agents + /services (cards with capability/type chips), /approvals (risk-toned
  cards with clear approve/reject), /capabilities (lifecycle ladder grouped proposed→generated→active→
  failed); light header polish on /learning + /governance. Dense tables wrapped for horizontal scroll
  on mobile; `CreateTaskForm` gained a `command` variant; `LiveEvents`/`LiveTaskTimeline` restyled to
  the live-dot + vertical-timeline language.

Verification:
- Dashboard **typecheck passing** (`tsc --noEmit`) and **`next build` compiled successfully** — all
  ~60 routes build with zero errors/warnings.
- Responsive review: desktop sidebar + main, mobile top/bottom chrome with stacked cards, big tap
  targets, readable typography, accessible status contrast.
- **No backend touched** — `lib/gateway.ts`, all `app/actions.ts` server actions, the `/api/stream`
  SSE proxy, and every service contract are unchanged; admin/internal tokens remain server-side only.
  (Old `components/Nav.tsx` is now unused/dead but left in place; harmless.)

## Phase 11.5 — UI QA, Cleanup & Product Polish — COMPLETE (2026-06-27)
A polish-only pass to make the Phase 11 redesign feel finished, consistent, and production-ready.
**Dashboard-web + docs only — no backend, shared package, or API contract changed.**

Cleaned / fixed:
- **Dead code removed** — deleted the now-unused `components/Nav.tsx` (no imports remained) and the
  dead `.menu-btn` rule. `components/Placeholder.tsx` was checked and **kept** (used by 5 pages).
  `.layout` is kept intentionally (harmless combined selector alongside `.app-shell`).
- **Responsive tables (global, zero per-page edits)** — on ≤1024px a wide `<table>` now scrolls
  horizontally inside its card (`.card{overflow-x:auto}` + `table{white-space:nowrap;min-width:max-content}`)
  so no page overflows the viewport. The ~38 read-only dense data tables stay as scrollable hybrids
  (appropriate for operator pages); the 5 table pages with inline action buttons were converted to
  card layouts: **infrastructure, expansion-proposals, deployment/checklists, learning/schedules,
  incidents/:id** (key/value `<dl>`s, chips, full-width touch-friendly buttons, flex inputs that no
  longer use fixed pixel widths).
- **Safe-area + mobile chrome** — `.main` and `.mobile-topbar` now pad with `env(safe-area-inset-*)`
  so content clears the notch and the bottom tab bar on iPhone-sized screens.
- **Loading / error / 404 states (cover all 64 routes)** — added `app/loading.tsx` (skeleton),
  `app/error.tsx` (client error boundary with "Try again" + back, shows ref/digest), and
  `app/not-found.tsx`. Secondary pages’ plain `.empty` blocks upgraded to `EmptyState` on the
  converted pages.
- **Accessibility basics** — global `:focus-visible` outline (keyboard users), `-webkit-tap-highlight-color`
  reset, status colors keep contrast, `prefers-reduced-motion` still disables all animation, buttons/inputs
  carry real labels/placeholders.
- **Consistency** — converted pages use `PageHeader`/`MetricCard`/`StatusPill`/`EmptyState`; verified every
  `btn-primary` is paired with the base `.btn`; button intent normalized (ok / ghost / err).

Verification:
- Dashboard **typecheck clean** (`tsc --noEmit`, no output) and **`next build` ✓ Compiled successfully**
  (16.7s; static pages generated; exit 0).
- **Scope confirmed by git** — only `services/dashboard-web/` and `docs/` changed; backend, shared, and
  contracts untouched.
- **What remains (intentional):** the ~38 read-only data tables (audit-logs, llm-traces, patterns,
  reliability, monitor, validations, evaluations, etc.) remain responsive scrollable tables rather than
  cards — the right UX for dense operator data; they already inherit the design system. A global command
  palette and per-page skeletons beyond the route-level loader are deferred to a later phase.

## Phase 12 — Security, Auth & Production Hardening — COMPLETE (2026-06-27)
Makes the live system safe to expose on a public domain. The kernel can now answer: who is using it,
what they may do, which actions are sensitive, whether secrets/APIs are protected, and how to recover.
All changes are additive — **no existing service contract was broken** (authorized owner calls behave
exactly as before; new behavior is 401/403/429 for unauthorized/abusive callers).

Delivered (shared):
- **Security schemas + collections** — `security_checks`, `security_events` (+ `SecurityRiskLevel`).
- **Security engine** (`shared/security`, pure + tested) — `auditEnvironment()` (env/secret/token/session
  audit with placeholder detection + risk aggregation + recommendations), `RateLimiter` (fixed-window,
  in-memory, Redis-replaceable), `buildSecurityCheck/buildSecurityEvent`.
- **RBAC extended** — new permissions (create_task, decide_approval, confirm_infrastructure,
  run_learning_trigger, github_delivery, manage_security); `DASHBOARD_ACTION_PERMISSIONS`,
  `canRolePerformAction()`, `SAFE_MODE_BLOCKED_ACTIONS`/`isActionBlockedInSafeMode()`. owner=all,
  operator=operational (no governance/scoring/policy), viewer=read-only, agent=none.
- **Safe mode** — `AUTONOMY_SAFE_MODE` env default mirrored into `system_settings` and toggled at runtime.

Delivered (gateway-api + service-kit):
- **Role propagation** — `x-factory-role` honored only with a valid admin token (trusted dashboard);
  otherwise the caller is `agent`. Drives accurate audit + RBAC.
- **RBAC + safe-mode enforcement** on every mutation endpoint (`enforce()`), each denial writing an
  **audit log + security event**; governance decisions keep their existing permission checks.
- **Rate limiting** on task creation, approvals, and activation (429 + security event on abuse).
- **Security endpoints** — `GET/POST /v1/security/safe-mode`, `POST /v1/security/check`,
  `GET /v1/security/checks|events|env|rate-limits`, `POST /v1/security/event`.
- **Production-safe errors** — `setErrorHandler` in the gateway and in `service-kit` (every service):
  no stack traces to clients, request id in the envelope, `x-request-id` on every response.
- **Service-to-service** — verified all `/.factory/*` and every custom service route require the
  internal token; only `GET /health` is public.

Delivered (dashboard-web):
- **Authentication** — `/login` page, scrypt-hashed (or dev-plain) credentials, HMAC-signed **HttpOnly,
  Secure, SameSite=Lax** session cookie via `DASHBOARD_SESSION_SECRET`, server-side verification,
  logout, and `middleware.ts` that redirects unauthenticated users to login. Admin/internal tokens never
  reach the browser. Local dev seeds owner/operator/viewer demo logins when no users are configured.
- **RBAC enforcement in actions** — every sensitive server action calls `requirePermission()` (role +
  safe-mode); denials report a security event (mirrored to audit) and redirect to `/denied`. The gateway
  enforces the same rules as defense in depth.
- **Security dashboard** — `/security` (auth status, current user/role, safe mode, env posture, latest
  check, recent events, run-check), `/security/events`, `/security/env`, `/security/rate-limits`,
  `/security/safe-mode`; plus a global **safe-mode banner**, a user/role chip + sign-out in the shell.
- **Backup/recovery runbook** (`docs/backup-and-recovery.md`) — Mongo/S3 backup, secret rotation,
  Dokploy rollback/restart, incident response, and the emergency safe-mode switch; `scripts/hash-password.mjs`.

Verification:
- **Full workspace build/typecheck passing** — all 14 packages (`shared`, `service-kit`, 12 services)
  compile; dashboard `next build` ✓ Compiled successfully.
- **Security-engine smoke PASS (22/22):** weak env → fail/critical + recommendations; strong env →
  pass/low; owner allowed / viewer denied / operator partial / agent none; safe mode blocks mutations
  but not the security controls; rate limiter allows N then 429s; session HMAC round-trips and rejects
  tampering. This exercises the exact compiled logic behind the demo flow (log in → role visible →
  viewer denied → audit+security event → owner runs check → env/token/session/safe-mode verified →
  result stored → safe mode blocks mutations → owner disables → mutations resume).
- Scope: only `shared/`, `packages/service-kit/`, `services/gateway-api/`, `services/dashboard-web/`,
  `scripts/`, and `docs/` changed. No Docker; independent Dokploy deploy intact; Phase 11 UI polish
  preserved. Known non-blocking note: Next 16 deprecates the `middleware` filename in favor of `proxy`
  (still compiles and runs as “Proxy (Middleware)”).

## Phase 13 — Real Intelligence Integration — COMPLETE (2026-06-27)
Moves the kernel from deterministic/fallback intelligence into real, governed, schema-validated AI
reasoning, plus four new independently-deployable services. Security from Phase 12 is fully preserved:
no API key reaches the browser, raw LLM text never mutates state, and safe mode / RBAC / policy / approvals
still gate everything.

Delivered (shared):
- **Provider governance + budget** — `LLM_ALLOWED_PROVIDERS`, `LLM_MAX_COST_PER_TASK_USD`,
  `LLM_MAX_TOKENS_PER_TASK`, `LLM_DAILY_COST_LIMIT_USD`, `LLM_SAFE_MODE_FALLBACK`; router gained a
  `forceFallback` path; `buildLlmCostRecord`/`buildBudgetEvent`; `llm_cost_records` + `llm_budget_events`.
- **Versioned agent-prompt registry** — 13 reasoning contracts (role, allowed/forbidden actions, output
  schema, evidence/approval/policy requirements, fallback behavior, status, version, changelog) for all
  12 agents; exposed at `/v1/llm/prompts`.
- **Intelligence engines** (`shared/intelligence`) — `runResearch`, `runArchitecturePlan`, `runReview`,
  `runQa`, `runReport`: each reasons through the LLM router into a **Zod-validated** structure with a
  deterministic fallback, returns the trace for cost/evidence accounting. Schemas + collections for
  research (`research_runs/sources/reports`), `review_reports`, `qa_reports`, `intelligence_reports`;
  4 new evidence types.
- **Real LLM calls** wired in the reasoning-critical agents (orchestrator capability+strategy, architect
  improvement plans, reviewer, qa, report, research); other specialist agents stay deterministic with the
  router available (“where appropriate”).

Delivered (4 new independently-deployable services):
- **internet-research-service** (port 4115, research.simorx.com) — read-only research, cited
  reliability-scored sources, no mutations, browsing intent logged.
- **reviewer-agent** (4106) — structured review; allowed to FAIL; never rubber-stamps.
- **qa-agent** (4107) — acceptance criteria vs evidence; no pass without evidence.
- **report-agent** (4114) — executive intelligence reports grounded only in supplied data.
  (Service IDs/ports/subdomains were already reserved in `constants`; the spec's suggested 4117–4120 were
  superseded by the canonical reserved ports so peer-discovery stays consistent.)

Delivered (orchestrator + gateway + dashboard):
- **Research pipeline** (orchestrator) — research → architect improvement plan → reviewer → QA →
  executive report, evidence-linked, with per-task **budget enforcement** (exceed → deterministic
  fallback + `llm_budget_events` + event) and **safe-mode fallback** (`LLM_SAFE_MODE_FALLBACK`).
- **Gateway reads** (RBAC-guarded) — `/v1/llm/costs` (today/all-time, by provider/agent, fallback count,
  most-expensive task), `/v1/llm/prompts`, `/v1/llm/budget-events`, `/v1/research(+/:id)`, `/v1/reviews`,
  `/v1/qa`, `/v1/reports`.
- **Dashboard** — `/llm` (provider/fallback/cost), `/llm/costs`, `/llm/prompts`, `/research(+/:id)`,
  `/reviews`, `/qa`, `/reports`; task detail shows AI reasoning mode, cost, research sources, review/QA
  verdicts and the executive report; new Intelligence nav group.

Verification:
- **Full typecheck passing** — `shared`, `service-kit`, and all **16 services** (12 prior + 4 new) compile;
  dashboard `next build` ✓ Compiled successfully with the new `/llm*`, `/research*`, `/reviews`, `/qa`,
  `/reports` routes.
- **Intelligence demo smoke PASS (16/16)** against the exact scenario ("Research current best practices for
  securing autonomous agent dashboards and create an improvement plan"): research returned 4 cited sources +
  5 findings (fallback mode clearly marked, cost recorded) → architect produced a 5-step plan grounded in
  the findings → reviewer **passed** a good plan and **FAILED** a thin one with required fixes → QA derived
  criteria and **failed when given no evidence** → report-agent produced a 5-section executive report →
  budget/governance parsed and budget event built → 13 versioned prompts with schema + allowed/forbidden.
- **No security regression** — keys never reach the browser; LLM output is schema-validated (raw text never
  mutates state); safe mode + `LLM_SAFE_MODE_FALLBACK` force deterministic reasoning; RBAC/policy/approval
  intact. No Docker; each new service is an independent Dokploy app.

## Phase 14 — Real Product Experience & Onboarding Layer — COMPLETE (2026-06-27)
Makes the live kernel understandable and usable for a real operator **without any fake data, demo mode,
or simulation**. Dashboard-only — no backend, contract, schema or service change; every page reads real
gateway/registry state. Phase 12 security and Phase 13 governed AI are untouched.

Delivered (all `services/dashboard-web` only):
- **Onboarding** — `/start` (what the kernel is + live counts + 3-step path), `/start/overview`
  (plain-language: how tasks flow, safe vs approval-gated, evidence, AI real/fallback, learning/governance,
  safe mode), `/start/actions`, `/start/system-map`.
- **Real action templates** (`lib/templates.ts`, `TemplateCard`) — 6 templates mapped to actually-implemented
  pipelines (security check, research+plan, analyze history, improvement workflow, reliability, intel report),
  each with title/real-prompt/what/services/outputs/risk/approval/where-to-see. Running one posts the real
  prompt to the **RBAC-gated `createTaskAction`** → a real task. No demo sessions.
- **System map** (`/system-map`, `SystemMap`) — the documented service catalog (id/role/domain/port/boundary)
  merged with **live service-registry data** (registered? last seen? version? capabilities?); honest
  “not registered” where the registry has nothing (no fabrication).
- **Human-readable task lifecycle** — task detail now opens with an “In plain language” card (your goal /
  what the kernel did / status / what to do next) derived from the real task mode + status.
- **Next Best Action** panel on the overview — derived only from real state (safe mode, pending approvals,
  open incidents, missing security check, no learning run, stale recommendations, fallback provider); each
  suggestion links to the right page or runs a real template. No fake suggestions.
- **Proof & Evidence Explorer** (`/evidence/explorer`) — real evidence grouped by type with plain-language
  “what it proves / generated by”, linked to its task/service/capability.
- **Reports Center** (`/reports/center`) — aggregates real intelligence/research/review/QA/security/learning
  reports with summary, source task, copy-as-markdown and print (`ReportTools`).
- **Product Readiness** (`/readiness`) — 10 checks from real state (services registered, security check,
  safe mode, session secret, LLM provider, GitHub mode, S3, latest learning run, latest report, open critical
  incidents) with pass/warn/fail/unknown and a “view” link each.
- **Language cleanup + empty-state guidance** — sidebar adds a “Get started” group and humanizes labels
  (LLM Traces → AI Reasoning Traces, Evidence → Proof & Evidence, Repairs → Repair Actions, Gaps → Missing
  Capabilities, Activations → Live Activation, LLM Overview → Real Intelligence); empty states point to the
  real next action.

Verification:
- Dashboard **typecheck clean** and **`next build` ✓ Compiled successfully** with the new `/start*`,
  `/system-map`, `/readiness`, `/evidence/explorer`, `/reports/center` routes.
- **No fake data / no demo mode** — every page sources real gateway/registry reads; templates create real
  tasks; the catalog's static part is documented configuration (roles/domains/ports), dynamic status comes
  only from the live registry.
- Security/RBAC/safe-mode intact (template runs go through the RBAC + safe-mode-gated action; no secrets to
  the browser). Premium/responsive design preserved. No Docker; Dokploy independence intact.
- Scope: only `services/dashboard-web/` and `docs/` changed for Phase 14.

## Phase 15 — Safe Real Operations inside Overview — COMPLETE (2026-06-27)
`/overview` becomes the single guided **Mission Control** for real, safety-gated operations — no new
mission-control page, no fake data, no fake Dokploy success, no silent self-modification.

Delivered (shared):
- **Operation plan model** (`operation_plans`) — goal, operationType, full target (project/env/app/service/
  domain/port/rootDir/env), riskLevel, protectedCore, requiredApprovals, 13-step timeline, verification +
  rollback plans, manual instructions, snapshotId/targetId, evidenceIds, status (draft→…→completed/failed/
  rolled_back/cancelled), nextAction. **Dokploy target registry** (`dokploy_targets`) and **deployment
  snapshots** (`deployment_snapshots`).
- **Classification engine** — `classifyOperation` (health_check_only=low, new_app=medium, existing_app_*
  =high, protected_core_update=critical); a mutation targeting one of the **9 protected core services**
  (dashboard-web, gateway-api, orchestrator-agent, service-registry, event-bus-service, monitor-agent,
  memory-agent, documentation-service, devops-agent) **escalates to critical + owner-only approval**.
  `buildOperationPlan/buildSnapshot/buildManualInstructions/buildVerification/RollbackPlan/setStep/nextActionFor`.

Delivered (gateway — RBAC + safe-mode enforced):
- `POST /v1/operations` (create plan; read-only, not safe-mode-blocked), `/target` (confirm real Dokploy
  target → manual_user_confirmed, re-classify, capture target, manual steps), `/decision` (approve/reject/
  changes — **protected/critical require OWNER**, **safe mode blocks approval of mutations**, snapshot on
  existing-app approval), `/executed` (“I did this in Dokploy” → **real HTTP `/health` + registry
  verification** → evidence → completed/failed). `GET /v1/operations(+/active+/:id)`, `/v1/dokploy-targets`.
  Without a Dokploy API token the gateway emits **exact manual instructions** and verifies for real — never
  faking success.

Delivered (overview = Mission Control, dashboard-only):
- **Main command panel** (`OperationCommand`) — goal + operation-type selector (with live risk) + quick
  starts → creates a real operation plan.
- **Active operation console** (`OperationConsole`) on `/overview` showing, for the live operation: goal/
  status/risk/protected-core/elapsed/target; the **13-step visual timeline**; the contextual card for the
  current state — **target confirmation** form, **risk & approval** card (operation/risk/protected/approvals/
  policy/safe-mode + approve/reject/changes, owner-gated for protected), **manual Dokploy steps + “I did
  this”**, **verification result** (domain/health/registry/manifest), **evidence summary**, and an
  always-visible **Next action**. Live events preview stays on the page. Other pages remain as archives.

Verification:
- **All 16 services + shared + service-kit typecheck clean**; dashboard `next build` ✓ Compiled.
- **Operations-engine smoke PASS (16/16):** risk rules; protected-core escalation to critical/owner-only;
  health-check-of-core stays low/read-only; 13-step timeline + verification/rollback plans; snapshot env
  fingerprint; manual Dokploy steps; step transitions.
- No fake data, no fake Dokploy targets (manual_user_confirmed or real API only), no fake success
  (verification is a real HTTP/registry check). Protected core can't be modified without owner approval;
  safe mode blocks operation approval; RBAC (Phase 12) and governed AI (Phase 13) intact. No Docker;
  Dokploy independence intact. Scope: `shared/`, `services/gateway-api/`, `services/dashboard-web/`, `docs/`.

## Phase 16 — Real Dokploy API Execution — COMPLETE (2026-06-27)
Replaces the manual-only Dokploy path with **real API execution where safe and supported**, keeping the
exact manual steps as fallback. Nothing is faked; protected core services are never auto-modified; safe
mode, RBAC, policy, snapshots, rollback and verification all still gate execution.

Delivered (shared):
- **Dokploy API client** (`shared/dokploy`) — server-side only (token never reaches the browser); safe
  `DokployResult`-returning wrappers: `testConnection/listProjects/listEnvironments/listApplications/
  getApplication/createApplication/updateApplicationConfig/setEnvironmentVariables/deployApplication/
  restartApplication/getDeploymentStatus/getApplicationLogs`. `isDokployConfigured`, `dokployConfigFromEnv`,
  `dokployClientFromEnv`, `redactSummary` (strips secret-looking fields). 404 → `unsupported` (manual path).
- **Execution-step model** — `OperationStep` gains `executionMode (api|manual|verification|skipped|pending)`,
  `apiMethod`, `requestSummary`, `responseSummary`, `error`, `retryable`; new step status `manual_required`.
- **Executor decision** — `AUTO_EXECUTABLE_TYPES` = health_check_only/new_app/existing_app_repair/
  existing_app_restart; `canAutoExecute()` returns true only for those AND **non-protected-core** targets
  (protected-core mutations escalate to `protected_core_update` and are excluded).

Delivered (gateway — env: `DOKPLOY_BASE_URL/API_TOKEN/PROJECT_ID/ENVIRONMENT_ID`):
- `GET /v1/dokploy/status` (testConnection + last sync + api-target count; token never returned),
  `POST /v1/dokploy/sync` (reads real projects/apps → upserts `dokploy_targets` source=`dokploy_api`;
  defensive parse; on API failure returns the error and keeps manual confirmation — **never fabricates**).
- **API executor in the approve path**: when `canAutoExecute && configured && !safeMode`, runs the
  supported Dokploy calls, records per-step api/manual/error + redacted summaries, writes an audit log +
  evidence, then runs **real `/health` + registry verification** → completed/failed. Unsupported/failed
  steps become `manual_required` (exact manual steps) — no fake success. `POST /v1/operations/:id/retry`
  (re-run API, rate-limited) and `POST /v1/operations/:id/rollback` (**owner-only**, snapshot-based, API
  redeploy if supported else manual rollback steps + audit + evidence).
- Existing-app operations still snapshot before mutation; rate-limited execution endpoints.

Delivered (overview — still the only control surface):
- Operation console shows a **Dokploy API bar** (connected/error/not-configured, synced target count, last
  sync, Sync button), the **target source** (dokploy_api vs manual_user_confirmed), **per-step API/manual
  badge + `apiMethod → response` / error**, and **Retry API** (when a step is retryable) / **Rollback
  (owner)** (when failed + snapshot) buttons.

Verification:
- All services + shared typecheck; dashboard `next build` ✓.
- **Dokploy smoke PASS (12/12)** for both scenarios: (A) new **non-core** app is auto-executable, config
  parses, **secrets are redacted** from summaries, and with no env it cleanly falls back to manual (no fake
  success); (B) `existing_app_update` on `gateway-api` → `protected_core_update`/critical/owner-only and
  **never auto-executes**; restart of a protected core is non-auto, restart of a non-core service is.
- No fake Dokploy success or targets; no secrets exposed/logged; protected core can't be silently modified;
  safe mode blocks API mutations; no delete/destructive ops. No Docker; Dokploy independence intact. Scope:
  `shared/`, `services/gateway-api/`, `services/dashboard-web/`, `docs/`.

## Phase 17 — Real Dokploy Calibration & Production Validation — COMPLETE (2026-06-27)
A calibration/validation phase (no new features): validate the Dokploy client against a real instance,
discover actual response shapes, calibrate the sync parser, and map the real AOS services — **honestly**,
with no fake data/targets/success and with protected-core safety unchanged.

Delivered (shared):
- **API diagnostics** (`buildDiagnostics`) — READ-ONLY probing of real endpoints (project.all → project.one
  → application.one using discovered ids); mutation endpoints (deploy/restart/saveEnvironment/logs) are
  recorded as **not-probed** (no side effects). Each record stores `responseShape` (**keys only**),
  `sanitizedSample` (**secrets redacted**), status, supported, error. New `dokploy_api_diagnostics` schema +
  collection. `responseShapeOf`, `sanitizedSample`.
- **Calibrated sync parser** (`parseDokployTargets`) — tolerates multiple Dokploy shapes (project→applications
  inline, or project→environments[]→applications[]); fills projectName/env/appName/serviceId/domain/port/
  rootDir/status; **missing fields stay empty (UI shows "unknown") — never invented**.
- **AOS mapping** (`mapAosServices`) — matches the 17 catalog service ids to synced `dokploy_api` targets by
  serviceId/appName/domain; unmatched are honestly marked **`not_found_in_dokploy_sync`** (no fabrication).

Delivered (gateway):
- `POST/GET /v1/dokploy/diagnostics` (read-only probes; owner/operator; rate-limited; sanitized; **409 with
  a clear message when not configured**), `GET /v1/dokploy/mapping` (real catalog ↔ synced targets), and the
  sync endpoint now uses the calibrated shared parser (still **502 with a clear error** when unreachable —
  manual confirmation always remains).

Delivered (overview — still the single control surface):
- **Dokploy calibration panel** on `/overview`: connection (connected/error/not-configured), last sync +
  synced-target count, **supported vs unsupported/not-probed** read endpoints, and the **AOS↔Dokploy mapping**
  (per-service mapped ✓ / not_found_in_dokploy_sync), with Run-diagnostics + Sync buttons. The operation
  console continues to show target source, per-step API/manual, response summaries, retry/rollback.

Validation of the required flows:
- **A (connection/sync)** and the **diagnostics** path are real and surface clearly on overview; when no
  Dokploy is configured they report "not configured" and keep the manual path — nothing faked.
- **B (health_check_only)** is the real low-risk flow verified end-to-end: it performs a real HTTP `/health`
  + registry check and stores evidence — no Dokploy API required.
- **C (protected core)**: `gateway-api`/`dashboard-web` mutations classify **critical / owner-only**, are
  **never auto-executed**, snapshot+rollback are required, and safe mode blocks them (unchanged from Phase 15/16).
- **D (non-core low/medium)**: executes via real API when supported, else `manual_required` — verified, with
  evidence (Phase 16 path, now fed by calibrated targets).

Verification:
- All services + shared typecheck; dashboard `next build` ✓.
- **Calibration smoke PASS (10/10):** shape = keys only (no secrets); sanitizedSample/redactSummary strip
  secrets; parser handles two real-ish shapes and leaves missing fields empty (no fabrication); empty data →
  zero targets; AOS mapping marks matched vs `not_found_in_dokploy_sync`; protected-core update stays
  critical and non-auto-executable.
- No fake targets/success; secrets redacted from diagnostics + summaries; no delete/destructive ops; protected
  core never auto-modified; safe mode blocks API mutation. No Docker; Dokploy independence intact. Scope:
  `shared/`, `services/gateway-api/`, `services/dashboard-web/`, `docs/`.

> Operator note: the diagnostic endpoint paths follow Dokploy's documented `/api/*` surface. Run
> `POST /v1/dokploy/diagnostics` against your live instance; if a `responseShape` differs, the calibrated
> parser already tolerates the common variants, and any remaining field simply shows "unknown" until the
> path/parser is adjusted — it never blocks or fakes.

## Phase 18 — Realtime Voice Operator Agent — COMPLETE (2026-06-27)
A persistent, floating voice + text operator copilot across the whole dashboard, deeply integrated with
the kernel: it explains state, asks before any change, executes only through existing safe gates, verifies,
remembers preferences, and learns from mistakes. **Raw voice/LLM output never mutates state** — every
action is routed through a deterministic tool-mediation layer under RBAC / safe mode / approvals.

Delivered (shared):
- **Voice schemas + collections** — voice_sessions/messages/tool_calls/permissions/memories/learning_events
  (no secrets stored). New `voice-operator-agent` service id/port(4121)/subdomain(voice.simorx.com).
- **Deterministic tool-mediation router** (`routeUtterance`) — maps an utterance → ONE safe `ToolProposal`
  (toolName/category/risk/requiresApproval/ownerOnly/blocked/confirm/explanation). Encodes the **10
  anti-mistake guardrails**: analyze-history→learning, security→security, research→intelligence (never
  Dokploy); only infra ops use operation plans; protected-core mutations are blocked from voice (owner +
  visible UI); delete/destructive blocked; governance stays approval-gated. `deriveVoiceLearning` extracts
  session summary + mistake-avoidance memories.

Delivered (new service voice-operator-agent, 4121):
- Independently deployable; standard factory endpoints. Tasks: `realtime_token` (mints a SHORT-LIVED OpenAI
  realtime ephemeral client secret server-side — the API key never reaches the browser; "not configured"
  when absent), `derive_learning` (stores learning event + memories), default status + guardrails.

Delivered (gateway voice endpoints — RBAC + safe mode enforced, audited):
- `GET /v1/voice/context` (compact, secret-free packet: role, safe mode, active operation, approvals,
  incidents, latest events/report, guardrails), `POST /v1/voice/session`, `POST /v1/voice/message` (routes
  → tool proposal; **read tools execute immediately, low-risk → light confirm, medium/high → permission,
  protected/destructive → blocked+audited**), `POST /v1/voice/tool/:id/confirm` (executes low-risk through
  existing safe paths: health-check operation, learning/security/research tasks, Dokploy sync/diagnostics —
  with evidence + audit), `POST /v1/voice/permission/:id/decision` (gated → creates an operation plan to
  approve on Overview; **never voice-only critical execution; owner-only enforced**), reads + realtime-token
  proxy.

Delivered (dashboard):
- **VoiceOperatorDock** — floating on every authenticated page; **text + the browser's native STT/TTS** (no
  provider needed), modes (collapsed/listening/thinking/waiting_for_permission/executing/reporting/error),
  transcript, action proposal with risk + Confirm/Approve/Cancel, mute/interrupt/push-to-talk, compact +
  expanded, mobile-safe. Realtime WebRTC activates when a provider is configured. `/voice`, `/voice/settings`
  (provider status + learned preferences), `/voice/sessions`. Overview stays the main control surface.

Verification:
- **All 18 services + shared typecheck**; dashboard `next build` ✓ (incl. `/voice*`).
- **Voice-router smoke PASS (15/15):** A explain→read; B "check gateway health"→low/light-confirm, target
  resolved; C "restart the gateway"→blocked/owner-only/critical + offers health check, while non-core
  restart→operation-plan/approval (not blocked); D analyze→learning, security→security, research→intelligence
  (never Dokploy); safe mode blocks mutations; delete/scoring blocked; 10 guardrails; learning extraction
  derives a mistake-avoidance memory.
- No secrets exposed (token server-side; realtime returns only an ephemeral client secret); no raw output
  mutates state; protected core not voice-executable; safe mode blocks mutations; voice approvals/tool calls
  audited + evidenced. Text fallback always works. No Docker; Dokploy independence intact. Scope: `shared/`,
  `services/gateway-api/`, `services/voice-operator-agent/` (new), `services/dashboard-web/`, `deployment/`, `docs/`.

## Phase 19 — Full Realtime Voice WebRTC Integration — COMPLETE (2026-07-03)
Wires the floating VoiceOperatorDock to a full low-latency realtime WebRTC voice session while keeping
every Phase 18 guarantee: **the deterministic tool-mediation layer is untouched, raw voice/LLM output
never mutates state, no API key ever reaches the browser, and text + browser-STT/TTS fallbacks remain.**

Delivered (client — dashboard-web):
- **`useRealtimeVoiceSession` hook** (`src/hooks/useRealtimeVoiceSession.ts`): session via `/v1/voice/session`,
  ephemeral grant via `/v1/voice/realtime-token`, RTCPeerConnection + mic + `oai-events` data channel, SDP
  offer→answer via the gateway proxy, remote-audio playback (autoplay-block detection + unlock), transcript +
  response events, errors, clean disconnect. States: idle/connecting/connected/listening/speaking/thinking/
  interrupted/permission_needed/fallback/error. Mic-level meter (local AnalyserNode), session clock with a
  hard cap (maxSessionSeconds from the server; auto-disconnect at the limit).
- **The kill-switch invariant:** the realtime session is configured with `turn_detection.create_response=false`
  — the model can NEVER answer or act on its own. Every final user transcript is routed through the
  deterministic `/v1/voice/message`; only the kernel-produced reply text is spoken back (`response.create`
  with verbatim instructions). Session instructions additionally forbid claiming actions.
- **Barge-in / interrupt**: `response.cancel` + `output_audio_buffer.clear` on the Interrupt button and
  automatically when the user starts speaking during playback.
- **Push-to-talk default** (mic track disabled until held) + **always-listening** with a visible “👂 always
  listening” chip and green live dot; one-tap return to PTT; "end voice" always visible.
- **Dock upgrade** (kept minimal/premium): realtime/browser/text tier badge, connecting state, mic-blocked +
  fallback badges with a one-line reason, live input-level bar, ghost partial transcripts (user + assistant),
  session timer, reconnect button, enable-audio chip when autoplay is blocked. Existing browser STT/TTS and
  text flows unchanged; proposal/permission UI unchanged.

Delivered (server):
- **voice-operator-agent**: token mint now tries the GA endpoint (`POST /v1/realtime/client_secrets`,
  verified against current OpenAI docs) with beta fallback (`POST /v1/realtime/sessions`); returns
  clientSecret/model/expiresAt/apiVariant/maxSessionSeconds (VOICE_SESSION_MAX_SECONDS, or
  VOICE_MAX_SESSION_MINUTES compat, capped at 3600, default 600). Never logs the secret.
- **Gateway `POST /v1/voice/realtime/sdp`** (guarded + rate-limited): forwards the browser's SDP offer with
  the EPHEMERAL secret (bounds-checked; gateway never holds the provider key) to GA `/v1/realtime/calls`,
  beta `/v1/realtime?model=` fallback; returns the answer; publishes sanitized
  `voice.realtime.connected/disconnected` events — never SDP contents or secrets. 401 → clean
  "ephemeral token expired" error the client turns into a reconnect prompt.
- **Gateway `POST /v1/voice/session/:id/end`**: sanitized/clamped session metadata — durationSec,
  connectionMode (text/browser_speech/realtime), interactionMode (PTT default), transcriptSummary(≤800),
  errorSummary, fallbackReason, costUsd, toolCallCount; publishes `voice.session.ended`.
- `/v1/voice/message` now records true modality (voice|text). VoiceSession schema extended with the
  Phase 19 fields (all defaulted → backward compatible; enums reject junk).

Validation of the required scenarios:
- **A (provider missing):** grant returns ok:false → dock shows fallback badge + reason, browser voice +
  text keep working, no crash; “what is happening?” routes read-only. ✓
- **B (realtime connected):** “What is happening now?” → read tool, no approval, no action; reply spoken +
  transcribed. ✓ (router smoke)
- **C (low-risk via voice):** “Check gateway health.” → low risk + light confirm → existing safe operation
  path with evidence; result spoken and shown. ✓
- **D (protected core):** “Restart the gateway.” → blocked/critical/owner-only, explains risk, offers the
  health check; never executes. ✓
- **E (interrupt):** button + voice barge-in cancel playback and return to listening. ✓

Verification:
- All 18 services + shared + service-kit typecheck; dashboard `next build` ✓.
- **Phase 19 smoke PASS (11/11)** (`scripts/phase19-voice-realtime-smoke.mjs`): scenarios B/C/D via the
  deterministic router (identical routing for voice transcripts), destructive-intent still blocked, safe mode
  still blocks voice mutations, legacy session records parse with safe defaults, junk connectionMode rejected,
  all 10 Phase 18 guardrails intact.
- No raw realtime tool execution (create_response=false + deterministic mediation); no browser access to the
  real API key (ephemeral only; SDP proxied); no silent actions (confirm/approve UI in dock, Overview remains
  the control surface); protected core not voice-executable; text + browser fallbacks intact. No Docker;
  independent Dokploy deployment intact. Scope: `shared/`, `services/voice-operator-agent/`,
  `services/gateway-api/`, `services/dashboard-web/`, `scripts/`, `docs/`.

> Operator note: realtime activates only when VOICE_PROVIDER/VOICE_MODEL/OPENAI_API_KEY are set on the
> voice-operator-agent. The GA/beta endpoint fallback is calibration-tolerant: if OpenAI shifts shapes again,
> the mint/SDP steps report a clean provider error and the dock falls back — nothing fakes success.

## Phase 19.5 — Voice Operator Production Fix & Real Command State Machine — COMPLETE (2026-07-03)
Blocking quality fix. The dock was treating interim speech-recognition events as separate commands
("Check / Check the / Check the system"), submitting word-by-word and repeating identical answers.
Phase 19.5 replaces the command pipeline with a strict gated state machine. No new features.

Root cause & fix:
- Interim/partial recognition results could reach the command path, and nothing deduped commands or
  suppressed the system hearing its own TTS. Now every candidate utterance — realtime transcript,
  browser STT final, typed text — passes through ONE `UtteranceGate`
  (`dashboard-web/src/lib/utteranceGate.ts`, pure + unit-tested):
  **final-only** (interim = display-only), **minCommandChars=4**, **dedupeWindowMs=5000** (normalized:
  lowercase, punctuation-stripped), **single in-flight lock** (no queueing — interrupt or wait; busy hint),
  **echo suppression** (mic input ignored while assistant speaks + 400ms after; typed input exempt),
  **assistant-reply dedupe** (identical reply within window is never appended/spoken twice).

Delivered (client):
- Dock state machine: idle → listening → capturing → finalizing → thinking → proposal_ready /
  waiting_confirmation → executing → speaking → interrupted / error.
- Browser STT rebuilt: `interimResults` shown as ghost text only; final chunks buffered; **end-of-utterance
  gate** submits ONCE after 800ms silence; recognition stopped during TTS (`utterance.onstart/onend` drive
  `gate.markSpeaking`); one utterance per tap.
- Realtime priority: when WebRTC is active, browser STT is aborted and can never run in parallel; the
  shared gate's dedupe also blocks cross-source double-submits of the same text.
- Realtime echo guard in `useRealtimeVoiceSession`: transcripts finalizing during/≤400ms after assistant
  audio are dropped (barge-in unaffected — speech_started cancels playback first).
- Interrupt: cancels realtime response + TTS, clears partials and pending buffers, resets the gate,
  returns to listening/idle. No trailing repeated text.

Delivered (server — protection against client bugs):
- `/v1/voice/message` ignores commands with normalized length < 4 and drops an identical normalized
  command in the same session within 5s (`duplicate:true` — no new tool call, no reply, client removes echo).
  `normalizeUtterance` lives in `shared/voice` (client keeps a byte-identical copy; parity smoke-tested).
- Operator-language replies composed from LIVE state (no capability spam):
  “what is happening?” → active operation + status + next step, approvals, incidents, safe mode;
  approvals/evidence/report reads get short specific replies; fallback = `I heard: “…”. I can’t map that…`.
- New `run_system_status_check` (“check the system”) — read-only aggregation: registry service count,
  tasks (total/active), pending approvals, open incidents, safe mode, Dokploy sync; evidence stored;
  proposal text: “I’ll check live services, approvals, incidents, Dokploy sync, and readiness. This is
  read-only. Confirm?”

Verification:
- **Phase 19.5 smoke PASS (23/23)** (`scripts/phase19-5-voice-pipeline-smoke.mjs`, compiles the real gate,
  fake clock): Scenario A (interims never submit; one submit with final text), B (echo rejected during +
  after speaking; typed exempt), C (duplicate suppressed in window, allowed after; normalization defeats
  punctuation/case), D (interrupt resets cleanly), E (system check = short, specific, read-only, one
  confirm), in-flight lock, assistant dedupe, cross-source double-submit blocked, client/server
  normalization parity, fallback echoes heard text, no capability-list spam, protected core + safe mode +
  destructive blocks + 10 guardrails unchanged.
- Phase 19 smoke still 11/11; all 18 services + shared + service-kit typecheck; dashboard `next build` ✓.
- Text fallback, browser fallback, WebRTC path all preserved; tool mediation untouched. No Docker.
  Scope: `shared/src/voice/`, `services/gateway-api/`, `services/dashboard-web/`, `scripts/`, `docs/`.

## Phase X — Autonomous Operator Runtime (Jarvis-Class Control Layer) — COMPLETE (2026-07-03)
Major architecture correction: the operator is no longer a chat widget. The **runtime is the product**;
voice/text is only its human interface. The system now has a live tool registry, a real agent loop
(plan → tool → observe → approve → continue → evidence → memory), a coding agent, and a serious
Operator Console — with every Phase 18/19/19.5 safety layer intact.

Delivered (shared `operator/` module — deterministic core):
- **7 operator collections** (tools/tool_runs/tool_permissions/runtime_sessions/runtime_steps/
  runtime_memories/capability_index) with full zod schemas.
- **Live tool registry: 45 tools, 15 categories**, each with input/output schema, risk, approval/owner
  flags, serviceOwner, endpoint, timeout, rollback/evidence flags — and a REAL execution path
  (gateway_internal / kernel_task / operation_plan / code_operator_agent / manual_required). Tools whose
  integration is missing register `available:false` + reason — no fake tools, availability is computed
  from real context (Dokploy token, code workspace, GitHub token).
- **Deterministic goal planner**: whole-system check (read-only 6-step plan), service mutations
  (risk-classify → safe-operation engine; protected core named in narration), code improvements
  (inspect → search → dry-run propose → approval-gated edit → typecheck), service creation
  (pipeline task → gated deploy → health verify), intelligence pipelines, clarify fallback that echoes
  the heard goal (no capability spam).
- **Dynamic capability answer** built from the live registry — grouped by category, risk + approval
  labels, examples, owner-approval note; changes with configuration (proven in smoke).
- **Failure classifier** → cause + next action + optional mistake-avoidance memory (not_configured /
  unreachable / RBAC / safe mode / protected core).

Delivered (gateway — the agent loop, `/v1/operator/*`):
- `GET tools`, `GET capabilities`, `POST command` (hygiene: min-length + 5s dedupe; capability questions
  answered from the registry; goals → runtime session), `GET sessions|sessions/active|sessions/:id`
  (steps + tool runs + permissions), `POST permissions/:id/decision`, `GET memories`.
- **Runtime loop**: executes read/low tools immediately through 45 bound executors (all real code paths:
  health/system checks with evidence, registry/events/incidents/approvals/operations reads, Dokploy
  status/sync/diagnostics, kernel-task pipelines, operation-plan creation blocked for protected core +
  safe mode, code tools proxied to code-operator-agent); pauses at `waiting_approval` with an
  OperatorToolPermission for every gated tool (approval/owner/medium+/kernel_task/operation_plan);
  approval executes the step and resumes the loop; rejection skips and continues; failures are
  classified, narrated (cause + next action), and write mistake memories; completion writes a workflow
  memory + report summary. Steps stream as `operator.*` events (live narration in events feed).
- Unavailable tools become `manual_required` observations with the reason — sessions never fake success.

Delivered (new service `code-operator-agent`, 4122, code.simorx.com):
- Workspace-scoped code tools: inspect_repo, search_code, propose_code_change (dry-run preview),
  edit_code, run_typecheck, build_package, run_smoke_tests (scripts/*.mjs only), create_git_branch,
  commit_changes, create_pr (GitHub REST). Safety: confined to CODE_WORKSPACE_ROOT (traversal rejected;
  not_configured without it), edits refused on the default branch (isolated work branch mandatory),
  protected-core paths (gateway/dashboard/shared) flagged on preview and refused on edit without the
  gateway's owner-approval flag, no blind writes (target text must match). Every run = agent_run + event.

Delivered (dashboard):
- **OperatorConsole** replaces the voice dock (old component deleted): serious command surface — no
  emojis, text controls (Talk/Stop/Audio/Min), live runtime session panel (GOAL, plan with per-step
  status glyphs + observations, NEXT action, evidence count), inline approval card with risk/owner
  badges, live tool-registry browser for “what can you do?”, ghost transcripts, mic level, session
  timer, realtime/browser/text tier badges. Voice and text are equal inputs into the SAME runtime
  (`/v1/operator/command`); the Phase 19.5 UtteranceGate + realtime WebRTC hook are reused unchanged.
  Narration policy: speaks session start, approval requests, completion/failure — not every event.
- **Overview shows the active runtime session** (goal, status, step progress, next action).

Verification:
- **Phase X smoke PASS (28/28)** (`scripts/phasex-operator-runtime-smoke.mjs`): registry integrity (45
  real tools, schema-valid, no fake availability, mutating tools gated, owner-critical present),
  Scenario A (dynamic grouped capability answer from live registry, config-sensitive), B (read-only
  6-step system plan ending in evidence), C (code plan with dry-run/approval split), D (service creation
  → gated deploy → verify), E (protected core: named, owner-gated, never direct-executed; Phase 18 voice
  block intact), failure classification incl. mistake memories, clarify path without capability spam.
- Regressions still green: Phase 19.5 pipeline 23/23, Phase 19 realtime 11/11.
- All 19 services + shared + service-kit typecheck; dashboard `next build` ✓. No Docker; independent
  Dokploy deployment intact (new app doc `deployment/dokploy/code-operator-agent.md`).
  Scope: `shared/src/{constants,operator}/`, `services/gateway-api/`, `services/code-operator-agent/`
  (new), `services/dashboard-web/`, `deployment/`, `scripts/`, `docs/`.

> Operator note: point `CODE_WORKSPACE_ROOT` at a dedicated git checkout (volume) to activate the code
> tools; without it they report not_configured and the runtime plans around them. The registry answer to
> “what can you do?” will reflect that automatically.

## Phase Y — Autonomous Staging Workspace & Service Evolution Runtime — COMPLETE (2026-07-03)
The self-development engine. The operator can now clone or create services in disposable isolated
workspaces, make deep multi-file changes there WITHOUT per-step approval (isolation + limits are the
boundary), build/run/probe/verify them for real, and only then propose migration — with the old version
always preserved and every live-touching step approval-gated (owner for protected core).

Delivered (shared `workspace/` module — deterministic core):
- **8 workspace collections** with full zod schemas (workspaces/runs/services/changes/tests/artifacts/
  migrations/rollbacks); 7 modes; 15 statuses.
- **Verification matrix (15+ checks)**: structure, dependency resolution, typecheck, build/next-build,
  optional unit/smoke, temp-port boot, /health, /.factory/manifest (+capabilities), /.factory/status,
  token-guarded /.factory/task, env example, docs, Dokploy spec — per service kind (fastify vs web);
  `matrixGreen` names exactly what is missing.
- **New-service allocator + generator**: deterministic serviceId/package/port(next free)/subdomain, and
  the COMPLETE file set for a real factory service (service-kit wiring, manifest, task handler, env,
  README, Dokploy spec incl. staged domain). No fake services — proven by smoke (see below).
- **Migration builder**: type (create_new_service / deploy_staged_service / non-negotiable
  open_pr_only for protected core), risk (core ⇒ critical + ownerOnly), changed files, staged app spec
  (`<svc>-staging.simorx.com`), rollback plan that PRESERVES the old version (snapshot branch + commit).
- **Resource limits** (env-configurable): WORKSPACE_MAX_ITERATIONS=10, MAX_MINUTES=45,
  MAX_FILES_CHANGED=80, REQUIRE_APPROVAL_BEFORE_MIGRATION, ALLOW_AUTOFIX/NEW_SERVICE/EVOLUTION flags.
  On limit: pause + summarize + ask to continue. Never silently forever, never per-edit nagging.

Delivered (code-operator-agent — execution layer, `ws_*` actions):
- **Isolated copy**: rsync service → `.workspaces/<ws>/<svc>-evolved/` (source untouched, source commit
  recorded), donor node_modules link, tsconfig depth fix (reversed on promote).
- **Generator**: writes the complete allocated service into the workspace + records the proposal
  (port/subdomain/capabilities) in workspace_services.
- **Deep multi-file edit batches** (`ws_edit`): create/find-replace across many files in one call, no
  blind writes, change accounting against MAX_FILES_CHANGED.
- **Temp-run + probes** (`ws_run`): free ephemeral port, env-injected boot of `dist/index.js` with
  registry/event-bus DISABLED (no live registration), readiness wait, real probes of /health,
  /.factory/manifest(+capabilities), /.factory/status, and the internal-token guard on /.factory/task;
  logs captured as artifacts; process always stopped.
- **`ws_verify`** runs the whole matrix and stores every result; **`ws_iterate`** is the check-fix loop:
  repeats verification, auto-fixes the deterministic classes (missing docs/env/dokploy-spec for copies),
  stops with a precise cause when targeted edits are needed, respects iteration/time limits. Never
  fabricates green.
- **`ws_migration_plan`** (GREEN required), **`ws_promote`** (only after upstream approval: snapshot
  branch `ws/<id>-promote`, rsync into `services/<target>`, commit — default branch untouched, old
  version preserved; protected core additionally requires the owner flag), **`ws_rollback`** (restore
  default branch; promote branch kept for inspection). `.workspaces/` is gitignored — disposable.

Delivered (operator runtime integration):
- **15 workspace tools** in the live registry. Inside-workspace tools (create/copy/generate/inspect/
  edit/typecheck/build/tests/start/verify/migration-plan) are low-risk, NO per-step approval; live-
  touching tools (approve_migration / deploy_staged_workspace / promote_workspace / rollback_workspace)
  are always gated. All unavailable-with-reason without CODE_WORKSPACE_ROOT.
- **Planner upgrades**: “improve the operator console UI” → workspace copy of dashboard-web → typecheck
  → Next build → migration plan; “create a <name> service …” → generate → full verify → migration plan
  (with a concrete allocated name); “repair <service> …” → repair-mode workspace + check-fix loop;
  “upgrade gateway-api …” → workspace evolution with CRITICAL/owner migration named up front and no
  direct execute/promote step in the plan.
- **Cross-step context**: workspaceId/migrationId flow through the session automatically
  (create → inspect → verify → migrate chains without re-typing ids). Console + Overview show progress
  via the runtime session panel (steps, observations, matrix summary, approval cards).

Verification:
- **Phase Y smoke PASS (31/31)** (`scripts/phasey-workspace-smoke.mjs`) — including the flagship real
  test: a service is GENERATED from the template into `.workspaces/` and **typechecked with real tsc**;
  plus matrix logic, limits + env overrides, allocation collision rules, migration typing (core ⇒
  critical/owner/open_pr_only), rollback preservation language, 15-tool gating, and all four planner
  scenarios (A evolve console, B new service, C repair, D protected core).
- Regressions green: Phase X 28/28 (two planner assertions updated to the superior Phase Y plans),
  Phase 19.5 23/23, Phase 19 11/11. All 19 services + shared + service-kit typecheck; dashboard
  `next build` ✓. No Docker; independent Dokploy deployment intact.
  Scope: `shared/src/{constants,workspace,operator}/`, `services/code-operator-agent/`,
  `services/gateway-api/`, `scripts/`, `.gitignore`, `docs/`.

> Operator note: staged Dokploy deployment remains a REAL two-step: the migration plan carries the
> staged app spec (`<svc>-staging` + subdomain), `deploy_staged_workspace` creates the gated operation
> plan, and where the Dokploy API can't perform a step the operation console shows exact manual steps
> and verifies /health after your confirmation — nothing fakes a deploy.

## Phase Z — Live Runtime Fix Loop & Operator Command Center — COMPLETE (2026-07-03)
Root-caused and fixed the failed scenario (“status-inspector” workspace booted but failed
manifest/status verification, then the session ended as completed), and upgraded the whole runtime +
console into a live, honest, self-repairing system.

Root causes fixed:
- **service-kit guarded metadata behind the internal token** → unauthenticated temp-port probes got 401
  on /.factory/manifest, /status, /capabilities. Fix (system-wide, benefits all 19 services + every
  generated service): manifest/status/capabilities are PUBLIC metadata like /health; /.factory/task and
  /.factory/logs stay token-guarded. Probes now cover ALL SIX endpoints, token-aware: logs must answer
  WITH the internal token AND reject without; task must reject without.
- **Sessions could finish “completed” with failed critical steps.** New shared semantics
  (`stopSessionOnFailure`): failures in code/test/service/deploy/repair/git/dokploy categories STOP the
  session as FAILED with cause + next action; only observational categories (read/report/memory/…)
  continue. Reaching the end of a plan with failed steps now reports failure — never “Done”.

Delivered (runtime):
- **Live execution state machine** on workspaces: planning → generating → editing → building → booting →
  probing → fixing → verifying → ready_for_migration → waiting_approval → completed/failed. Every phase
  transition, check result and fix iteration is STREAMED as workspace.* events (publisher wired through
  the code-operator-agent entrypoint) — no silent background work.
- **Real auto-fix loop** (`ws_iterate`, now the default step in all workspace plans): verify → diagnose
  failing checks → deterministic repairs (regenerate missing docs/env/dokploy spec; rebuild + reboot to
  re-probe endpoint failures) → re-verify; repeats until GREEN or limits; stops with the precise failing
  checks when targeted edits are needed; identical-failure detection prevents useless spinning. Failed
  verification can never produce a migration plan (GREEN gate unchanged).
- **Verification matrix extended** (+capabilities, +logs_endpoint — both required for services);
  limits extended (WORKSPACE_MAX_LOG_BYTES=8000, WORKSPACE_MAX_COST_USD reported when a source exists).
- Session detail endpoint now returns **live workspace telemetry** (phase, iteration counter, files
  changed, temp port, per-check matrix, log tail) pulled from the code-operator-agent.

Delivered (Operator Console — command center):
- **Live phase strip** with pulsing active state across the 12-phase machine; **fix-loop counter**
  (iteration x/max), changed-files x/max, temp port, READY FOR MIGRATION badge, last error line.
- **Verification matrix grid** (per-check ✓/✕ chips with detail tooltips), **live logs preview**
  (monospace tail), animated active plan step (pulse + sweep), RESULT line on finish, faster polling
  (2.5s) while active. Clean/dense/premium — no emoji, no chatbot filler.

Verification:
- **Phase Z smoke PASS (18/18)** (`scripts/phasez-live-runtime-smoke.mjs`) — flagship: BOOTS A REAL
  factory service in-process (the exact surface generated services use) and runs the exact ws_run probe
  suite: all six endpoints GREEN including the two that previously failed (manifest/status), plus logs
  guarded-and-readable and task guarded. Also: matrix requires capabilities/logs, states include the new
  phases, limits configurable, stop-on-failure semantics, and the required scenario plan
  (generate → AUTO-FIX loop → migration plan).
- Regressions green: Phase Y 31/31, Phase X 28/28, 19.5 23/23, 19 11/11 (three assertions updated to the
  auto-fix-loop plans). All 19 services + shared + service-kit typecheck; dashboard `next build` ✓.
  No Docker; Dokploy independence intact. Scope: `packages/service-kit/`, `shared/src/{workspace,operator}/`,
  `services/code-operator-agent/`, `services/gateway-api/`, `services/dashboard-web/`, `scripts/`, `docs/`.

> Re-run of the required scenario (“Create a new status-inspector service…”) now flows: workspace
> created → service generated → auto-fix loop (typecheck, build, boot, ALL six probes — repaired until
> GREEN) → migration plan → staged-deploy approval — with the console showing phases, matrix, loop
> counter and logs the whole time, and a FAILED (never “completed”) outcome if limits stop it first.

## Phase AA — Scope, Identity & Multi-Tenant Governance Foundation — COMPLETE (2026-07-05)
The platform gate before personal connectors, finance data, citizen workflows or multi-user operation.
Invariant implemented end-to-end: **Global software evolution. Scoped human data.**

Delivered (shared — one reusable module, no scattered checks):
- **Scope model** (`schemas/scope.ts`): global/tenant/user/project/case + visibility; optional ScopeFields
  merged into existing kernel schemas (tasks, events, evidence, voice sessions/messages, operator
  sessions/tool-runs, workspaces/runs) with zero writer breakage; strict RequiredScope for new collections.
- **16 identity/governance schemas + collections** (`schemas/identity.ts`): tenants, user_profiles,
  tenant_memberships, user_roles, scope_policies, consent_grants, connector_accounts, connector_sync_runs,
  scoped_memories, user_goals, user_constraints, daily_briefings, weekly_strategy_reviews,
  opportunity_reports, public_service_cases, access_decisions.
- **Central authorization engine** (`scope/index.ts`): `canAccess()` → allowed/denied/approval_required
  with audit/evidence flags. Rules: user data only for the user (OWNER needs explicit audited approval for
  anyone else's); tenant data member-only; citizen cases strictest (citizen-own + assigned case roles in
  tenant); cross-tenant analytics approval-gated; connector data needs ACTIVE consent; agents never
  approve; viewers never mutate; **missing scope fails closed**. Plus `stampScope` (fail-closed writes),
  `scopeFilter` (leak-proof queries), `buildAccessDecision`, Esan seed builders,
  `legacyRoleToAuthContext` (backward-compatible login mapping), `classifyGoalScope`.

Delivered (gateway):
- Standard **AuthContext** resolution for every identity route; idempotent startup seeding
  (tenant_esan_personal / user_esan / owner membership) + identity.seeded event.
- **Scoped routes**: /v1/me/{context,profile,goals,memories,briefings,opportunities}, /v1/tenants/current,
  /v1/consents (+revoke), /v1/connectors (+sync), /v1/access-decisions — all through `enforceScoped`:
  denials → access_decisions + security event + 403 with decision payload.
- **Consent foundation**: grants forced read_only this phase; revocation blocks accounts and future syncs
  (`blocked_no_consent` runs + connector.sync.blocked events); accounts store metadata + consent reference
  only — never secrets. Unbuilt provider syncs return honest `not_configured`.
- **Scope-aware operator**: every command is classified (global_kernel / personal / tenant / case);
  sessions are stamped with scope/tenant/visibility/createdBy; personal goals plan ONLY user-scoped tools
  (`get_my_context` → `generate_daily_briefing`) with missing connectors reported not_configured — kernel
  data is never treated as personal data; global evolution (workspace engine) reads no private user data.
- Migration `scripts/migrate-scope-foundation.mjs`: idempotent, non-destructive; kernel → explicit global,
  Esan-scoped voice/operator history, ambiguity stays global with migrationNote.

Delivered (dashboard):
- Console shows **ACTOR / SCOPE / MODE / TENANT** for every runtime session.
- Five identity pages under a new sidebar group: /settings/identity (actor, roles, profile, goals,
  private memories), /settings/tenants (memberships/roles), /settings/consents, /settings/connectors,
  /settings/access-log (live decision stream). Dense, serious, no fake data — empty states are honest.

Verification:
- **Phase AA smoke PASS (39/39)** (`scripts/phaseaa-scope-smoke.mjs`) covering all seven scenarios:
  A Esan bootstrap + legacy-login mapping + global governance; B private user isolation (incl. owner
  approval-gate) + decision records; C tenant isolation + owner foreign-tenant approval + cross-tenant
  analytics gating; fail-closed suite (missing scope/userId, stampScope throw, leak-proof scopeFilter,
  viewer/agent restrictions); D consent lifecycle (active allows, revoked/missing block, account requires
  grant); E/F operator scope classification (personal vs global kernel vs tenant, honest sources);
  G public-service safety (citizen/citizen, cross-tenant staff, owner approval-gate, fail-closed).
- All regressions green: Z 18/18, Y 31/31, X 28/28, 19.5 23/23, 19 11/11. All 19 services + shared +
  service-kit typecheck; dashboard `next build` ✓ incl. the five /settings routes. No Docker; Dokploy
  independence intact; no destructive migration; no connector writes.
  Scope: `shared/src/{schemas,scope,operator,constants}/`, `services/gateway-api/`,
  `services/dashboard-web/`, `scripts/`, `docs/`.

## Phase AB — Personal Reality Baseline & Jarvis Intelligence Layer — COMPLETE (2026-07-05)
The first real Jarvis layer on the Phase AA rails: AOS now deeply understands the authorized user —
scoped, honest, evidence-backed, and proactive. Esan is the first full user; nothing mixes with the
global kernel.

Delivered (shared `personal/` module — deterministic, 26/26 smoke):
- **14 reality collections** with strict scope + source + confidence + freshness + recordKind separation
  (facts/preferences/goals/inferences/recommendations/decisions/actions). Goals remain in user_goals
  (one source of truth). No secrets, no invented data anywhere.
- **Personal Intelligence Graph**: user→goals→projects→assets→systems→risks→opportunities with
  serves_goal/advances_goal/leverages_asset/threatens edges, missing-data detection (with exact ingest
  instructions + not_configured connectors) and freshness tracking.
- **Next-best-action engine**: deterministic ranking — high-severity risks first, pending approvals as
  unblockers, goal-linked opportunity value (impact×2 − effort − risk + linkage), then data-gap actions;
  every action has a SPECIFIC reason with scores/sources/confidence.
- **Daily briefing + weekly strategy engines**: top-3 priorities, risks, income/growth/AOS actions,
  approvals, missing data; honest sources (`calendar: not_configured`, `email: not_configured`,
  `tasks: limited_to_aos_tasks`); empty data asks for data instead of inventing a schedule. Weekly:
  goals vs completed/missed vs new opportunities → ranked plan, aosShouldBuild, esanShouldDo, approvals.
- **Opportunity engine**: value scoring + ranking with source/confidence; zero fake market claims — the
  research provider is reported not_configured until it exists.
- **Resume intelligence**: verified facts (connector-sourced only) vs user claims vs confidence-labeled
  inferences vs suggestions; positioning derives ONLY from provided data; never invents credentials.

Delivered (gateway):
- **Ingestion framework**: `POST /v1/me/reality/ingest` (profile/resume/project/system/asset/goal/
  income_idea/risk/learning_track/career_record/tech_watch) — every run returns source, records
  created/updated, confidence, missing data, next suggested connector, and stores evidence.
- Reality reads (profile+graph, goals, projects+systems+assets, ranked opportunities, risks,
  next-actions, briefings, strategies, resume) — all through Phase AA `enforceScoped`, strictly
  userId-filtered. `POST /v1/me/reality/review` runs the engines over live scoped data and persists runs.
- **Decision learning**: accept/reject/complete on a next-best-action updates it AND writes scoped
  memory (rejections → mistake_avoidance) — AOS learns what Esan accepts, rejects, completes.
- **7 new operator tools** (build_reality_baseline, get_next_best_actions, run_full_daily_briefing,
  run_weekly_strategy, analyze_resume, find_opportunities, propose_aos_build) + planner routes for all
  six scenario commands. “What should AOS build next for me?” analyzes in USER scope and routes actual
  building to GLOBAL workspace evolution with approval — scopes never mix. (Also fixed a planner regex
  where “b*ui*ld” matched the UI branch — word boundaries added.)

Delivered (dashboard):
- **/me Personal Command Center**: top priority, opportunity radar, risk radar, missing-data count,
  ranked next-best-actions with Accept/Decline/Done (decisions train scoped memory), latest briefing,
  data-freshness line, run-briefing button — plus /me/{reality,goals,projects,systems,opportunities,
  briefing,strategy,resume} and a “Personal” sidebar group. Every empty state says exactly what is
  missing and how to add it. No fake cards.

Verification:
- **Phase AB smoke PASS (26/26)**: scenarios A–F at engine level + honesty guarantees (not_configured
  sources, no invented schedule, no invented credentials, claims≠facts, labeled inferences,
  deterministic rankings, specific reasons) + AA isolation regression inside the same run.
- All prior suites green: AA 39/39, Z 18/18, Y 31/31, X 28/28, 19.5 23/23, 19 11/11. All 19 services +
  shared + service-kit typecheck; dashboard `next build` ✓ (9 new /me routes). No connector writes; no
  Docker; Dokploy independence intact. Scope: `shared/src/{personal,operator,constants}/`,
  `services/gateway-api/`, `services/dashboard-web/`, `scripts/`, `docs/`.

## Phase AC+ — AOS Living AI Government Interface / Jarvis Command Universe — COMPLETE (2026-07-05)
The product leap: AOS's home is no longer a technical dashboard — it is a one-page living operating
surface for life, work, money, growth and the AI kernel, with Jarvis as the connective intelligence
layer. Old overview preserved as the Engine Room (/operations).

Delivered (shared — the universe contract):
- **3 new scoped domain structures**: personal_health_states (9 body metrics, level 0–10, concern
  flags), personal_life_items (family/home/relationship/household/personal · responsibility/concern/
  event/task · importance/dueDate), personal_finance_items (income/expense/bill/installment/obligation/
  investment/purchase/sale · amount+currency+cadence+dueDate — user-entered amounts ONLY).
- **`buildUniverseZones`** — pure, deterministic 9-zone contract (health/daily/life/finance/ventures/
  growth/opportunities/systems/presence), each zone with status (live/attention/setup_needed/
  not_configured), headline, items, metrics, an ACTIONABLE setup hint, a contextual Jarvis command and a
  deep-link. `aggregateFinance` (monthly-normalized in/out/net/obligations/upcoming, hasAmounts guard) and
  `latestHealthByMetric` (body-map contract). A zone is LIVE only with real scoped data — proven by smoke.
- 3 new ingestion kinds (health_state / life_item / finance_item; learning_track handler added too),
  each with honest next-connector guidance.

Delivered (gateway):
- **`GET /v1/me/universe`** — ONE scope-enforced aggregation for the whole home: personal graph + health
  + life + finance + learning + next actions + latest briefing + connectors + kernel state (services,
  incidents, approvals, safe mode, active operation, active operator goal, recent events).

Delivered (dashboard — the Command Universe):
- **New `/` home**: hero strip (actor, domains-live count, attention count, safe mode, consents,
  governance line) + 9-zone living grid + kernel live-events pulse. Health zone renders an **abstract
  SVG body map** — nodes breathe only for real reported metrics; unreported nodes are dormant
  setup-ready points with per-node guidance. Finance shows monthly net/obligations/upcoming from real
  entries; every empty state is premium and says exactly how to activate (ingest kind / consent path).
  Zone cards: status glow border, hover lift, metric chips, tone-dotted items with deep links.
- **Jarvis bridge**: every zone has a ◈ Jarvis button dispatching `aos:jarvis` with a contextual command
  — the Operator Console opens and executes it (same gated runtime; nothing bypassed). The console now
  also shows **deep-link chips** (personal center / engine room / approvals / evidence) so Jarvis takes
  you to the relevant view, alongside the existing ACTOR/SCOPE/MODE line, live workspace telemetry,
  narration and approval cards.
- Old Mission Control → **/operations “Engine Room”** unchanged in capability; sidebar gains a Universe
  group (Command Universe / Engine Room).

Verification:
- **Phase AC+ smoke PASS (18/18)**: 9-zone completeness; empty world ⇒ personal zones NEVER live while
  the kernel zone stays live; actionable setup hints; presence not_configured without connectors;
  finance math (monthly normalization, obligations, upcoming ordering, no fake totals without amounts);
  health latest-per-metric + concern⇒attention; life high-importance⇒attention; determinism; new
  ingestion kinds + honest connector guidance.
- All prior suites green: AB 26/26, AA 39/39, Z 18/18, Y 31/31, X 28/28, 19.5 23/23, 19 11/11. All 19
  services + shared + service-kit typecheck; dashboard `next build` ✓ (new /, /operations). No fake
  data; no connector writes; no Docker; Dokploy independence intact.
  Scope: `shared/src/{personal,constants}/`, `services/gateway-api/`, `services/dashboard-web/`,
  `scripts/`, `docs/`.

### Undocumented commit (backfilled)
`abf2c3d` "Update jarvis answer" (2026-07-06) shipped between Phase AC+ and Phase AD without a phase-log
or decision-log entry — it refined the `/me` intake summary text, added `capture_personal_goal` /
`capture_reality_profile` operator wiring, and console updates. No schema or contract break. Recorded here
so the phase-log invariant ("every completed phase must be documented") holds before Phase AD begins. See
decision-log D-093.

## Phase AD — Jarvis Intelligence Core & Living Command Home — COMPLETE (2026-07-09)
The central problem this phase targets: AOS had a mature, real kernel underneath, but the operator/Jarvis
conversational layer was a pure English regex command router with **zero LLM usage** and **no composed
natural-language reply** — verified by reading `services/gateway-api/src/index.ts` `/v1/operator/command`
and `shared/src/operator/index.ts` `planForGoal` / `shared/src/scope/index.ts` `classifyGoalScope` directly.
Persian input (the owner's primary language) almost never matched the English-only regexes and fell
straight to a generic `"I heard: ..."` dead end. The home page (`/v1/me/universe`, Phase AC+) was already a
real, honest 9-zone contract and did **not** need to be rebuilt — only extended.

Delivered (shared — new `shared/src/jarvis/` module, pure + testable):
- **Bilingual (EN/FA) intent classifier** — `classifyIntent()` via the existing LLM router
  (`generateStructured`, schema-validated) with `classifyIntentFallback()` as the deterministic safety net
  (ordered keyword patterns, both English and Persian, used when no LLM key is configured or output fails
  validation). 12 fixed categories (`system_status`, `personal_life_planning`, `business_project`,
  `finance_ops`, `schedule_calendar`, `email_communication`, `research_opportunities`, `code_development`,
  `approvals_tasks`, `memory_profile_capture`, `meta_self_assessment`, `general_conversation`) +
  `detectLanguage()`.
- **Context packet builder** — `buildJarvisContextPacket()` is a PURE ranking/compaction function: the
  gateway fetches real facts (nothing is invented or fetched inside `shared/jarvis`), tags each with a
  `known | not_configured | stale | unknown` status and a relevance weight; the packet caps to the top 14 —
  compact and ranked, never a full dump.
- **Response composer** — `composeJarvisResponse()` answers strictly from the packet's compact summary and
  never invents anything outside it; `composeJarvisResponseFallback()` is the deterministic bilingual
  fallback, quoting the packet directly instead of a generic reply.
- **Mode router** — `decideJarvisMode()`: `system_status` / `meta_self_assessment` / `general_conversation`
  answer directly from the context packet (no fake tool session); everything else still goes through the
  **existing, unchanged** deterministic `planForGoal`/approval pipeline — Jarvis's LLM layer only ever
  decides how to talk about real state/results, never what tool executes. Raw LLM output still never
  executes a tool (Phase X invariant preserved).
- **Honest self-knowledge** — `AOS_SELF_KNOWLEDGE`, an explicitly-maintained (not model-guessed) record of
  current gaps and the highest-leverage next step, grounding meta questions like "why isn't this real
  Jarvis" / "what's next for AOS" in verifiable fact instead of invented confidence.
- **2 new versioned prompt contracts** (`gateway-api:jarvis_intent`, `gateway-api:jarvis_response`) in the
  Phase 13 prompt registry, visible at `/v1/llm/prompts`.
- **`jarvis_turns` collection** — every Jarvis exchange (intent, mode, reply, fallback flag) is persisted as
  interaction memory and emits `jarvis.turn.answered`.

Delivered (gateway-api):
- `/v1/operator/command` rewritten: classify intent → `direct_answer` (compose from a freshly gathered,
  real context packet — reuses the existing `execSystemCheck()` for system-status facts, so evidence
  writing is unchanged) or `route_to_planner` (existing session/approval pipeline unchanged, now with a
  **composed grounded reply** wrapped around the real result instead of the mechanical narration string).
  The old dead-end `clarify` response is replaced with an honest composed answer grounded in real context
  (e.g. finance/calendar/email categories with no connector yet now say so specifically, instead of "I
  heard: ...").
- `shared/src/operator/index.ts` `planForGoal` gained one new bilingual branch: generic "create/make a
  task that ..." / "یک تسک بساز که ..." now routes to the already-registered (but previously unreachable)
  `create_task` tool — a real, approval-gated hand-off to the orchestrator.
- `GET /v1/me/universe` extended (additive, zone contract unchanged) with `suggestedPrompts` (derived from
  real zone status, attention-first), `todaySummary`, `systemHealthSummary`, `memoryInsights` (from
  `scoped_memories`).

Delivered (dashboard-web):
- `OperatorConsole` handles a new `answer` response kind (grounded direct reply, no fake session) and
  renders `suggestedFollowUps` as clickable chips.
- Home page (`/`) hero gains a one-line honest today/system-health summary and Jarvis-suggested-prompt
  chips (`JarvisSuggestions.tsx`, reuses the existing `aos:jarvis` event bridge — no new plumbing).

Verification:
- **Phase AD smoke PASS (28/28)** (`scripts/phasead-jarvis-smoke.mjs`, deterministic-fallback path, no LLM
  key required): bilingual language detection; all 5 quality-bar prompts (system status, personal
  planning, "why isn't this real Jarvis", "what's next for AOS", task creation) classified and routed
  correctly; context-packet honesty (`not_configured` never hidden, never silently dropped); response
  capping (30 facts → ≤14 ranked); general chit-chat no longer hits the old dead-end message.
- Regression: Phase X operator-runtime 28/28, Phase AA scope 39/39, Phase AC+ universe 18/18 all still
  green. (Phase AB personal-smoke has one pre-existing, unrelated failure — a smoke-assertion/code text
  mismatch in `buildPersonalGraph` missingData wording that predates this phase and touches no file this
  phase changed; left as a known issue, not fixed here to keep scope honest.)
- `pnpm run build:shared` clean; `shared` and `gateway-api` `tsc --noEmit` clean; `dashboard-web`
  `tsc --noEmit` clean and `next build` ✓ Compiled successfully. Verified in an isolated sandbox copy (the
  mounted dev folder blocks the pnpm store).
- No Docker; Dokploy independence intact; no new required env vars; safe mode still forces deterministic
  fallback (`LLM_SAFE_MODE_FALLBACK`); no sensitive action bypasses approval.

Honest remaining gaps (kept accurate in `AOS_SELF_KNOWLEDGE` going forward): internet-research-service
still has no real web-search/fetch provider; personal connectors (calendar, email, finance, presence)
remain honestly not_configured; no CI pipeline; rate limiting/safe-mode/event-bus are still in-memory; the
*post-completion* session announcement in `OperatorConsole` (when a routed session finishes and the
dashboard polls it) still uses `reportSummary` directly rather than a second Jarvis composition pass —
acceptable (not fake) but less fluent than the initial reply; a future phase could route that through
`composeJarvisResponse` too.
Scope: `shared/src/{jarvis,operator,llm,constants,index}` (new module + minimal edits),
`services/gateway-api/`, `services/dashboard-web/`, `scripts/`, `docs/`.

## Phase AE — Jarvis Memory, Daily Brain & Real Context Upgrade — COMPLETE (2026-07-09)
Phase AD gave Jarvis a real conversational runtime, but its context was still request-scoped — it answered
from system state gathered fresh per message, with no memory of what the owner had said before and no
notion of "what does the owner's whole current reality look like right now." This phase closes that gap
without touching the UI (explicit constraint: "Do not redesign UI. Make the brain useful first.").

Delivered (shared — 3 new pure modules under `shared/src/jarvis/`, zero import-cycle risk by design —
structural typing used instead of importing from `./index.ts`, mirroring the existing `llm/index.ts` +
`llm/prompts.ts` split):
- **`memory.ts` (item 1 — memory ingestion)**: `extractMemoryFacts()` (LLM-assisted, `generateStructured`,
  schema-validated) with `extractMemoryFactsFallback()` as the deterministic bilingual (EN/FA) safety net —
  ordered regex patterns for `project | priority | decision | blocker | preference | fact`, conservative by
  design (only fires on clear phrasing, e.g. "I've decided…" / "تصمیم گرفتم…"; empty list is a valid, honest
  result for most turns). `buildMemoryFacts()` builds persistable, schema-valid records quoting the real
  sentence — never invented.
- **`daily-brain.ts` (items 2–4, 7)**: `rankPriorities()` combines active kernel tasks, active personal
  projects, and already-ranked next-best-actions into one deterministic weighted list (task priority ×
  status boost, project income potential, action priority score). `summarizeDecisionsAndBlockers()` pulls
  real recent decisions (kernel `decisionMemories` + extracted `decision` facts) and real active blockers
  (critical/high incidents, high/critical personal risks, extracted `blocker` facts) — nothing invented.
  `buildDailyBrainPacket()` composes both into one compact, grounded packet. `composeDailyBriefing()` /
  `composeDailyBriefingFallback()` turn the packet into a bilingual narrative briefing (item 7 support),
  same LLM+deterministic-fallback discipline as every other Jarvis composer.
- **`quality.ts` (items 5–6)**: `scoreJarvisAnswer()` — a PURE, deterministic scorer (never calls an LLM,
  so it grades LLM and fallback answers by the identical bar) grading groundedness (do claimed `groundedIn`
  labels actually exist in the packet), specificity (length + absence of generic dead-end phrasing),
  honesty (does the reply surface `not_configured` items it plausibly should), language match, and
  actionability, combined into one weighted `overall` score with a list of concrete `issues`.
  `composeTaskCompletionSummary()` / `composeTaskCompletionFallback()` close the Phase AD gap where a
  finished operator session was announced with the raw mechanical `reportSummary` — status is passed
  through verbatim to both the LLM prompt and the fallback template, so a failed/cancelled session is
  structurally never reported as a success.
- 3 new versioned prompt contracts (`gateway-api:jarvis_memory_extraction`, `gateway-api:jarvis_briefing`,
  `gateway-api:jarvis_completion`) in the Phase 13 prompt registry.
- 3 new collections (`jarvis_memory_facts`, `jarvis_answer_scores`, `jarvis_briefings`) and 3 new event
  types (`jarvis.memory.extracted`, `jarvis.briefing.generated`, `jarvis.session.summarized`).

Delivered (gateway-api):
- `composeAndRecordJarvisTurn()` (the single choke point every Jarvis reply already passes through) now
  also, best-effort and never blocking the reply: extracts memory facts from the owner's own message text
  and persists them to `jarvis_memory_facts`; scores the composed answer against the real context packet it
  was built from and persists the score to `jarvis_answer_scores`.
- `runLoop()`'s terminal-state branch (reached by every path that sets a session to `completed` or
  `failed`, including early critical-failure breaks) now composes a grounded completion summary via
  `composeTaskCompletionSummary()` and stores it on `session.context.jarvisSummary` (+ language +
  follow-ups) — wrapped in try/catch so a composition failure can never block persisting the session's real
  status.
- New `GET /v1/jarvis/briefing` endpoint (same `realityGet` scope-enforced pattern as `/v1/me/universe`):
  gathers real active kernel tasks, active personal projects, pending approvals, open incidents, personal
  risks, recent decision memories, recently extracted Jarvis memory facts, ranked next-best-actions, and
  safe-mode state into a `DailyBrainInput`, builds the packet, composes the briefing, persists it to
  `jarvis_briefings`, and returns it together with the ranked priority list.

Not delivered (by explicit instruction — "Dashboard integration only after backend quality is proven"):
no `services/dashboard-web/*` files were touched this phase. The new briefing endpoint, memory facts, and
answer scores are not yet surfaced anywhere in the UI.

Verification:
- **Phase AE smoke PASS (30/30)** (`scripts/phaseae-jarvis-brain-smoke.mjs`, deterministic-fallback path,
  no LLM key required): bilingual memory-fact extraction (including a real bug found and fixed — the
  decision-pattern regex didn't match the common contraction "I've decided", only "I decided"/"I have
  decided"); priority ranking (paused projects correctly excluded, sort order correct); decisions/blockers
  summary pulls from every real source (kernel decisions, incidents, risks, extracted facts); daily brief
  fallback composer is grounded and bilingual; quality scorer correctly rewards a grounded/specific/
  actionable answer and correctly penalizes a generic/mislabeled/language-mismatched/dishonest one with
  concrete issue strings; completion summary composer never softens a failed session in either language.
- Regression: Phase X operator-runtime 28/28, Phase AA scope 39/39, Phase AC+ universe 18/18, Phase AD
  Jarvis 28/28 all still green. (Phase AB personal-smoke still has the same one pre-existing, unrelated
  failure documented in the Phase AD entry above — untouched by this phase.)
- `shared` `tsc --noEmit` clean; `gateway-api` `tsc --noEmit` clean; `dashboard-web` `tsc --noEmit` clean
  (unchanged, as required — no dashboard files were edited).
- No Docker; Dokploy independence intact; no new required env vars; safe mode still forces deterministic
  fallback (`LLM_SAFE_MODE_FALLBACK`) end-to-end into memory extraction, scoring, briefings, and completion
  summaries; no sensitive action bypasses approval (this phase adds zero new mutating tools).

Honest remaining gaps: the new briefing endpoint, memory facts, and answer scores have no UI surface yet —
that is the natural next phase once the owner wants to see them. `jarvis_answer_scores` are recorded but
nothing yet acts on a low score (no auto-retry/escalation loop). Memory-fact extraction is deliberately
conservative (regex/LLM only fire on clear phrasing) so recall is intentionally incomplete rather than
guessing. `AOS_SELF_KNOWLEDGE` (Phase AD) has not yet been updated to mention the daily brain existing —
left for the phase that wires it into `meta_self_assessment` answers.
Scope: `shared/src/jarvis/{memory,daily-brain,quality,index}.ts`, `shared/src/{llm/prompts,constants}.ts`,
`services/gateway-api/src/index.ts`, `scripts/`, `docs/`.

## Phase AE.1 — Jarvis Priority & Memory Correction — COMPLETE (2026-07-09)
A real user conversation (recorded verbatim below) proved Phase AE's "memory ingestion" was write-only:
Jarvis extracted and stored priority facts correctly but never read them back, so an explicit, repeated
owner instruction ("یادت باشه اولویت من الان درست کردن مغز Jarvis و صفحه اول AOS است") was completely
ignored across five follow-up turns — every answer instead repeated raw service-health facts
(service-registry / file-asset-service unhealthy). This phase is the honest correction, not a prompt tweak.

Root cause (four distinct bugs, all confirmed by reading the actual code before any change):
1. **Retrieval gap** — `gatherJarvisFacts()` (gateway-api) never queried `jarvis_memory_facts` at all.
   Extraction (`extractMemoryFacts`) and persistence worked; nothing read the collection back into context.
2. **Extraction gap** — the FA priority regex (`اولویت( من)? اینه|مهم‌ترین کار`) didn't match the owner's
   actual phrasing ("اولویت من الان ... است"), and didn't recognize "یادت باشه ..." at all.
3. **Ranking gap** — `open_incidents` could reach weight 9 in `gatherJarvisFacts` with no memory-fact weight
   class to outrank it, so once retrieval was fixed, health facts would still have dominated without an
   explicit, higher weight class for stated priority/decision/blocker facts.
4. **Composition gap** — `composeJarvisResponseFallback`'s `meta_self_assessment` branch ignored the context
   packet entirely (hardcoded `AOS_SELF_KNOWLEDGE` text), so even a correctly-ranked packet couldn't reach
   the reply for that category; and the LLM path (`composeJarvisResponse`) is grounded by prompt instruction
   only, not by construction, so it could still ignore a present priority fact.

Delivered (shared — `shared/src/jarvis/memory.ts`, `shared/src/jarvis/index.ts`):
- Broadened bilingual priority-extraction patterns (FA: `یادت باشه`, `اولویت( من)?( الان)?`, `تمرکز(م| من)?`;
  EN: `remember that`, `my focus is`, kept existing `priority is`/`focus on`).
- `JarvisMemoryFactSchema` gained `importance` (deterministic by kind — priority 0.95, decision 0.9, blocker
  0.85, project/preference/fact lower), `language`, and `active` fields (item 1's full spec: type, text,
  source, confidence, language, createdAt, importance, active status).
- `pickActivePriorityFact()` — the single most recent active priority/decision fact; recency IS the
  supersession mechanism (D-103), verified in the smoke test with a restated priority.
- `composeJarvisResponseFallback()` now leads with a `user_priority` fact (when present, for every category
  except `system_status`) in a reply that explicitly separates **primary priority**, **technical
  blocker(s)**, and **suggested next step** — never merging them into one undifferentiated fact dump.
- `JarvisResponseSchema` gained structured `primaryPriority` / `activeBlockers` / `nextAction` fields
  (additive — existing `reply`/`groundedIn`/etc. unchanged).
- `answerIgnoresStatedPriority()` — a pure correction-gate check used by the gateway (item 6).
- CATEGORY_PATTERNS: added `تصمیم`/`بلاکر`/`مانع` to `personal_life_planning` so "چه تصمیم‌ها و بلاکرهای
  مهمی الان دارم؟" gets real classification instead of falling to `general_conversation`.

Delivered (gateway-api):
- `gatherJarvisFacts()` now unconditionally queries recent `jarvis_memory_facts` (regardless of intent
  category — classification alone is not a reliable gate, see D-101) and injects `user_priority` (weight 20),
  `user_blocker` (weight 12), `user_decision` (weight 11) — all above the system-health ceiling (~10).
- `composeAndRecordJarvisTurn()` now runs the LLM-composed reply through `answerIgnoresStatedPriority()` and,
  if it ignored a present priority fact, discards it and uses `composeJarvisResponseFallback()` as the
  deterministic correction template (item 6) — no second LLM call, fully testable.
- `GET /v1/jarvis/briefing` response restructured (item 7 correction) with explicit `primaryPriority`,
  `activeBlockers`, `systemWarnings`, `recommendedNextActions`, `memoryFactsUsed`, `confidence`,
  `dataFreshness` fields — `primaryPriority` is sourced from `pickActivePriorityFact()` first, falling back
  to the ranked packet only when no explicit memory fact exists.

Not delivered (deliberately out of scope, to keep this a minimal correct fix): Persian branches were not
added to `planForGoal()` for personal-planning goals — Persian priority/planning questions still fall through
to `clarify` → the (now fixed) direct-answer path, which is where this bug actually lived and is now
verified correct; giving them real `route_to_planner` sessions is a separate, larger phase. `AOS_SELF_KNOWLEDGE`
was not edited. No dashboard files were touched.

Verification:
- **Phase AE.1 smoke PASS (26/26)** (`scripts/phaseae1-jarvis-priority-memory-smoke.mjs`): replays the exact
  five-turn Persian conversation end-to-end through the real pure functions chained the same way the gateway
  wires them (extract → build fact → pick active priority → inject into context facts, including the exact
  noisy `service-registry`/`file-asset-service unhealthy` facts from the real conversation → build packet →
  classify intent → compose reply). All five turns now correctly name the Jarvis-brain/home-page priority as
  primary and the unhealthy services as a secondary blocker, never the reverse. Also covers: the
  `system_status` exemption (a pure health question keeps the status-report format, not the priority
  template), the correction-gate function directly, and priority supersession on restatement.
- Regression: Phase X 28/28, Phase AA 39/39, Phase AC+ 18/18, Phase AD 28/28, Phase AE 30/30 all still green
  (Phase AB's one pre-existing unrelated failure is unchanged).
- `shared` `tsc` clean; `gateway-api` `tsc --noEmit` clean. `dashboard-web` `tsc --noEmit` was attempted but
  blocked by a pre-existing, corrupted `.next/dev/types/routes.d.ts` build artifact (truncated mid-file,
  write-protected on the mounted dev folder, dated before this phase) — unrelated to this phase since zero
  dashboard-web source files were touched; recorded honestly rather than silently claimed clean.

Honest remaining gaps: `planForGoal` still has no Persian personal-planning branches (documented above);
the correction gate only fires when a `user_priority` fact conflicts with the LLM reply — it does not yet
catch every dishonesty pattern `scoreJarvisAnswer` can detect (e.g. a hidden `not_configured` item does not
trigger regeneration, only get logged as a quality issue); `active` on `JarvisMemoryFact` has no write path
yet (no explicit "forget X" command).
Scope: `shared/src/jarvis/{memory,index}.ts`, `services/gateway-api/src/index.ts`, `scripts/`, `docs/`.

## Phase AF.1 — Living Command Universe Foundation — COMPLETE (2026-07-09)
Full product-architecture direction recorded first in `docs/living-command-universe-vision.md` (sections A–J).
This phase executes the highest-leverage slice of that direction: make Jarvis's already-real intelligence
structurally visible and persistent, not a bolted-on chat widget, without a chaotic full redesign. Per the
governing constraint: no unused components, no unused API methods, no fake placeholder intelligence — every
piece below is wired to a real, already-tested backend capability.

Delivered (shared):
- `buildUniverseZones()`'s finance zone now exposes `in/mo` and `out/mo` metrics (additive), alongside the
  existing `net/mo`/`obligations` — `aggregateFinance()` always computed these; they were simply never
  exposed to any zone consumer. This is what makes a real cashflow visual possible without inventing numbers.

Delivered (dashboard-web — persistent shell, Step 1):
- `OperatorConsole.tsx` (the Phase X operator console) is now the persistent Jarvis Runtime Shell — refactored
  in place, not duplicated. It already lived in `app/layout.tsx` (mounted once, outside `page.tsx`), so its
  state already survived route navigation by construction; what was missing was an ambient presence. The
  collapsed state is no longer a static "OPERATOR" pill — it is a compact bar showing the real active session
  goal while working, or the real `primaryPriority` from `/v1/jarvis/briefing` otherwise, plus a live blocker
  count. The expanded panel (voice, session polling, approvals, capabilities) is unchanged.

Delivered (dashboard-web — Presence Bar, Step 2):
- New `gateway.briefing()` client method + `app/jarvis/actions.ts::getBriefingAction()` — the FIRST consumer
  of `GET /v1/jarvis/briefing` anywhere in the dashboard (built in Phase AE, corrected in AE.1, zero UI
  consumers until now — the single most concrete "built but invisible" finding in the vision doc, §A.8).
- New `PresenceBar.tsx` replaces the old flattened one-sentence "Jarvis today summary" card: renders
  `primaryPriority`, `activeBlockers`, `systemWarnings`, `recommendedNextActions` (as real Jarvis-summon
  buttons), `confidence`, relative `dataFreshness`, and `memoryFactsUsed` count as distinct, honest sections
  — never merged into prose. An unreachable briefing renders an explicit "not reachable" state, never a fake
  placeholder.
- Also closes a second, smaller stale-field gap found during this work: `/v1/me/universe`'s `memoryInsights`
  field was typed all the way through `gateway.ts` and never rendered anywhere since Phase AD. Now rendered
  in the Presence Bar. `todaySummary` (Phase AD) is deliberately no longer rendered — fully superseded by the
  more accurate, AE.1-corrected `primaryPriority`; kept in the API for compatibility, documented here as an
  intentional, not silent, non-use.

Delivered (dashboard-web — Focus Row, Step 3):
- New pure module `src/lib/focus.ts::buildFocusItems()` — framework-free (no React import), unit-testable.
  Structurally guarantees the exact fix Phase AE.1 made at the answer-composition layer now also holds on the
  homepage: an explicit stated priority is always item one; blockers and pending approvals follow; generic
  system warnings are the LAST resort, shown only when the row would otherwise be empty.
- New `FocusRow.tsx` renders the top 1–3 items with kind-labeled badges (YOUR PRIORITY / BLOCKER / APPROVAL /
  RECOMMENDED / SYSTEM) and visual weight — not a generic card grid.

Delivered (dashboard-web — Domain Canvas, Step 4):
- `UniverseZone.tsx` is now the shared shell (unchanged contract) that any domain can wrap with a real visual
  body via `children` — previously only the `health` zone (via `BodyMap.tsx`, already existing) did this.
- New `components/domains/FinanceFlow.tsx` — real inflow/outflow bars, net figure, and upcoming obligations,
  built from the newly-exposed `in/mo`/`out/mo` metrics. Hand-built CSS/SVG-free bars, zero new dependencies
  (no chart library exists or was added — follows the `BodyMap` precedent). Honest "not tracked yet" state
  when no real amounts exist.
- New `components/domains/SystemPulse.tsx` — deliberately compact single-row infrastructure strip (services /
  incidents / safe mode / active operation). Visible but subordinate, per the product direction.
- New `components/domains/PresenceBadges.tsx` — connector states as badges instead of bullet prose.
- `daily`/`life`/`ventures`/`opportunities`/`growth` zones are unchanged this phase (explicitly scoped out —
  "do not redesign every domain in one chaotic pass").

Delivered (dashboard-web — inline Jarvis annotations, Step 5):
- `UniverseZone.tsx` gained `JarvisAnnotation`: an `attention`-status zone now shows a distinct, bordered
  "Jarvis suggests: …" line using the zone's own real `jarvisCommand` field — not a duplicate of the headline
  already shown, not invented commentary. `setup_needed`/`not_configured` zones are intentionally left to the
  existing dashed setup-hint box (already correct) rather than duplicating the same text twice on one card.

Delivered (dashboard-web — live activity, Step 6):
- The ambient bar's activity indicator is driven by the SAME real `session` state the expanded panel already
  polls every 2.5s while a runtime session is active (`ACTIVE_STATUSES`) — no second SSE/EventSource
  connection was added. `LiveEvents.tsx` (the homepage's live pulse feed) is unchanged. A second, independent
  live-event subscription inside the shell was deliberately NOT built this phase to avoid duplicating a
  connection with no incremental proof of value yet — recorded as a real scoped-out decision, not silently
  skipped (see decision log).

Delivered (dashboard-web — result blocks / domain links, Step 7):
- New pure module `src/lib/domainLinks.ts::domainLinkFor(intentCategory)` maps a REAL, already-classified
  `intentCategory` (returned by `/v1/operator/command` since Phase AD) to the real zone it concerns. The
  Jarvis shell now renders a "Related: Zone →" chip under `answer`-kind replies. Deliberately NOT applied to
  `session`-kind replies — the gateway's `/v1/operator/command` session branch does not currently return
  `intentCategory` at all (a real, separate backend gap, not fabricated here — see known gaps below).
- Existing `suggestedFollowUps` action chips and the persistent session/progress panel (Step 1) already
  satisfy "action chips" and "persistent task/progress display" — reused, not duplicated.

Verification:
- **Phase AF.1 smoke PASS (11/11)** (`scripts/phaseaf1-focus-row-smoke.mjs`) — proves the Focus Row's
  priority-first structural guarantee, including the exact real failed-conversation scenario (stated priority
  + noisy service-registry/file-asset-service warnings) and the "system warning only as last resort" rule.
- Regression: Phase X 28/28, Phase AA 39/39, Phase AC+ 18/18, Phase AD 28/28, Phase AE 30/30, Phase AE.1
  26/26 all still green (Phase AB's one pre-existing unrelated failure is unchanged).
- `shared` `tsc` clean; `gateway-api` `tsc --noEmit` clean; `dashboard-web` `tsc --noEmit` clean (all new and
  edited files typecheck with zero errors).
- `next build` could NOT be completed in this sandbox: the mounted dev folder is read-only for `node_modules`
  writes (confirmed via `npm install` → `EPERM: operation not permitted, unlink .../node_modules/.bin/next`),
  and the ARM64 SWC binary is not preinstalled, so `next build` needs to download it — that download
  intermittently failed DNS resolution inside Node's fetch in this sandbox even though `curl` to the same
  registry succeeded. This is an environment limitation, not a code issue: `tsc --noEmit` (the authoritative
  type-correctness signal) is clean across all three packages, and this exact sandbox constraint was already
  documented in the Phase AD entry above (isolated `/tmp` copies were used there for installs). Honestly
  reported rather than skipped or claimed clean.

Honest remaining gaps: `daily`/`life`/`ventures`/`opportunities`/`growth` zones still use the pre-Phase-AF.1
generic list rendering — only Health/Finance/Systems/Presence have a domain-specific visual so far. No
dedicated `/finance`, `/health` etc. routes exist yet — domains still link into the older generic `/me/*`
pages. `session`-kind replies have no `intentCategory` in the gateway response, so the domain-link chip only
appears on `answer`-kind replies. The shell does not yet have its own independent live-event subscription —
activity is inferred from session state only. Inline Jarvis annotations only cover `attention` status; no
annotation logic was added for `live` zones (deliberately — nothing to flag). `next build` was not verified
in this sandbox pass (see Verification above); a full `next build` should be run in CI or an isolated copy
before this ships.
Scope: `shared/src/personal/index.ts`, `services/dashboard-web/src/{app,components,lib}/**`, `scripts/`,
`docs/`.

## Phase AF.2 — Full Domain Canvas Expansion & Jarvis-Guided Interaction — COMPLETE (2026-07-09)
Closes the gaps AF.1 left honest: all nine Command Universe zones now render a real domain-specific visual
(none fall back to the generic bullet list), Jarvis's inline annotation is domain-aware instead of one
generic line, a real backend field (financial risk items) that was being silently dropped is now surfaced,
and the Domain Canvas gained real screen-guidance (anchors + highlight-on-arrival). Builds on AF.1's
foundation — nothing from AF.1 was redone.

Delivered (dashboard-web — parsing + manifest, no new dependencies):
- `src/lib/zoneParsing.ts` — `extractNumberAfter`/`firstSegment`/`segments`, small typed parsers for the
  `"category · score X"`-style `detail` strings `buildUniverseZones()` already writes, shared across the new
  domain components instead of each reinventing regex.
- `src/lib/domainCanvas.ts` — `ZONE_IDS` + `DOMAIN_RENDERERS` manifest (zoneId → renderer file), the single
  source of truth the new smoke test checks "every zone has a real renderer" against.

Delivered (dashboard-web — 5 new domain visuals, `components/domains/`):
- `PriorityStack.tsx` (Today & Priorities) — ranked stack with a score bar sized against the batch's own max
  (parsed from the real `"category · score X"` detail); rows with no parseable score (overdue/approval
  special rows) show their real detail text instead of a fabricated bar.
- `HouseholdMap.tsx` (Family & Home) — groups `zone.items` by their real domain tag (family/home/relationship/
  household, parsed from `detail`) into clustered chip groups; high-importance items visually called out.
- `VentureBoard.tsx` (Ventures & Projects) — status-board rows with an income-tone indicator and real goal-link
  count. `PersonalProject` has no blocker/next-action field — rather than inventing one, rows honestly read
  "no blocker tracked" / "no goal link yet" when that's genuinely true.
- `SkillLanes.tsx` (Learning & Growth) — each active track as a status lane toward its target skill. No
  progress percentage is shown — `PersonalLearningTrack` has no percent-complete field, so none is invented.
- `OpportunityRadar.tsx` (Opportunity Radar) — ranked dual bars from the already-computed `valueScore`/
  `confidence` (`rankOpportunities()`), no client-side re-scoring.

Delivered (dashboard-web — BodyMap + FinanceFlow upgrades):
- `BodyMap.tsx` — added a visible micro-label next to every active node (previously hover-only via `<title>`)
  and a distinct pulsing attention ring around `concern: true` nodes, so a real flagged concern reads at a
  glance instead of blending into the same fill color used for a low-but-fine level.
- `FinanceFlow.tsx` — **fixed a real dropped-data bug**: the finance zone builder already computes `finRisks`
  (real financial risk items tagged `tone: 'err'`), but this component only ever read `tone: 'warn'` ("due")
  items, so risk items were silently invisible. Both are now surfaced, clearly separated (including in the
  "no amounts tracked yet" early-return branch, since risk records come from the personal graph, independent
  of whether any finance amount exists).

Delivered (dashboard-web — domain-specific Jarvis annotations):
- New pure module `src/lib/domainInsight.ts::buildDomainInsight(zone)` replaces the old one-size-fits-all
  annotation. Branches per real `zoneId`/`status`/`metrics` to produce a distinct message per domain (why it
  matters, what's concretely missing or wrong, the real `jarvisCommand` as the suggested action) tagged with
  one of the product's four categories (`setup_needed`/`not_configured`/`blocker`/`opportunity`). Returns
  `null` for a `live` zone — silence is correct when there's nothing to flag.
- `UniverseZone.tsx`'s `JarvisAnnotation` now renders this instead of the old generic "Jarvis suggests" line,
  and this single annotation now supersedes the separate dashed setup-hint box (kept only as a defensive
  fallback for a hypothetical future zone type with no insight branch — should never actually render).
- **Also fixed a duplication bug found while wiring this in**: the generic bullet-list rendering of `zone.items`
  was unconditional, so every zone with a custom visual (`children`) was ALSO showing the same items again as
  a plain list underneath — directly contributing to the "still too text-heavy" complaint. The list now only
  renders when there is no domain-specific visual already representing the zone's items.

Delivered (dashboard-web — screen-guidance: anchors + highlight-on-arrival):
- Every `UniverseZone` card now renders with `id="zone-<zoneId>"` and, on mount or `hashchange`, checks
  `window.location.hash` against its own anchor — on match it scrolls itself into view and shows a temporary
  glow highlight (~2.6s). Pure client-side visual affordance; no approval/scope/memory logic touched.
- `src/lib/domainLinks.ts`'s `CATEGORY_TO_DOMAIN` now points at these homepage anchors (`/#zone-<id>`) instead
  of the still-generic secondary `/me/*` pages, since every zone now has a real custom visual on the homepage
  itself. `approvals_tasks` correctly keeps its own `/approvals` route — a real distinct workflow, not a zone.
- `page.tsx` wires all 5 new components into their zones; all nine zones now pass a `children` visual to
  `UniverseZone` — none fall back to the generic list anymore.

Verification:
- **Phase AF.2 smoke PASS (21/21)** (`scripts/phaseaf2-domain-canvas-smoke.mjs`) — every zone has a manifest
  renderer; `buildDomainInsight` returns null for `live`, distinct real-data-driven text per zone (not one
  generic string), correctly branches growth's "opportunity" framing on the real `goals` metric; Phase AF.1's
  Focus Row priority-first guarantee re-verified green.
- Regression: Phase AF.1 Focus Row smoke re-run **11/11** green.
- `shared` `tsc` clean; `gateway-api` `tsc --noEmit` clean; `dashboard-web` `tsc --noEmit` clean (zero errors
  across all new/edited files). `next build` not attempted in this sandbox pass — same pre-existing sandbox
  limitation documented in the Phase AF.1 entry above (read-only mounted `node_modules`, SWC binary download
  DNS flakiness); `tsc --noEmit` remains the authoritative signal used here.

Honest remaining gaps: no dedicated `/finance`, `/health`, `/ventures` etc. routes exist yet — every zone's
"Open" link still goes to the older generic `/me/*` pages even though the homepage now has the real visual;
only the Jarvis-guidance domain links were repointed at the homepage anchors this phase. `session`-kind
operator replies still have no `intentCategory` (pre-existing AF.1 gap, unchanged). The highlight-on-arrival
effect is visual-only — it does not yet expand a zone's `children` visual or pre-fetch anything beyond what
the page already loads. `next build` still unverified in this sandbox (see Verification above).
Scope: `services/dashboard-web/src/{app,components,lib}/**`, `scripts/`, `docs/`.
