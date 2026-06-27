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
