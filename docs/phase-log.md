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

## Phase AF.3 — Jarvis Guided Control & Domain Action Layer — COMPLETE (2026-07-09)
Closes AF.2's biggest remaining gap: Jarvis could point at a zone but could not guide, edit, act on, or manage
it. Investigation before coding found that most of the needed infrastructure already existed but was either
disconnected (session replies never carried `intentCategory`) or built-but-invisible (`gateway.realityIngest()`
and `gateway.decideNextAction()` were already real, scope-enforced, and already used at `/me`, just never
surfaced in the Domain Canvas) — so this phase is mostly wiring, plus two small additive gap-fixes, not new
architecture.

Delivered (shared — additive, no breaking change):
- `ZoneItem` gains an optional `itemId` — only set for the two zones with a real, individually decidable
  record (`daily`'s next-best-action rows get the real `actionId`; `opportunities`' rows get the real
  `opportunityId`). Synthetic rows (overdue-item / approval-count) and every other zone's items correctly
  have no `itemId`, so no decide control can ever render for a non-record.

Delivered (gateway-api):
- `/v1/operator/command`'s `session`-kind response now includes the real, already-classified
  `intentCategory` (previously answer-kind only — recorded as an honest gap in AF.1's D-104; tool-routed
  goals are exactly the replies most likely to concern a specific zone, so this closed the bigger half).
- New `POST /v1/me/reality/opportunities/:id/decision` (accept/reject/follow_up) — a direct mirror of the
  existing next-actions decision endpoint immediately above it: same `enforceScoped`, same
  learn-from-decision `scopedMemories` write. No new mutation pattern invented.

Delivered (dashboard-web — session intentCategory end-to-end):
- `operator/actions.ts` stopped hardcoding `intentCategory: ''` for session-kind replies; `OperatorConsole`'s
  `submitCommand` now passes `domainLinkFor(r.intentCategory)` on the session branch too, so a tool-routed
  goal ("check the whole system", "review my finances") gets the same "Related: Zone →" chip an answer-kind
  reply already did.

Delivered (dashboard-web — the domain action manifest, `src/lib/domainActions.ts`):
- Pure data, no React: per-zone real actions (`add_data` → real ingest kind + real field names only,
  `create_task` → real orchestrator-routed task, `open_link` → a real existing page). `daily` and
  `opportunities` deliberately have no zone-level actions — see per-item decisions below. `ventures`'
  "add blocker" honestly routes through the real `risk` ingestion kind (no fabricated blocker field on
  `PersonalProject`); "next action" honestly routes through real task creation (no fabricated next-action
  field) — the same no-invented-schema-field discipline AF.2 established for the visuals now applies to
  actions too.

Delivered (dashboard-web — real controls, no unused components):
- `DomainActionControl.tsx` — one component rendering all three action kinds: `add_data` expands into a
  per-kind field form (preview line shows exactly what will be created before Confirm) posting through the
  new `ingestDomainDataAction` (generalizes the existing `ingestRealityFactAction` to accept the real
  per-kind optional fields, still the same `gateway.realityIngest()`); `create_task` expands into a
  pre-filled, editable goal field posting through the existing, unchanged `createTaskAction`; `open_link` is
  a plain chip. Wired into every `UniverseZone` footer via the manifest.
- `app/me/controls.tsx` gained `OpportunityDecisionButtons` (Save/Follow up/Reject), a direct mirror of the
  existing `DecisionButtons` (Accept/Decline/Done) — both now render per-item wherever a real `itemId` is
  present: `DecisionButtons` in `PriorityStack.tsx`, `OpportunityDecisionButtons` in `OpportunityRadar.tsx`.
  Rendered as a sibling below the item row, not nested inside its `Link` (a button inside an anchor is
  broken markup and would fire navigation on every click).

Delivered (dashboard-web — a real, minimal result block):
- `OperatorConsole`'s log entries gained `intentCategory` alongside the existing domain chip — a small,
  honest "understood as: {category}" line under any reply that has one. Deliberately did not build a second
  parallel "what will happen" state system: the existing runtime session panel (plan/pendingPermission/
  nextAction, unchanged since Phase X) already is that, for the one class of action that needs owner
  approval; the new add-data/opportunity-decision actions are the same no-approval, scope-enforced tier
  ingestion and next-action decisions already were, so they get an in-form preview instead, not a fake
  approval gate for a class of action that was never gated by one.

Verification:
- **Phase AF.3 smoke PASS (29/29)** (`scripts/phaseaf3-domain-action-layer-smoke.mjs`) — every zone has a
  real zone-level action or a real per-item decision path (never neither); every `add_data` action's
  ingestKind is a real, documented ingestion kind; no duplicate action ids; AF.1's priority guarantee and
  AF.2's live-zone-silence guarantee re-verified.
- Regression: AF.1 Focus Row smoke **11/11**, AF.2 Domain Canvas smoke **21/21**, both green.
- `shared` `tsc` clean; `gateway-api` `tsc --noEmit` clean; `dashboard-web` `tsc --noEmit` clean (zero errors,
  first pass, across all new/edited files). `next build` not attempted — same pre-existing sandbox limitation
  documented in the AF.1/AF.2 entries above.

Honest remaining gaps: "save" on an opportunity maps to `status: accepted` (there is no separate "saved"
state in `PersonalOpportunity`'s schema) — semantically the closest real transition, not a fabricated one,
but worth a dedicated status later if the distinction matters. No manual ingestion kind exists for
opportunities themselves (they are AOS-derived only), so there is intentionally no "add opportunity" control.
`PersonalProject` still has no first-class blocker/next-action field — both route through adjacent real
records (risk / task) rather than a schema change, which is honest but not the same as a dedicated field.
`next build` still unverified in this sandbox.
Scope: `shared/src/personal/index.ts`, `services/gateway-api/src/index.ts`,
`services/dashboard-web/src/{app,components,lib}/**`, `scripts/`, `docs/`.

## Phase AF.4 — Realtime Block Runtime, Fast Jarvis Response & Operation Lifecycle Fix — COMPLETE (2026-07-09)
Real-user testing of AF.3 surfaced that the runtime, not the UI surface, was the bottleneck: Jarvis replies
took 10+ seconds, domain actions required a full page refresh to see their own effect, and the persistent
shell repeated the same "Approval needed" bubble on every 2.5s poll tick until the user decided. This phase
fixes the actual architecture behind all three, plus wires the block-invalidation model the Domain Canvas
needed from AF.1 onward but never had.

**Why the old runtime felt slow/manual (root cause):** `/v1/operator/command`'s session branch ran three
sequential LLM-bound operations before responding at all — classify, the full synchronous `runLoop` tool
loop, then `composeAndRecordJarvisTurn`'s grounded reply composition (itself gated behind an *awaited*
"best-effort" memory-extraction call, despite the comment implying otherwise). `gatherJarvisFacts` also ran
four independent DB fetches sequentially with no data dependency between them. Separately, `runLoop`
persisted `opSessions` only once per invocation (at the very end) — so even backgrounding the loop would have
looked frozen mid-execution with no way to observe incremental progress.

**What changed (background execution + incremental persistence):**
- `gatherJarvisFacts` now runs its four independent fetch blocks via `Promise.allSettled` instead of four
  sequential awaits.
- `composeAndRecordJarvisTurn`'s memory-fact extraction and answer scoring are now genuinely fire-and-forget
  (`void (async () => {...})()`, each still individually try/catch-wrapped, never silently swallowing an
  error — a failure sets `status: 'failed'` honestly instead of leaving the session stuck).
- `/v1/operator/command`'s session branch and `/v1/operator/permissions/:id/decision`'s post-approval
  continuation both now return immediately after inserting/updating the session record, with the actual
  `runLoop` + composition backgrounded the same way. The client's existing 2.5s session poll (unchanged)
  picks up progress as it happens.
- `recordStep` now also persists the running session's `status/currentStep/plan/observations/context/
  evidenceIds/nextAction` into `opSessions` on every step (previously only written to the separate `opSteps`
  log), so a backgrounded `runLoop` shows genuine incremental progress instead of a single jump from
  `planning` to `completed`.
- `OperatorRuntimeSession` gained `composedReply/composedLanguage/composedFollowUps` so the backgrounded,
  LLM-grounded reply lands in the same polled record the client already reads — no second endpoint.

**Duplicate approval messages — the actual bug and the fix:** `applySession` narrated `waiting_approval`
unconditionally on every poll tick with `announce=true`, and the poll runs every 2.5s for as long as a
session stays in that status — which it does until the user acts. A ref-keyed by the real `permissionId`
(`announcedApprovalIdRef`) now gates the `say()` call so the *same* pending approval is announced exactly
once; a genuinely new approval (different `permissionId`) still announces normally, and the ref resets when
the session leaves the active-status set.

**Realtime block invalidation model:** `src/lib/realtimeBlocks.ts` is a pure, React-free manifest of the 12
named blocks the product brief specifies (`presence, focus, health, daily, life, finance, ventures, growth,
opportunities, systems, channels, live-pulse`) and the real, grounded mapping from every ingestion kind /
decision / task-creation / approval-decision / SSE event type to the blocks it actually affects — no
speculative mappings; kinds with no real effect on any tracked block (`profile`, `asset`, `tech_watch`)
honestly map to an empty array. `UniverseProvider` (new client context, seeded server-side from `page.tsx`'s
existing fetch for a fast first paint) exposes `refresh(blocks)`: since only one combined `/v1/me/universe`
endpoint exists, it refetches that endpoint but merges the result so ONLY the zone objects matching a
requested block are replaced — every other zone keeps its previous reference, so unaffected components skip
re-render. This is the "block-level" behavior the brief asks for, built honestly on the one real backend
endpoint that exists rather than inventing a per-block API. A `window` `CustomEvent` (`aos:invalidate-blocks`,
mirroring the existing `aos:jarvis` precedent) lets `OperatorConsole` — mounted at the layout level, outside
`UniverseProvider`'s tree — request a refresh too; `invalidateBlocks()` is a safe no-op if no provider is
mounted. `LiveEvents.tsx` (the app's one existing SSE connection) now also calls `invalidateBlocks` on every
relevant event, covering the "task finished while I was elsewhere" case, without opening a second connection.
Three new backend events (`reality.ingested`, `next_action.decided`, `opportunity.decided`) were added at
their real mutation points in gateway-api specifically so this bridge has something honest to listen for.

**Domain action UX fixes:** `DomainActionControl.tsx` now calls `useOptionalRefresh()` with the correct real
block list after every successful `add_data`/`create_task` submission, wraps both server-action calls in
try/catch with an `error` state that keeps the form open and shows the real error message on failure
(previously no error handling existed at all), and auto-collapses back to the closed chip ~1.4s after a
visible success badge instead of staying open indefinitely. `create_task` now calls a new
`createTaskInlineAction` (a non-redirecting sibling of the existing `createTaskAction`) — the original
always `redirect()`s to `/tasks/:id`, which would have navigated the user off the homepage the instant they
used an inline Domain Canvas control, directly against the "update in place" requirement.
`DecisionButtons`/`OpportunityDecisionButtons` (`app/me/controls.tsx`) gained an optional `onDecided`
callback, wired from `PriorityStack.tsx`/`OpportunityRadar.tsx` via `useOptionalRefresh()` — the `/me` pages
that also render these components don't pass the callback and are unaffected. `OperatorConsole.decide()`
calls `invalidateBlocks(blocksForApprovalDecision())` after an approval/reject resolves.

**Homepage architecture:** `page.tsx` is now a thin server shell (one `Promise.all` initial fetch, unchanged
data, unchanged fast first paint) that hands its result to `UniverseProvider`; all the interactive JSX that
used to be static in `page.tsx` (Identity Strip, Presence Bar, Focus Row, all nine Domain Canvas zones, live
pulse) moved into a new client component, `HomeLive.tsx`, which reads from `useUniverse()` instead of props.
A block currently mid-refresh gets a subtle opacity dip (0.6, 0.2s transition) rather than a spinner overlay
— visible feedback without a fake loading state on blocks that aren't actually being touched.

Verification:
- **Phase AF.4 smoke PASS (36/36)** (`scripts/phaseaf4-realtime-block-smoke.mjs`) — every real `add_data`
  action's ingestKind resolves to a real, non-fabricated block list; health/finance ingest specifically
  invalidates their own zone; next-action/opportunity decisions invalidate their real zone plus `focus`;
  every new SSE event this phase publishes has a real block mapping; `BLOCK_IDS` matches the brief's exact
  12-block manifest; an unknown event type honestly returns an empty array.
- Regression: AF.1 Focus Row smoke **11/11**, AF.2 Domain Canvas smoke **21/21**, AF.3 Domain Action Layer
  smoke **29/29** — all still green, unchanged.
- `shared` `tsc` clean, `gateway-api` `tsc --noEmit` clean, `dashboard-web` `tsc --noEmit` clean (zero errors,
  across all new/edited files in this phase).
- Not covered by an automated script (documented, not silently skipped): the duplicate-approval-message fix
  is React-state-driven (a `useRef` dedup key) with no pure function to unit test — verified by code review;
  `UniverseProvider.refresh()`'s actual network-merge behavior needs a browser/DOM environment. Both need a
  manual UI pass (see the phase's final report for the exact steps).

Honest remaining gaps: there is still no per-block backend endpoint — `refresh()` always refetches the one
combined `/v1/me/universe` route and merges client-side, so a "block-level" refresh is real in effect (only
the affected zone's React state changes) but not in network cost (the whole universe payload is refetched
every time). `ctx`/`session`-derived identity-strip bits (safe-mode banner text, consent count, owner badge)
are intentionally still static per-navigation props, not part of the block-invalidation model. `next build`
still unverified in this sandbox (same pre-existing limitation noted in every prior AF phase entry).
Scope: `shared/src/{operator,constants}/index.ts`, `services/gateway-api/src/index.ts`,
`services/dashboard-web/src/{app,components,lib}/**`, `scripts/`, `docs/`.

## Phase AF.4.1 — Persistent Live Operation Feed, Hydration Fix & Approval UX Hardening — COMPLETE (2026-07-09)
Real-user testing of AF.4 found the runtime was genuinely faster but still felt dead on arrival: no visible
"thinking" state before a reply, a multi-second frozen approval click, a real hydration error, and — the
sharpest complaint — a page refresh erased all operation context, forcing a manual trip through Tasks to
reconstruct what Jarvis had done. Investigation confirmed all of this was a *reload* problem, not a
*persistence* problem: every relevant record (`opSessions`, `opPermissions`, `tasks`, `events`, `jarvisTurns`)
was already real and durable — `OperatorConsole` simply never read any of it back on mount, and the homepage
had no query against it at all.

**Hydration fix.** `PresenceBar.tsx` (a `'use client'` component fed a server-provided `dataFreshness`
timestamp) computed `Date.now() - new Date(iso).getTime()` directly in its render body — evaluated once
during SSR, again a moment later during client hydration, producing a different "Xs ago" string each time: a
real value mismatch, not a false positive. Audited every other `timeAgo(`/`Date.now()` render-time call site
in the app (55 files call the shared `timeAgo()` helper) and confirmed zero others combine `'use client'`
with a direct render-time call — every other caller is a plain Server Component, computed once, server-only,
no client re-render to mismatch against. Fix: a new `RelativeTime.tsx` renders a stable, non-time-dependent
placeholder (`…`) on both the server pass and the client's first render, then computes the real label only
inside `useEffect` (which never runs during SSR), ticking every 5s afterward. `PresenceBar` now renders
`<RelativeTime iso={...} />` instead of computing the label itself.

**Persistent operation feed.** New `GET /v1/operator/live-state` (gateway-api) — real, already-persisted data
only: `activeSessions` (opSessions, active-status set), `recentSessions` (last completed/failed, so a result
stays visible briefly after finishing), `pendingApprovals` (opPermissions, status pending), `recentTasks`
(tasks, newest 5), `recentEvents` (events, filtered to a new authoritative `IMPORTANT_OPERATOR_EVENT_TYPES`
allowlist in `shared/src/constants` — shared by both the backend query and the frontend SSE subscription so
they can't silently drift apart), `recentJarvisTurns` (jarvisTurns, newest 5), and a computed
`activeOperationSummary`. A new `operator.approval.decided` event was added and published from the approval
decision endpoint, which previously updated state but published nothing — no SSE listener or live-state
consumer could ever observe the moment a decision was made, only the eventual session completion seconds
later.

**Overview Active Operations module.** New `ActiveOperationsPanel.tsx`, rendered on the homepage right below
the Presence Bar: active/waiting sessions with real status and next-action text, pending approvals with risk
level and a "Review" link into Jarvis, the most recent finished session's result (composed reply or report
summary), and recent task chips linking to their real Mission Control page (`/tasks/:id`). Renders nothing
when there's genuinely no content — never a fake "no activity" filler. "Dismiss" only hides the panel in
local component state for the current view; it never mutates any backend record. Seeded server-side on first
paint (`page.tsx` now fetches `getLiveStateAction()` alongside the existing universe/briefing fetch, added to
the same `Promise.all` so it doesn't add a serial round trip) and refreshed client-side via the existing
`UniverseProvider`/`realtimeBlocks` invalidation model — a new `'live-pulse'` block (already reserved in
AF.4's 12-block manifest but previously unused) is now the real target for every operator lifecycle event.
The existing "Live activity" card was upgraded the same way: `LiveEvents` now accepts `initialEvents` (seeded
from the same live-state snapshot) instead of always starting empty with "Waiting for events…", and merges
new SSE events in via a new pure `mergeDedupedEvents`/`eventDedupeKey` helper (`lib/eventDedupe.ts`) so an
event delivered both in the initial snapshot and moments later over SSE — a real possibility right after page
load — renders exactly once, chronologically ordered.

**Jarvis shell persistence + narration.** `OperatorConsole` now reloads on mount: fetches live-state, and for
the active-or-most-recent session, fetches the full per-session detail (same call the poll loop already used)
so `pendingPermission` is populated too — a session reloaded as `waiting_approval` now genuinely shows its
approve/reject card again, not just a status label. Seeds the chat log with one honest "Resuming — {goal}
({status})" or "Last operation: {goal} — {status}. {result}" line when the log is otherwise empty (guarded so
it never clobbers a log already seeded by the existing `aos:jarvis` summon path). Submitting a goal now pushes
an immediate "Goal received — thinking…" line to the log before the network call starts (not spoken — a
visual pulse, not new narration), removed once a real reply lands, fixing the "looks frozen" complaint without
touching the announcement-dedup logic AF.4 already fixed.

**Approval UX.** Approve/Reject clicks are now optimistic: a `decidingAction` state disables both buttons and
swaps the clicked one's label to "Approving…"/"Rejecting…" immediately, before the network call, reconciled
once the real response lands — the multi-second frozen-click complaint is fixed without inventing a fake
success state (the buttons stay disabled until the real decision resolves; if it fails, `finally` clears the
state honestly).

Verification:
- **Phase AF.4.1 smoke PASS (18/18)** (`scripts/phaseaf4-1-live-operation-feed-smoke.mjs`) — new operator
  lifecycle events map to the `'live-pulse'` block; `blocksForApprovalDecision`/`blocksForSessionStarted`
  include it; `eventDedupeKey`/`mergeDedupedEvents` correctly collapse an exact duplicate, keep two genuinely
  different events, preserve chronological order, and respect the cap; a structural source-inspection check
  confirms `PresenceBar.tsx` no longer calls `Date.now()` directly and renders `<RelativeTime>`, and that
  `RelativeTime.tsx` only computes its label inside `useEffect`, never in the render body.
- Regression: AF.1 Focus Row **11/11**, AF.2 Domain Canvas **21/21**, AF.3 Domain Action Layer **29/29**, AF.4
  Realtime Block Runtime **36/36** — all still green, unchanged (115/115 total across every phase smoke test).
- `shared` `tsc` clean, `gateway-api` `tsc --noEmit` clean, `dashboard-web` `tsc --noEmit` clean (zero errors,
  across all new/edited files in this phase).
- Not covered by an automated script (documented, not silently skipped): the live-state endpoint's actual
  Mongo query behavior needs a live database (this sandbox has no mongod) — verified by code review and the
  gateway-api typecheck instead. `OperatorConsole`'s mount-time reload and optimistic approval buttons are
  React-state-driven with no pure function to unit test — verified by code review; needs a manual UI pass
  (see this phase's final report for the exact steps). True SSR/hydration reproduction needs a real Next.js
  render pass in a browser or a running `next build`, unavailable in this sandbox — the structural source
  check above is the closest verification available here.

Honest remaining gaps: operator session/approval queries (`live-state`, `sessions/active`) are still global,
not scoped per-user, matching the pre-existing behavior of every other operator endpoint — a correct future
fix (the schema already carries `userId`) but out of scope for this bug-fix phase. `recentEvents`' `message`
field falls back to the empty string when a backend event's payload has no `message` key (a few older event
types predate the `message` convention) — rendered as the bare event type in that case, not fabricated text.
`next build` still unverified in this sandbox, as in every prior AF phase entry.
Scope: `shared/src/constants/index.ts`, `services/gateway-api/src/index.ts`,
`services/dashboard-web/src/{app,components,lib}/**`, `scripts/`, `docs/`.

## Phase AF.4.2 — Re-verification + Actor-Scoping Investigation — COMPLETE (2026-07-09)
A follow-up request asked for a fresh, independent investigation of the AF.4.1 deliverables (not a re-trust of
the prior report) plus explicit actor/scope-aware filtering on `GET /v1/operator/live-state` "where the
existing system supports it." Re-ran every check from scratch: re-read the current `OperatorConsole.tsx`
(confirmed the mount-time `getLiveStateAction()` hydration, the `announcedApprovalIdRef` dedup, the
`decidingAction` optimistic-approval state, and the "Goal received — thinking…" immediate narration are all
genuinely present and wired, not just claimed), re-typechecked all three packages clean, and reran the full
115-check smoke suite (AF.1 11, AF.2 21, AF.3 29, AF.4 36, AF.4.1 18) fresh — all green, no regressions.

**Actor-scoping investigation (the one substantive new question).** Traced every collection `live-state`
reads: `OperatorRuntimeSession.userId` is a required schema field, but at creation
(`services/gateway-api/src/index.ts`, session literal) it is set to `role` (the declared RBAC role string,
e.g. `'owner'`) — not a real per-actor `primaryUserId`. `OperatorToolPermission` has no actor field at all
(only reachable by joining through `runtimeSessionId`). `Task` has `createdBy` and an optional `ScopeFieldsSchema`
merge, but `GET /v1/tasks` has never filtered by either. Checked every sibling endpoint this data model
already has (`/v1/operator/sessions`, `/v1/operator/sessions/active`, `/v1/tasks`, `/v1/events`,
`/v1/approvals`) — none of them apply actor/user filtering; this is a consistent, existing architectural
choice: personal-reality data (`/v1/me/*`, via `enforceScoped`/`resolveAuth`/`primaryUserId`) is the one
sub-system with real per-user scoping in this codebase, while operator/kernel-level state (sessions, tasks,
approvals, events) is treated as the single shared kernel operational plane, visible to whoever the RBAC
`guard()`/role check already permits to call the endpoint at all.

**Decision:** did not add per-record actor filtering to `live-state`. Filtering `opSessions` by the exact
`role` string would be technically real (the field exists) but risks a false negative for the person this
whole phase is trying to help — the single human owner — the moment a session was ever created under a
different declared role (e.g. an automated `'agent'`-role goal), silently hiding real, active operations from
the Overview/Jarvis shell. That would directly regress this phase's core requirement ("the user can refresh
Overview and still see active/recent operations"). The existing `guard(req)` RBAC gate remains the real,
already-supported access boundary for this endpoint — consistent with every sibling endpoint — and is
documented here as the answer to "scoped correctly... where the existing system supports it" rather than
inventing a filtering scheme the data model doesn't cleanly support. See D-124.

**`next build` attempted directly this time** (not just noted as unverified): fails with
`Failed to load SWC binary for linux/arm64` — the sandbox's `node_modules` has no
`@next/swc-linux-arm64-gnu`/`-musl` native binary installed (Next.js 16.2's Rust-based SWC compiler ships as a
platform-specific optional dependency; this aarch64 Linux sandbox's `pnpm install` never pulled it, and
`next build`'s WASM fallback also isn't installed). `tsc --noEmit` remains the verification ceiling available
here across all three packages; a real `next build` needs to run in an environment with that native
dependency present (e.g. the actual Dokploy deployment target).

No files changed in this phase beyond documentation — investigation confirmed AF.4.1's implementation is
correct as shipped and identified no code defect requiring a fix.
Scope: `docs/phase-log.md`, `docs/decision-log.md` only.

## Phase AF.4.3 — Live Activity Module Rebuild (One Item Per Operation) — COMPLETE (2026-07-09)
Scoped fix, requested explicitly as "fix only the Live Activity module, do not redesign the app." Root cause:
`LiveEvents.tsx` rendered the raw `events` collection one row per event with no grouping and no size bound —
a single Jarvis goal produced 4-5 separate lines (session started, approval requested, tool failed, session
completed, ...) that never updated in place, and the `.feed` container had no `max-height`/`overflow`, so the
box grew with the page.

**Grouping key.** New pure `lib/operationFeed.ts` (`buildOperationFeed`) groups everything by the real,
already-existing stable identity each record carries: `runtimeSessionId` for a Jarvis operator session,
`taskId` for a kernel task. A pending approval is folded into its own session's card (matched by the same
`runtimeSessionId`) rather than rendered as a separate item — an approval isn't a distinct operation from the
session it blocks. Only events with neither id (`reality.ingested`, `service.registered`, ...) become their
own standalone card, which is correct since each is a genuine one-off occurrence, not a multi-step operation.
Every subsequent event/approval/session update for the same key patches that one `Map` entry (title/status/
latest message/history) — it is structurally impossible for the same operation to produce two rows.

**What each card shows.** Title (goal or event message), kind badge (session/task/event), a normalized status
label with color tone (planning/running/waiting approval/waiting on you/completed/failed/cancelled for
sessions; completed/failed/pending/running for tasks), the latest real message, small meta (e.g. risk level),
a relative timestamp (via the existing hydration-safe `<RelativeTime>`, not a new inline `Date.now()` — this
pass deliberately did not reintroduce the AF.4.1 hydration bug in a new component), a real link (`/tasks/:id`
for kernel tasks, "Open Jarvis" for sessions), and a collapsed-by-default "N more" expander revealing up to 6
recent merged messages as detail history.

**Container.** `LiveEvents` no longer uses the shared, globally-referenced `.feed` CSS class (12 other pages
depend on it — editing it would have violated "do not touch unrelated parts"). Its operation-card list instead
uses a scoped inline `maxHeight: 340, overflowY: 'auto'` wrapper, so the box has a fixed footprint and scrolls
internally instead of stretching the page.

**Data flow.** `LiveEvents` now reads `useUniverse().liveState` directly (sessions/approvals/tasks, already
kept fresh by the existing 'live-pulse' block-invalidation model from AF.4/AF.4.1 — unchanged) instead of a
static `initialEvents` prop, and merges its own SSE-arriving events into a small local buffer via the existing
`mergeDedupedEvents` for instant per-event feedback ahead of the next live-state refetch. `HomeLive.tsx`'s
outer wrapper card (which duplicated a "Live activity" heading around `LiveEvents`' own card) was removed in
favor of rendering `<LiveEvents />` directly — the only other file touched, and only because it's this
module's direct container.

Verification:
- **Phase AF.4.3 smoke PASS (16/16)** (`scripts/phaseaf4-3-live-activity-feed-smoke.mjs`) — a session plus its
  own 3 lifecycle events plus its approval collapses to exactly one card; a task and an unrelated session stay
  two distinct cards; duplicate/repeated events never create extra cards; an identity-less event becomes one
  standalone card; a completed session shows its real composed result, not a stale status; newest-updated
  operation sorts first; the cap is respected.
- Regression: AF.1 11/11, AF.2 21/21, AF.3 29/29, AF.4 36/36, AF.4.1 18/18 — all still green (131/131 total).
- `shared` `tsc` clean (unchanged), `gateway-api` `tsc --noEmit` clean (unchanged, no backend files touched
  this phase), `dashboard-web` `tsc --noEmit` clean.

Honest remaining gaps: `recentTasks`/`recentEvents` are still capped at the backend's existing live-state
limits (5 tasks, 30 events) — a very busy day could still see an operation's supporting events age out of that
window before the card is rebuilt from a fresh snapshot, in which case the card falls back to whatever the
next real event/session update carries (never fake data, just a smaller history list). The collapsed detail
history caps at 6 entries per card — older merged messages for a very long-running operation are dropped, not
retained. `next build` still unverified in this sandbox per the standing SWC-binary limitation (D-124/AF.4.2).
Scope: `services/dashboard-web/src/{lib/operationFeed.ts (new), components/LiveEvents.tsx,
components/HomeLive.tsx, app/operator/actions.ts}`, `scripts/`, `docs/`.

## Phase AF.4.4 — Live-State Cap Hardening — COMPLETE (2026-07-09)
User-selected follow-up ("continue AF.4.x hardening") targeting the exact gaps AF.4.3 had just documented as
honest remaining limitations: `recentTasks` capped at 5, `recentEvents` capped at 30, and — found during fresh
investigation of `GET /v1/operator/live-state`, not previously flagged — `activeSessions` capped at 5, which
is a real correctness bug rather than a cosmetic tight limit: a 6th concurrently active or waiting-approval
session simply disappeared from both the Overview panel and the Live Activity feed with no indication anything
was hidden.

**Backend (`services/gateway-api/src/index.ts`, `/v1/operator/live-state`).** Raised Mongo query limits:
`activeSessions` 5→20, `recentSessions` 5→10, `recentTasks` 5→10, `recentEvents` 30→50. `pendingApprovals`
left at 10 (unchanged) — approvals are inherently a small, quickly-resolved "waiting on you" set on a
single-operator system, so the existing limit was never actually binding. See D-127.

**Frontend companion fix (`ActiveOperationsPanel.tsx`).** The Overview module's active-sessions list was the
only list in that component with no render-time cap (`pendingApprovals`/`recentTasks` already used
`.slice(0,3)`). Raising the backend limit to 20 without capping the render would have let a busy day balloon
the homepage summary to 20 rows, defeating its purpose as a concise glance view. Added `.slice(0, 4)` plus an
honest "+N more active — open Jarvis" link (real count, real destination) rather than silently truncating or
inventing an "and more..." label. See D-128. The full, scrollable Live Activity feed (AF.4.3) is unaffected by
this cap and continues to show every active operation as a real card.

**Scope discipline.** This pass intentionally addressed only the numeric-cap class of gap explicitly named in
the user's selected option (live-state's 5-task/30-event caps) plus the one additional correctness issue found
during investigation of the same endpoint (`activeSessions`). No pure-logic contract in `operationFeed.ts` or
`eventDedupe.ts` changed — only Mongo `.limit()` values and one React `.slice()` render cap — so the full
existing regression suite was the correct and sufficient verification, not a reason to write new smoke checks.
Per-actor scoping (raised as an option in the same user answer) was not revisited: AF.4.2/D-124 already
concluded, after real investigation, that the underlying data model has no genuine per-actor field to scope
by, and nothing in this pass changed that.

Verification:
- Both edited files typecheck clean: `gateway-api` `tsc --noEmit` exit 0, `dashboard-web` `tsc --noEmit` exit 0.
- Full regression suite re-run after recompiling every phase's pure lib files: AF.1 11/11, AF.2 21/21, AF.3
  29/29, AF.4 36/36, AF.4.1 18/18, AF.4.3 16/16 — **131/131 passing**, unchanged, confirming the cap/slice
  edits altered no pure-logic behavior.
- `next build` still unverified in this sandbox per the standing SWC-binary limitation (D-124/AF.4.2) — no
  change in this phase.

Honest remaining gaps: `recentEvents` (50) and `recentTasks` (10) are still finite windows, not unbounded
history — an extremely high-volume day could still theoretically age out supporting detail for an old
operation before its card patches from a fresh snapshot; this is a deliberately chosen tradeoff (bounded
payload size on every `live-state` call) rather than an oversight. Per-actor scoping remains unimplemented by
design (D-124), not by omission. No other "rough edges" were identified or addressed in this pass — this phase
was intentionally scoped to the caps issue only.
Scope: `services/gateway-api/src/index.ts`, `services/dashboard-web/src/components/ActiveOperationsPanel.tsx`,
`docs/`.

## Phase AF.5 — Dedicated Per-Domain Routes ("Command Universe follow-through") — COMPLETE (2026-07-09)
Closes the gap the documentation audit's recommended-next-phase named explicitly: every Command
Universe zone's "Open" link led to a generic or outright mismatched page —
`health` and `life` both pointed at `/me/reality` (a collision), `finance` pointed at
`/me/opportunities` (wrong domain entirely), and `daily`/`ventures`/`growth`/`opportunities`
pointed at pages that existed but weren't built as a comparable front door for the zone
specifically. `systems` and `presence` already had real dedicated pages (`/operations`,
`/settings/connectors`) but with a different visual language than a Command Universe room. User's
explicit requirement for the fix: "Strong, complete, comparable, and comprehensive."

**Backend.** New `GET /v1/me/universe/detail` (`services/gateway-api/src/index.ts`) reuses the
exact same scoped queries as `/v1/me/universe` — same collections, same `userId` filter, same
`buildUniverseZones()` call for the shared header/metrics — and additionally returns the complete,
unsliced per-domain arrays (all health states, all life items, all finance items + the real
`aggregateFinance()` result, all proposed and historical next-actions, all projects, all learning
tracks + goals, all ranked opportunities, open incidents + recent events, all connector accounts).
One endpoint for nine domains, not nine endpoints, so every room is guaranteed to read a consistent
snapshot (D-129). `aggregateFinance` is now exported and imported directly in gateway-api rather
than only used internally inside `buildUniverseZones()`.

**Frontend — one comparable template, nine rooms.** New `DomainRoom` component
(`services/dashboard-web/src/components/domains/DomainRoom.tsx`) is the single structure every
room uses: header (title/subtitle/breadcrumb/"Ask Jarvis"), the zone's real metrics row, the same
domain visual already used on the homepage (visual continuity — `BodyMap`, `FinanceFlow`,
`PriorityStack`, `HouseholdMap`, `VentureBoard`, `SkillLanes`, `OpportunityRadar`, `SystemPulse`,
`PresenceBadges`) plus the zone's real domain actions, a "go deeper" section linking to whichever
pre-existing richer page already manages that domain (D-130), and the complete, unsliced record
list for that domain (not the homepage's 3-6 item summary). Nine new routes:
`/health`, `/daily`, `/life`, `/finance`, `/ventures`, `/growth`, `/opportunities`, `/systems`,
`/presence` — none collided with any of the ~69 existing route directories. New
`services/dashboard-web/src/lib/domainRoomLinks.ts` is the single manifest mapping each zone to its
real deeper links (empty array where no deeper page exists yet — never a fabricated link). New
`JarvisOpenButton.tsx` isolates the one client-side control the otherwise-server-rendered
`DomainRoom` needs.

**Wiring.** All nine zone `href` values in `shared/src/personal/index.ts`'s `buildUniverseZones()`
were changed to their new dedicated room (D-131 explains why `systems`/`presence` changed too, even
though their old targets already worked). `services/dashboard-web/src/app/me/actions.ts`'s
`revalidatePath()` calls were extended so actions taken from inside a dedicated room (domain
actions, opportunity decisions, next-action decisions) invalidate the correct room(s) on next load.

Verification:
- **Phase AF.5 smoke PASS (29/29)** (`scripts/phaseaf5-domain-rooms-smoke.mjs`) — calls the real,
  compiled `buildUniverseZones()` (not a hand-written claim) and asserts: all 9 zones present, each
  zone's href is its own dedicated room, all 9 hrefs are unique (the original health/life collision
  is now structurally impossible), and no zone still points at any pre-AF.5 generic page.
- Regression: AF.1 11/11, AF.2 21/21, AF.3 29/29, AF.4 36/36, AF.4.1 18/18, AF.4.3 16/16 — all still
  green (131/131), unaffected since no pure-logic module from an earlier phase changed. **160/160
  cumulative total.**
- `shared` `tsc -p tsconfig.json` clean, `gateway-api` `tsc --noEmit` clean, `dashboard-web`
  `tsc --noEmit` clean (one real type error found and fixed during this pass: `DomainRoom`'s
  metric-tone mapping needed explicit narrowing from `string` to the `MetricCard` tone union).
- `next build` still unverified in this sandbox per the standing SWC-binary limitation (D-124).

Honest remaining gaps: the "go deeper" links are informational, not yet contextual — they always
point to the same page for a domain regardless of which specific record you're looking at (e.g.
the finance room's "Go deeper" section has no page to link to at all, since no dedicated finance
management page exists yet — the room's own full list is the only view). The nine rooms have not
been visually verified in a real browser in this sandbox (no working `next build`/dev server check
here — only source-level and typecheck verification). Item-level hrefs inside each zone's homepage
card summary (`items[].href`, e.g. `/me` for daily's top-3 actions) were intentionally left
pointing at their original destinations rather than redirected to the new rooms — low-value churn
for this pass, not a defect.
Scope: `services/gateway-api/src/index.ts`, `shared/src/personal/index.ts`,
`services/dashboard-web/src/{app/{health,daily,life,finance,ventures,growth,opportunities,systems,presence}/page.tsx (new),
components/domains/{DomainRoom.tsx,JarvisOpenButton.tsx} (new), lib/{gateway.ts,domainRoomLinks.ts (new)},
app/me/actions.ts}`, `scripts/`, `docs/`.

## Phase AG — Real Research & Intelligence Fabric — COMPLETE (2026-07-09)
Closes the single most-cited gap across every audit document in this repo, including the
untouched Persian `TECHNICAL-REPORT.md` §9 (written 2026-07-05, before this phase):
`internet-research-service` had no real web-search API. Its "real" mode meant only that the LLM
call was real — the cited source URLs still came from the model's own training-data recall (or, if
neither search nor LLM was available, hand-curated OWASP/NIST text). This is exactly the class of
overstatement the project's own "no fake success" principle otherwise forbids.

**New provider abstraction.** `shared/src/research/index.ts` (new module): `WebSearchProvider`
interface + `TavilyProvider` (direct `fetch()` to Tavily's REST API, no SDK — mirrors the existing
`LlmProvider`/GitHub/Dokploy client style), `webSearchProviderFromEnv()` (returns `null`, not a fake
provider, when `TAVILY_API_KEY` is unset — see D-132), `webSearchStatusFromEnv()`, and
`estimateReliability(url)` (a conservative domain-based heuristic — `.gov`/`.edu`/OWASP/NIST/etc. →
high, reddit/medium/quora/blogspot → low, everything else → medium, never invented as high).

**`runResearch()` rewritten for real grounding.** When a search provider is configured,
`shared/src/intelligence/index.ts`'s `runResearch()` now fetches real results FIRST, feeds them to
the LLM as grounding context (genuine retrieval-augmented generation, not "ask the model what it
remembers"), and — critically — rebuilds the final `ResearchSource` records directly from the
original real search results rather than trusting the LLM's echoed `sources` field, which makes URL
hallucination/mistyping structurally impossible when grounded (D-134). A new `fallbackFromSearchResults()`
means a configured search provider with no available LLM still returns real retrieved content
instead of degrading to canned fallback text (D-135). A search-provider failure (bad key, rate
limit, network) is caught and treated exactly like "not configured" — never an uncaught error,
never a fake success — with an honest `[web search unavailable: ...]` note prepended to the summary.

**New `sourceMode` field, orthogonal to the existing `mode`.** `ResearchRun`/`ResearchReport`/
`ResearchSource` (`shared/src/schemas/intelligence.ts`) gained `sourceMode: 'search_api' | 'llm_only'
| 'curated_fallback'` (D-133) — a real LLM (`mode: 'real'`) does not mean a real, verified URL; only
`sourceMode: 'search_api'` does. Both the `/research` list and `/research/:id` detail pages
(`services/dashboard-web/src/app/research/`) now show this as a second badge alongside `mode`, so
the dashboard no longer collapses "the LLM was real" and "the sources were verified" into one
overstated label.

**Wiring.** `services/internet-research-service/src/index.ts` builds the provider once at boot from
`TAVILY_API_KEY` and passes it into every `runResearch()` call; narration events and the task
response now report `sourceMode` alongside `mode`. `GET /v1/system/integrations`
(`services/gateway-api/src/index.ts`) — which previously reported only `github`/`llm` and was
silent on research entirely — now includes `research: { configured, provider }` via
`webSearchStatusFromEnv()`.

Verification:
- **Phase AG smoke PASS (23/23)** (`scripts/phaseag-research-fabric-smoke.mjs`) — against the real
  compiled `runResearch()`/`estimateReliability()`/`webSearchProviderFromEnv()`: reliability
  heuristic correctness; provider returns `null` (never a fake) when unconfigured; grounded runs
  produce `sourceMode: 'search_api'` with sources exactly matching the real search results — even
  when a fake LLM deliberately echoes a different, wrong URL, proving the hallucinated URL never
  reaches the stored record; ungrounded runs honestly report `llm_only`/`curated_fallback`; a
  failing search call degrades gracefully with an honest note; a configured-search/no-LLM run still
  returns real retrieved findings, not canned fallback text.
- Regression: all prior phases unaffected (AF.1 11/11 … AF.5 29/29 — **183/183 cumulative total**).
- `shared` `tsc -p tsconfig.json` clean, `gateway-api`/`internet-research-service`/`dashboard-web`
  `tsc --noEmit` clean.
- `next build` still unverified in this sandbox per the standing SWC-binary limitation (D-124) —
  unchanged, no attempt made this phase.

Honest remaining gaps: only one provider (Tavily) is wired, though the interface supports more —
Serper/Bing were considered and deliberately deferred (D-132), not built. `estimateReliability()` is
a domain-pattern heuristic, not a real fact-checking or citation-verification system — it can be
wrong about a specific unfamiliar domain (defaults to `medium`, never fabricates `high`). No new
env credential was actually exercised end-to-end in this sandbox (no real `TAVILY_API_KEY`
available here) — verification is at the pure-logic/integration-contract level (real HTTP call
shape, real response parsing, real fallback wiring), not a live network call against Tavily's API;
the owner must set `TAVILY_API_KEY` and verify a real call in an environment with network egress.
Research sources still aren't fed back into daily briefing/opportunity scoring/reports —
`docs/roadmap.md`'s carried-forward item #6 ("let research feed daily briefing, opportunity
scoring...") remains open.
Scope: `shared/src/{research/index.ts (new), intelligence/index.ts, schemas/intelligence.ts,
env/index.ts, index.ts}`, `services/{internet-research-service/src/index.ts, gateway-api/src/index.ts,
dashboard-web/src/app/research/{page.tsx,[id]/page.tsx}}`, `.env.example`, `scripts/`, `docs/`.

## Phase AG.1 — Research Fabric Wired Into Jarvis/Operator — COMPLETE (2026-07-09)

Bug report (owner, live testing): asking Jarvis "Find current AI lighting design trends in Dubai
luxury interiors" returned "research provider is not_configured — I will not invent market claims,"
despite Phase AG's `WebSearchProvider`/`TavilyProvider`/`sourceMode` machinery already existing and
passing 23/23 smoke checks. Phase AG built the plumbing correctly but never wired it into the two
tools the live Jarvis conversation can actually reach.

**Root cause (two independent bugs, both pre-dating Phase AG and never updated when it landed):**
1. `find_opportunities` (`services/gateway-api/src/index.ts`) returned a hardcoded
   `"research provider is not_configured"` string whenever the user had no recorded opportunities in
   Mongo — unconditionally, regardless of whether `TAVILY_API_KEY` was actually set anywhere. It
   never called `runResearch()`, `internet-research-service`, or `webSearchStatusFromEnv()`.
2. `research_topic` (registered in `shared/src/operator/index.ts`, executed in
   `services/gateway-api/src/index.ts`) *was* correctly triggered by goals containing the literal
   words "research"/"best practice(s)"/"investigate", but its executor called
   `createKernelTask()` — a fire-and-forget dispatch that creates a Mongo task and hands it to
   `orchestrator-agent`'s async `runResearchPipeline` (which DOES call the real research fabric
   correctly). The Jarvis reply in the same turn was only `"Research task {id} started."` — the
   actual grounded findings, `sourceMode`, and sources never made it back into the conversation.
   Separately, the reported prompt didn't even contain "research"/"best practice"/"investigate", so
   it never reached `research_topic` at all — it fell through to a generic "clarify" answer instead
   (`planForGoal()` is purely deterministic-regex, matched independently of the LLM-classified
   `intent.category`, which is used only to decide direct-answer vs. plan mode).

`shared/src/jarvis/index.ts`'s `AOS_SELF_KNOWLEDGE.knownGaps` also still stated flatly that
"internet-research-service has no real web-search/fetch provider" — stale from before Phase AG,
which would make Jarvis confidently understate its own real capability on meta/self-assessment
questions.

**Fix.** Added `dispatchResearch(topic)` in `services/gateway-api/src/index.ts`: a direct, awaited
`fetch()` to `internet-research-service`'s `/.factory/task` (45s timeout, same peer-dispatch
pattern already used by `check_service_health`/`code-operator-agent` tools), returning a summary
string that embeds `[sourceMode: ... — <plain-English label>]`, top findings, and up to 4 sources.
`research_topic`'s executor now calls this directly instead of `createKernelTask()`; its registry
entry's `executionPath` changed from `'kernel_task'` to `'gateway_internal'` to match reality.
`find_opportunities` now tries the DB ranking first (unchanged, still the priority source when
non-empty — D-137) and only calls `dispatchResearch()` with the user's actual goal text as the topic
when the DB is empty; a genuine dispatch failure is the only case that still says research isn't
available, and it names the real reason instead of a canned claim. `planForGoal()`'s research
trigger (`shared/src/operator/index.ts`) was broadened to catch open topic questions that don't
literally say "research" (adds `trends`, `find (the )?(current|latest|out about)`, `what's the
latest/new/happening (in|on|with)` — D-138), checked before the narrower "opportunities for me"
pattern so both routes stay distinct. `AOS_SELF_KNOWLEDGE` in `shared/src/jarvis/index.ts` corrected
to describe the real, now-wired state and the actual remaining condition (TAVILY_API_KEY on
internet-research-service specifically). Added a code comment on `GET /v1/system/integrations`
clarifying its `research.configured` flag reflects gateway-api's own env, not
internet-research-service's (D-139) — the authoritative per-call signal is `sourceMode`.

Verification:
- **New smoke PASS (13/13)** (`scripts/phaseag1-jarvis-research-routing-smoke.mjs`) against the real
  compiled `shared/dist/operator/index.js`: the exact reported failing prompt now routes to
  `research_topic` with the goal text passed through as the topic; literal "research ..." phrasing
  still routes there too; "what's the latest on X" phrasing routes there; "find the best
  opportunities for me" still routes to `find_opportunities` (DB-first, goal text now attached for
  its fallback); four regression checks confirm the broadened regex does not hijack whole-system
  check, restart, UI self-fix, or service-creation goals, which all still route to their original,
  more specific tools; tool registry checks confirm `research_topic.executionPath` is now
  `'gateway_internal'` and both tool descriptions are honest about the real path.
- Regression: `scripts/phasex-operator-runtime-smoke.mjs` **28/28 unchanged** (no scenario in that
  suite intersects the broadened regex, since all of its goals match earlier, more specific
  patterns first). `scripts/phaseag-research-fabric-smoke.mjs` **23/23 unchanged** (the underlying
  `runResearch()`/`WebSearchProvider` logic was not touched this phase). Full local suite re-run:
  19 of 21 smoke scripts pass; the two that don't (`phaseab-personal-smoke.mjs` — 1 pre-existing
  failure in `buildRealityGraph()`'s missing-data listing, unrelated code path never touched this
  session; `phasey-workspace-smoke.mjs` — crashes on `EPERM: operation not permitted, unlink ...` when
  cleaning up a generated temp workspace, a sandbox mount-permission limitation, not a code defect)
  were confirmed unrelated by inspecting their failing assertions and stack traces — neither touches
  `operator/`, `jarvis/`, or `gateway-api`'s research code, and `git diff --stat` for this session
  shows only `shared/src/{operator,jarvis}/index.ts` and `services/gateway-api/src/index.ts` changed.
- `shared` `tsc -p tsconfig.json` clean. `gateway-api` and `internet-research-service`
  `tsc --noEmit` clean. `dashboard-web` not re-typechecked — no UI/response-shape files were touched
  this phase (the fix is entirely in tool routing and dispatch; the `/research` pages' `sourceMode`
  badges added in Phase AG already display whatever `sourceMode` a report carries, regardless of
  which tool triggered the underlying research run).

Honest remaining gaps: the synchronous HTTP dispatch itself
(`dispatchResearch` → `internet-research-service` → Tavily) has not been exercised end-to-end
against a running gateway + internet-research-service + Mongo + a real `TAVILY_API_KEY` in this
sandbox — the fix is verified at the deterministic-routing level (smoke) and by type-checking the
dispatch code, not by an actual live HTTP round-trip. The owner should run the manual test below
after deploying. `GET /v1/system/integrations`'s `research.configured` flag remains cosmetic
(D-139) — it will read `false` unless `TAVILY_API_KEY` is *also* set on gateway-api, even when
internet-research-service is fully working; this is documented, not fixed, since fixing it properly
would mean querying internet-research-service for its own status, a small design change outside
this fix's explicit scope. The two unrelated pre-existing smoke failures noted above remain open.

**Manual verification command (owner, after deploying with `TAVILY_API_KEY` set on
internet-research-service and that service restarted):**
```
curl -sS -X POST "$FACTORY_API_URL/v1/operator/command" \
  -H "content-type: application/json" \
  -H "x-factory-internal-token: $FACTORY_INTERNAL_TOKEN" \
  -d '{"text":"Find current AI lighting design trends in Dubai luxury interiors"}'
```
Or ask Jarvis the same sentence in the dashboard. Expect the reply to contain
`[sourceMode: search_api — live web search (Tavily)]` and real, dated sources — not
"research provider is not_configured". With `TAVILY_API_KEY` unset, expect the same reply shape but
`[sourceMode: llm_only — LLM recall ...]` or `curated_fallback`, never the old hardcoded string.

Scope: `shared/src/{operator/index.ts, jarvis/index.ts}`, `services/gateway-api/src/index.ts`,
`scripts/phaseag1-jarvis-research-routing-smoke.mjs` (new), `.env.example`, `docs/{environment-variables.md,
service-map.md, decision-log.md, phase-log.md}`.

## Phase AG.2 — internet-research-service Reachability — COMPLETE (2026-07-09)

Bug report (owner, live testing immediately after Phase AG.1): the routing fix worked — Jarvis now
tries to call the research fabric — but the real runtime failed with `"research_topic could not
reach its backing service"` / `"Could not reach internet-research-service ... fetch failed"`.

**Root cause.** Not a URL, port, or env-var-naming bug: `peerUrl('internet-research-service')`
already correctly resolves to `http://localhost:4115` (matching `SERVICE_PORTS`), and the service
correctly exposes `/health` and `/.factory/task`. The actual defect was that
`scripts/local-services.mjs` — the single source of truth for both `pnpm dev:all` (which services
actually get *started*) and `pnpm sync:env` (which services get a `.env` file *written*) — never
included `internet-research-service` at all. In local dev, nothing was ever listening on port 4115
and the service never had a `.env` file (its `dev` script requires one via `--env-file=.env`). This
predates Phase AG entirely and was invisible until Phase AG.1 made the dependency synchronous and
loud in the same Jarvis reply. `README-SETUP.md`'s local port table and per-service walkthrough had
the identical, longer-standing gap (and, discovered in the same pass, also never covered
`code-operator-agent` for the same historical reason).

**Fix.**
1. `scripts/local-services.mjs` — added `internet-research-service` (port 4115,
   `@factory/internet-research-service`) to `LOCAL_SERVICES`, renumbering the local roster from 14
   to 15 entries; `code-operator-agent` was already present in the array (so `sync:env` already wrote
   its `.env`) but had never been documented in `README-SETUP.md` — added alongside for consistency.
2. `README-SETUP.md` — added the local port-table row, a full per-service Dokploy walkthrough section
   for `internet-research-service` (with an explicit note on why it must be in `local-services.mjs`),
   a brief section for `code-operator-agent`, and updated the health-check curl block + summary table
   + service counts (13 → 15) accordingly.
3. `shared/src/research/index.ts` — added `classifyResearchFetchFailure()` and
   `interpretResearchTaskResponse()`: pure, exported, unit-testable functions that turn a raw
   `fetch()` failure or HTTP response into one of `service_unreachable | service_error | empty_result
   | provider_not_configured | null`. `provider_not_configured` is `ok: true` — a reachable service
   honestly reporting `sourceMode: 'llm_only'`/`'curated_fallback'` did real work, it isn't a failure,
   and conflating it with "the process is down" was part of what made the original bug report
   ambiguous to diagnose from the reply text alone.
4. `services/gateway-api/src/index.ts` — `dispatchResearch()` now keeps only the network I/O (the
   `fetch()` call itself) and delegates all interpretation to the two new pure helpers; a thrown fetch
   error now produces a message naming the exact URL attempted and the exact local command to start
   the service, instead of a generic "check it is running" hint.

Verification:
- **New smoke PASS (21/21)** (`scripts/phaseag2-research-reachability-smoke.mjs`): confirms
  `internet-research-service` is present in `LOCAL_SERVICES` with the correct port/pkg, all ports/ids
  in the roster are unique (no silent collision from the renumbering), `peerUrl()` resolves the
  correct default and env-override URL, `classifyResearchFetchFailure()` correctly labels
  `fetch failed`/`ECONNREFUSED`/timeout as `service_unreachable` and does NOT mislabel unrelated
  thrown errors, and `interpretResearchTaskResponse()` correctly distinguishes HTTP error /
  empty result / not-configured-but-reachable / real search_api success — including that
  `provider_not_configured` never appears on a real `search_api` response and
  `service_unreachable` never appears on any reachable, well-formed response.
- Regression: `scripts/phaseag1-jarvis-research-routing-smoke.mjs` **13/13 unchanged**,
  `scripts/phaseag-research-fabric-smoke.mjs` **23/23 unchanged**, `scripts/phasex-operator-runtime-smoke.mjs`
  **28/28 unchanged**. Full local suite re-run: same result as Phase AG.1 — 20 of 21 scripts pass,
  the one pre-existing unrelated failure (`phaseab-personal-smoke.mjs`) unchanged.
- `shared` `tsc -p tsconfig.json` clean. `gateway-api` and `internet-research-service`
  `tsc --noEmit` clean. `scripts/local-services.mjs` validated by importing it directly with
  `node -e "import(...)"` and confirming all 15 entries resolve with correct num/id/port ordering.
- Live end-to-end reachability (an actual HTTP round-trip from a running gateway-api to a running
  internet-research-service) was **not** exercised here — this sandbox has no persistent server
  processes and is isolated from the owner's real dev machine. Verification is at the pure-logic
  level (URL construction, error classification) plus static confirmation of the service-catalog
  fix; the owner must run the manual commands below to confirm the live fix.

Honest remaining gaps: this sandbox cannot start real services or hold open ports across tool calls,
so the actual "curl the health endpoint" and "ask Jarvis and see a real reply" steps have not been
run by this session — only their pure-logic preconditions have been proven correct. The Dokploy
production side was not touched (its deployment doc, `deployment/dokploy/internet-research-service.md`,
already existed and already listed the service correctly — this was purely a local-dev-tooling gap).
`docs/roadmap.md`'s existing item about feeding research into daily briefing/opportunity scoring
remains open and unrelated to this fix.

**Manual verification (owner, on the real machine):**
```bash
# 1) Make sure the catalog fix is picked up and every service (including
#    internet-research-service) gets its .env:
pnpm sync:env

# 2) Start everything (internet-research-service is now included):
pnpm dev:all

# 3) Confirm the service itself is up:
curl http://localhost:4115/health

# 4) Confirm the task endpoint works directly (bypassing Jarvis):
curl -X POST http://localhost:4115/.factory/task \
  -H "content-type: application/json" \
  -H "x-factory-internal-token: $FACTORY_INTERNAL_TOKEN" \
  -d '{"taskId":"manual_test_1","goal":"AI lighting design trends in Dubai luxury interiors","input":{"topic":"AI lighting design trends in Dubai luxury interiors"}}'

# 5) Ask Jarvis the original prompt:
curl -X POST http://localhost:4101/v1/operator/command \
  -H "content-type: application/json" \
  -H "x-factory-internal-token: $FACTORY_INTERNAL_TOKEN" \
  -d '{"text":"Find current AI lighting design trends in Dubai luxury interiors"}'
```
Expected: no "fetch failed"/"could not reach its backing service". With a valid `TAVILY_API_KEY` set
on `internet-research-service`'s own `.env` (already present there from an earlier manual setup —
confirm it wasn't overwritten empty by `sync:env`, since the root `.env` also already carries a real
key), the reply should contain `[sourceMode: search_api — live web search (Tavily)]` with real,
dated sources. If the key is missing or invalid, expect `[sourceMode: llm_only — ...]` or
`curated_fallback` — never the old generic fetch error.

Scope: `scripts/local-services.mjs`, `README-SETUP.md`, `shared/src/research/index.ts`,
`services/gateway-api/src/index.ts`, `scripts/phaseag2-research-reachability-smoke.mjs` (new),
`docs/{decision-log.md, phase-log.md}`.

## Phase AG.3 — Research Synthesis Quality & Stale Last-Operation Fix — COMPLETE (2026-07-09)

Bug report (owner, live testing immediately after Phase AG.2): Tavily is reachable and live search
works (`sourceMode: search_api`, 6 real results) — but the reply is just raw titles/snippets with
`"No LLM synthesis was performed this run (deterministic fallback)"`, not a synthesized research
answer. Separately, the Jarvis shell kept showing a prior FAILED operation at the top even after a
newer operation completed successfully — a stale last-operation display.

**1. Why synthesis did not run.** Two independent, real defects in `LlmRouter.generateStructured()`
(`shared/src/llm/index.ts`), not a `runResearch()` design gap (`runResearch()`'s grounded prompt
already correctly asked for real synthesis over the retrieved Tavily snippets):
- The retry loop's `catch` swallowed every thrown error and every schema-validation mismatch with no
  record kept — the trace only ever said `usedFallback: true`, giving the caller no way to tell "the
  provider call actually failed" apart from "no provider is configured at all."
- Every `provider.complete()` call used the historical default `maxTokens: 1024`, which is tight for
  a research completion that must echo metadata for up to 6 sources plus produce a summary, 5-7
  findings and recommendations — a truncated completion becomes invalid JSON, which schema-validates
  as a failure and falls back exactly like "no LLM" from the outside, with zero visible signal that a
  real call actually ran and produced content.

**2. What was missing/wrong.** Nothing was missing from `internet-research-service`'s LLM env — it
receives the same `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`LLM_DEFAULT_PROVIDER` as every other agent via
the standard `sync-local-env.mjs` pipeline (confirmed present and in sync). The gap was entirely in
the router's error handling and token budget, not configuration.

**3. How synthesis now works.**
- `shared/src/schemas/capability.ts` — `LlmTraceSchema` gained `errorDetail: string | null`: the exact
  reason (thrown error message, or which schema field failed validation) the last attempt didn't
  produce valid data. Null when there was nothing to fail (fallback forced, or no provider configured).
- `shared/src/llm/index.ts` — `generateStructured()` now captures this into `lastError` on every retry
  and persists it as `trace.errorDetail`; `GenerateStructuredOpts` gained `maxTokens?: number`, threaded
  through to `provider.complete()`.
- `shared/src/intelligence/index.ts` — `runResearch()` now passes `maxTokens: 3072` for the research
  completion, and derives `synthesisMode: 'llm_synthesized' | 'deterministic_fallback'` from
  `trace.usedFallback`, with `synthesisFailureReason` populated from `trace.errorDetail` (falling back
  to an explicit "no LLM provider configured" or "forced fallback mode" message when `errorDetail` is
  itself null, i.e. no provider was even attempted). When synthesis fell back but the run was grounded
  in real search results, the report `summary` is now built explicitly around the real reason (e.g.
  *"LLM synthesis did NOT run this call — openai call failed (attempt 2): 429 rate limited"*) instead
  of the old generic, undifferentiated "(deterministic fallback)" phrase.
- `shared/src/schemas/intelligence.ts` — `ResearchSynthesisModeSchema` (new) plus `synthesisMode` and
  `synthesisFailureReason` fields added to both `ResearchReportSchema` and `ResearchRunSchema`
  (backward-compatible `.default()`s, same pattern as Phase AG's `sourceMode`).
- `shared/src/llm/prompts.ts` — `internet-research-service:research` bumped v1 → v2: the system prompt
  now explicitly instructs the model to *reason over* grounded search results (executive summary,
  5-7 concrete findings/trends explaining *why they matter*, and opportunity/next-action
  recommendations when the topic implies a business angle) rather than restate titles/snippets, while
  keeping the existing hard rule that source URLs in its JSON output are echoed back only to be
  discarded — `runResearch()` still rebuilds the authoritative source list structurally from the real
  Tavily results (Phase AG's URL-integrity guarantee is unchanged and re-verified below). No
  business-specific content (e.g. a named client or industry) was hardcoded into the prompt — there is
  no real captured profile data to ground that, and inventing it would violate the project's "never
  invent" principle; the prompt asks for a *generic* opportunity/next-action framing instead.
- `shared/src/research/index.ts` / `services/internet-research-service/src/index.ts` — `synthesisMode`
  and `synthesisFailureReason` are threaded through `ResearchTaskPayload`, the service's task-handler
  response, `finishAgentRun`'s summary, and the `RESEARCH_COMPLETED_V2` event payload.
  `interpretResearchTaskResponse()` (the gateway-side pure interpreter) now embeds a `[synthesisMode:
  ...]` tag and the real failure reason in the summary it returns to Jarvis/operator callers, alongside
  the existing `[sourceMode: ...]` tag — the two are reported independently, so real Tavily sources with
  failed synthesis is never collapsed into either "complete success" or "service failure."

**4. How sources remain Tavily-only.** Unchanged from Phase AG and re-verified in the new smoke suite:
`runResearch()` always rebuilds `ResearchSource[]` structurally from the raw `WebSearchResult[]` Tavily
actually returned, never from the LLM's echoed `sources` field in its structured output — a
hallucinated/mistyped URL from the model cannot enter the source list regardless of synthesis outcome.

**5. How fallback is reported.** `synthesisMode: 'deterministic_fallback'` is now always paired with a
non-null, specific `synthesisFailureReason` whenever a real provider was configured and attempted (the
actual thrown error or schema-validation mismatch); when no provider is configured at all, the reason
says so explicitly instead of leaving the caller to infer it from an absent field. The result is never
described as "research" without qualification — the summary text itself states the real reason inline.

**6. How stale last-operation was fixed.** Two-part fix, matching the two failure modes identified:
- `services/gateway-api/src/index.ts` `runLoop()` had two early-`break` exit paths (a critical-category
  tool failure, and a thrown exception mid-step) that set `session.status = 'failed'` but never set
  `session.completedAt` — only the "reached the natural end of the plan" path did. Any session that
  failed via one of these two paths therefore persisted with `completedAt: null` forever. Both paths now
  set `session.completedAt = nowIso()` alongside `status`.
- `shared/src/operator/index.ts` gained `sortRecentSessions()`: a pure, exported, unit-tested helper
  that ranks sessions by `completedAt ?? startedAt` descending, with a real (non-null) `completedAt`
  winning any exact tie over one still null — a deterministic guarantee independent of Mongo's sort
  behavior on nulls or of the `completedAt`-never-set bug above (defense in depth: the root cause is
  fixed AND the ordering can no longer be wrong even if some other path leaves `completedAt` unset in
  the future). `/v1/operator/live-state`'s `recentSessions` query gained a secondary `startedAt: -1`
  Mongo-level sort tiebreaker, and the returned array is now passed through `sortRecentSessions()`
  before being used to compute `headline`/`activeOperationSummary` and returned to the client — so
  `OperatorConsole`, `ActiveOperationsPanel` and any other consumer of `recentSessions[0]` all agree on
  what "last operation" means, and a failed session can never stay pinned above a newer completed one.

**7. Files changed:** `shared/src/schemas/capability.ts`, `shared/src/llm/index.ts`,
`shared/src/llm/prompts.ts`, `shared/src/schemas/intelligence.ts`, `shared/src/intelligence/index.ts`,
`shared/src/research/index.ts`, `shared/src/operator/index.ts`, `services/internet-research-service/src/index.ts`,
`services/gateway-api/src/index.ts`, `scripts/phaseag3-research-synthesis-smoke.mjs` (new),
`docs/{phase-log.md, decision-log.md}`.

**8. Tests run:**
- **New smoke PASS (32/32)** (`scripts/phaseag3-research-synthesis-smoke.mjs`): real search results +
  working LLM → `llm_synthesized` with real synthesized prose; real search results + no provider
  configured → `deterministic_fallback` with the explicit "no provider configured" reason embedded in
  both `synthesisFailureReason` and the summary text; real search results + a genuine provider error
  (e.g. rate limit) → that exact error surfaced, not a generic message; hallucinated LLM source URL
  still structurally cannot enter `sources` (Phase AG guarantee re-verified post-AG.3); `sourceMode`
  and `synthesisMode` both preserved end-to-end through `interpretResearchTaskResponse()` including a
  backward-compat check for legacy payloads without the new fields; `sortRecentSessions()` — newest
  completed session always sorts first regardless of input order, a null-`completedAt` session (the
  historical bug) never outranks a real newer completed one, two null-`completedAt` sessions fall back
  to `startedAt`, and an exact effective-time tie is broken in favor of the session with a real
  `completedAt`; `LlmRouter.generateStructured()` against a real router instance with its provider
  swapped for an offline fake — confirms `errorDetail` captures a thrown error verbatim and separately
  distinguishes a schema-validation failure, proving the fix is in the actual retry loop, not just the
  type signature.
- Regression, all unchanged: `scripts/phaseag-research-fabric-smoke.mjs` **23/23**,
  `scripts/phaseag1-jarvis-research-routing-smoke.mjs` **13/13**,
  `scripts/phaseag2-research-reachability-smoke.mjs` **21/21**. Full local suite re-run: same two
  pre-existing, unrelated results as Phase AG.2 — `phaseab-personal-smoke.mjs` (1 failure, personal
  reality baseline, untouched by this phase) and `phasey-workspace-smoke.mjs` (crashes on an `EPERM`
  unlinking a prior smoke-test scratch workspace — a sandbox filesystem-mount limitation, not a code
  defect; see the existing memory note on this).
- `shared` `tsc -p tsconfig.json` clean. `gateway-api`, `internet-research-service` and `dashboard-web`
  `tsc --noEmit` all clean.

**9. Manual test the owner should run** (mirrors Phase AG.2's block, extended):
```bash
pnpm sync:env && pnpm dev:all
curl -X POST http://localhost:4101/v1/operator/command \
  -H "content-type: application/json" \
  -H "x-factory-internal-token: $FACTORY_INTERNAL_TOKEN" \
  -d '{"text":"Find current AI lighting design trends in Dubai luxury interiors"}'
```
Expected with a valid `TAVILY_API_KEY` and a valid `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`: a real
executive summary, 5-7 findings explaining *why* each trend matters, opportunity/next-action
recommendations, real Tavily source URLs, and `[sourceMode: search_api ...] [synthesisMode:
llm_synthesized ...]` in the reply. If the LLM key is missing/invalid/rate-limited, expect
`[synthesisMode: deterministic_fallback — ...]` with the *specific* reason inline (not a bare
"deterministic fallback" tag), while `[sourceMode: search_api ...]` and the real source URLs remain
correct either way. Separately: trigger one operation that fails (e.g. a goal routing to a
not-configured tool) followed by one that completes successfully, then reload the Jarvis shell —
the completed operation should show as the last operation, not the earlier failure.

**10. Remaining gaps:** as with Phase AG.2, this sandbox cannot hold open server processes or make
live calls against the owner's real API keys, so the manual block above has not been executed by this
session — verification here is at the pure-logic/unit level against the real compiled code, with fake
router/provider objects standing in for actual network calls (consistent with this project's standing
practice of never spending the owner's real API credits from the sandbox). The v2 prompt's request for
"opportunity/next-action recommendations when the topic implies a business angle" is a prompting
instruction, not a code-level guarantee — its real-world quality depends on the model's actual output
and can only be fully judged against a live call. The two pre-existing regressions noted in item 8 are
unrelated to this phase's scope and were not investigated further here.

Scope: `shared/src/{schemas/capability.ts, llm/index.ts, llm/prompts.ts, schemas/intelligence.ts,
intelligence/index.ts, research/index.ts, operator/index.ts}`, `services/internet-research-service/src/index.ts`,
`services/gateway-api/src/index.ts`, `scripts/phaseag3-research-synthesis-smoke.mjs` (new),
`docs/{decision-log.md, phase-log.md}`.

## Phase AG.4 — Research Route/Host Contract Fix — COMPLETE (2026-07-09)

Bug report (owner, live testing immediately after Phase AG.3): research is reachable, but
`research_topic` now fails with `"internet-research-service returned 404: unknown error"` for the same
prompt that previously worked through to the synthesis-quality bug. Reachable but 404 rules out the
Phase AG.2 class of bug (that was DNS/connection-level unreachability); this is a route/host contract
mismatch.

**Root cause.** `internet-research-service` correctly registers `POST /.factory/task` (via
`createFactoryService({ taskHandler: handleTask })`, the same standard path/mechanism every other
service uses — confirmed no route or contract gap on the service side, and confirmed `pnpm dev:all`
runs `tsx src/index.ts` directly against source, not a stale `dist` build, so it is always current).
The actual defect was in gateway-api's `dispatchResearch()`: `const url = svc?.domain ?? peerUrl(...)`.
`svc` comes from `ctx.registry.resolve('internet-research-service')`, which returns the service's raw,
self-registered manifest — and every service's manifest hardcodes its **production** subdomain
(`domain: https://research.simorx.com`, derived from `SERVICE_SUBDOMAINS`/`ROOT_DOMAIN = 'simorx.com'`
in `shared/src/constants/index.ts`) regardless of environment. In local dev, `SERVICE_REGISTRY_URL` is
set to `http://localhost:4108` and service-registry runs locally, so every service — including
`internet-research-service`, which only started registering successfully for the first time after
Phase AG.2 added it to `LOCAL_SERVICES` — self-registers into the LOCAL registry with that same
hardcoded production `domain` field. `ctx.registry.resolve()` therefore returns a truthy `svc.domain`
(`https://research.simorx.com`), which wins the `??` and is used verbatim, completely bypassing
`peerUrl()`'s correct `http://localhost:4115` fallback. `https://research.simorx.com` is the owner's
real root domain (`simorx.com`), which resolves and answers HTTP requests, just not with this service
or route — producing exactly "reachable... 404... unknown error" (no `error.message` in whatever body
that host actually returned, which `interpretResearchTaskResponse()` previously reported generically).
This same `svc?.domain ?? peerUrl(...)` pattern exists at 6 other call sites in gateway-api
(orchestrator-agent ×4, monitor-agent ×2) — those are fire-and-forget/`try`-swallowed today, so the
identical bug degrades silently there rather than surfacing in a user-visible reply; flagged below as a
remaining gap, not fixed here (out of the requested scope).

**Fix.**
1. `shared/src/discovery/index.ts` — new exported, pure `resolvePeerUrl(serviceId, registryDomain, env)`:
   an explicit env override (`<SERVICE_ID>_URL`) always wins first (this is how local dev pins a peer to
   localhost even though the registry has a — correct-for-production — manifest record); the
   registry-resolved domain is used next (correct in production, where that DNS is real); `peerUrl()`'s
   own localhost default is the final fallback (registry unreachable / peer not yet registered).
2. `services/gateway-api/src/index.ts` `dispatchResearch()` — now calls
   `resolvePeerUrl('internet-research-service', svc?.domain)` instead of `svc?.domain ?? peerUrl(...)`.
3. `scripts/local-services.mjs` — gateway-api's `extra` env block gained
   `INTERNET_RESEARCH_SERVICE_URL=http://localhost:4115`, the exact same override mechanism already
   used for `ORCHESTRATOR_AGENT_URL` (which — per the same root cause — has almost certainly been
   silently relying on this exact pattern to work at all). `scripts/sync-local-env.mjs`'s shared-env
   filter list gained `INTERNET_RESEARCH_SERVICE_URL=` for consistency with the other peer-URL entries
   already filtered there.
4. `shared/src/research/index.ts` `interpretResearchTaskResponse()` — gained a new `errorKind:
   'route_not_found'`, returned specifically for HTTP 404/405 (a request that reached *some* server but
   found no matching route/method — a contract bug, distinct from a generic 5xx `service_error`), plus
   an optional 4th `meta: { url, method, rawBodySnippet }` parameter so the returned summary now states
   the exact URL/method dispatched and, when the response body wasn't valid JSON (e.g. an HTML 404
   page — exactly what a misrouted host like this returns), a snippet of the actual raw content instead
   of the previous bare, undiagnosable "unknown error". `dispatchResearch()` now reads `r.text()` first
   and passes it through as `rawBodySnippet` alongside the parsed-JSON attempt.

Verification:
- **New smoke PASS (25/25)** (`scripts/phaseag4-research-route-contract-smoke.mjs`): confirms the
  manifest domain really is the real, env-independent production subdomain (not a placeholder);
  `resolvePeerUrl()`'s exact precedence in all four combinations of {override set/unset} × {registry
  domain present/absent}, including trailing-slash normalization; `scripts/local-services.mjs`'s
  gateway-api entry actually carries the new override without regressing the pre-existing
  `ORCHESTRATOR_AGENT_URL` one; `interpretResearchTaskResponse()` classifies 404 and 405 as
  `route_not_found` (not `service_error`), embeds the real URL/method/raw-body-snippet in the summary,
  and never falls back to the bare "unknown error" when any diagnostic context is available; a 3-arg
  legacy call (no `meta`) still works without crashing; 500 remains `service_error` (regression check —
  only 404/405 are route-contract issues); the full `sourceMode`/`synthesisMode` success path from
  Phase AG.3 is unaffected by the new 4th parameter.
- Regression, all unchanged: `scripts/phaseag-research-fabric-smoke.mjs` **23/23**,
  `scripts/phaseag1-jarvis-research-routing-smoke.mjs` **13/13**,
  `scripts/phaseag2-research-reachability-smoke.mjs` **21/21**,
  `scripts/phaseag3-research-synthesis-smoke.mjs` **32/32**. `phaseab-personal-smoke.mjs`'s one
  pre-existing, unrelated failure is unchanged from Phase AG.2/AG.3.
- `shared` `tsc -p tsconfig.json` clean. `gateway-api` and `internet-research-service` `tsc --noEmit`
  clean. `dashboard-web`'s `tsc --noEmit` fails, but only inside `.next/dev/types/{routes.d.ts,
  validator.ts}` — a gitignored, auto-generated Next.js type-cache file, truncated mid-write by an
  earlier interrupted dev process in this sandbox, unrelated to any source file this phase (or Phase
  AG.3) touched (confirmed: dashboard-web's `src/` has zero references to `resolvePeerUrl`/`peerUrl`/
  `discovery`). Attempting to delete `.next` to force a clean regeneration failed with the same sandbox
  `EPERM` limitation on this mounted folder noted in Phase AG.3's report and in memory — a known
  environment constraint, not a code defect.

Honest remaining gaps: the identical `svc?.domain ?? peerUrl(...)` pattern (same root cause) exists at
6 other gateway-api call sites for `orchestrator-agent` (×4) and `monitor-agent` (×2) — not fixed here,
since the reported bug and requested scope were specifically the research route. Those paths are
fire-and-forget with swallowed errors today, so the same production-domain-in-local-dev mismatch would
degrade silently (a task "remains queued" / a monitor call quietly no-ops) rather than surfacing loudly
like research's synchronous dispatch did — worth a follow-up phase applying `resolvePeerUrl()` there
too, plus adding the matching `<SERVICE>_URL` local overrides to `scripts/local-services.mjs` for
`orchestrator-agent` (`monitor-agent` already has no local override entry either). This sandbox cannot
hold open server processes or make a live end-to-end call, so the manual commands below have not been
executed by this session — verification here is at the pure-logic/unit level against the real compiled
code and the real `LOCAL_SERVICES`/manifest data, not a live HTTP round-trip.

**Manual verification (owner, on the real machine):**
```bash
# 1) Pick up the new INTERNET_RESEARCH_SERVICE_URL override and restart:
pnpm sync:env && pnpm dev:all

# 2) Confirm the service itself is up:
curl http://localhost:4115/health

# 3) Confirm the task endpoint now returns 200 directly:
curl -i -X POST http://localhost:4115/.factory/task \
  -H "content-type: application/json" \
  -d '{"goal":"Find current AI lighting design trends in Dubai luxury interiors"}'

# 4) Confirm Jarvis no longer gets a 404:
curl -X POST http://localhost:4101/v1/operator/command \
  -H "content-type: application/json" \
  -H "x-factory-internal-token: $FACTORY_INTERNAL_TOKEN" \
  -d '{"text":"Find current AI lighting design trends in Dubai luxury interiors"}'
```
Expected: no `404`/`"unknown error"`. Either a real `sourceMode: search_api` result with
`synthesisMode: llm_synthesized` (or an explicit `synthesisFailureReason` if the LLM call itself fails —
Phase AG.3's concern, unrelated to this fix), or an honest `provider_not_configured` message if
`TAVILY_API_KEY` is genuinely missing — never a route/contract error again for this endpoint.

Scope: `shared/src/discovery/index.ts`, `shared/src/research/index.ts`,
`services/gateway-api/src/index.ts`, `scripts/local-services.mjs`, `scripts/sync-local-env.mjs`,
`scripts/phaseag4-research-route-contract-smoke.mjs` (new), `docs/{decision-log.md, phase-log.md}`.

## Phase AG.5 — Research LLM Output Schema/Prompt/Retry-Repair Fix — COMPLETE (2026-07-09)

Bug report (owner, live testing immediately after Phase AG.4): routing works, Tavily returns 6 real
results (`sourceMode: search_api`), the Jarvis session completes — but LLM synthesis itself fails:
`"provider responded but output did not match the expected schema (attempt 2): Invalid input: expected
string, received undefined"`.

**1. Exact schema field/path that caused the failure.** Not directly observable from the pre-fix error
text (that was the bug — `generateStructured()` only ever surfaced `parsed.error.issues[0]?.message`,
never `.path`), but reconstructed with high confidence from the schema and prompt as of Phase AG.3: the
old `LlmResearchSchema.findings` was `z.array(z.string()).min(1)` — a flat string array — while the
Phase AG.3 v2 system prompt explicitly asked the model to produce "5-7 concrete key findings/trends
explaining what they mean and why they matter" and "opportunity or next-action recommendations," and
never once stated the literal required JSON key names. A real model, given content instructions richer
than the schema's flat shape, naturally nested its findings into objects (`{title, detail, ...}`) or
introduced additional narrative keys the schema didn't recognize; whichever exact sub-field was
involved, the net effect was the same class of failure: a real, substantive response that didn't
literally match `findings: string[]`. This is now impossible to reproduce with as little diagnostic
information — see fix item 4 below.

**2. Why the LLM output missed it.** The prompt described desired CONTENT ("produce a concise summary,
findings, and recommendations... reason over retrieved results") but never gave the model an explicit
JSON shape with exact field names — `JSON_ONLY`'s "Respond ONLY with valid JSON matching the requested
schema" refers to a schema the model was never actually shown. Once Phase AG.3 made the content
requirements richer (findings that explain *why* they matter; opportunity/next-action framing) without
updating the literal output shape to match, the prompt and the schema fell out of sync — the model was
asked for something the schema no longer had room for.

**3/4. Fix applied.**
- `shared/src/intelligence/index.ts` — `LlmResearchSchema.findings` redesigned to
  `LlmFindingSchema[]` (`title`, `detail` always required — no valid finding can lack real content;
  `whyItMatters`/`confidence`/`sourceIndexes` default safely when the model genuinely has nothing to
  add). New `opportunities: LlmOpportunitySchema[]` (`title`/`action` required, `rationale` defaulted),
  `nextActions: string[]`, `limitations: string[]` — directly matching what the v2 prompt was already
  asking for. `recommendations` was removed from the LLM-facing schema entirely (the model no longer
  needs to separately produce it — see flattening below). Both deterministic fallback functions
  (`fallbackResearch`, `fallbackFromSearchResults`) were updated to the new shape so `schema.parse(opts.fallback())`
  — which validates the fallback exactly like a real response — still succeeds.
- `shared/src/intelligence/index.ts` `runResearch()` — the per-call `prompt:` text now includes an
  explicit `SHAPE_EXAMPLE`: literal JSON with exact field names, required-vs-optional guidance ("for
  any narrative field you're unsure of, write a short honest string... rather than omitting the key"),
  and a request for 5-7 findings. Placed in the request-specific prompt (not the versioned system
  prompt in `prompts.ts`) so it stays colocated with, and can't silently drift from, the Zod schema
  that actually validates it.
- `shared/src/llm/index.ts` `generateStructured()` — the Zod validation-failure branch now reports the
  **failing field path** (`issue.path.join('.')`, e.g. `"findings.0.detail"`), not just the bare Zod
  message, in both the trace's `errorDetail` and a new **retry corrective note** appended to the prompt
  on the next attempt: `"Your previous response was invalid... the field at \"{path}\" was wrong or
  missing: {message}. Respond again with ONLY corrected, complete JSON..."`. Previously attempt 2 sent
  the model the byte-identical prompt as attempt 1, so a model that misunderstood the shape once
  reliably failed the same way twice — this is the concrete answer to "does attempt 2 receive the
  validation error and schema correction instruction:" it did not before, it does now.
- `shared/src/intelligence/index.ts` — `ResearchReport.findings`/`.recommendations` (the STORED/PUBLIC
  contract every downstream consumer reads — Jarvis summary text, `ResearchTaskPayload`, the dashboard,
  AG.2-AG.4 smoke tests) remain flat `string[]`, completely unaffected by the richer LLM-facing schema:
  new `flattenFindings()`/`flattenRecommendations()` helpers flatten
  `{title, detail, whyItMatters}` → `"title: detail (Why it matters: whyItMatters)"` and
  `opportunities + nextActions` → a single recommendations list; `limitations` are appended to findings
  as `"Limitation: ..."` entries rather than being silently dropped.

**5. How sources remain Tavily-only.** Completely unchanged and re-verified: `runResearch()` still
always rebuilds `ResearchSource[]` structurally from the raw `WebSearchResult[]` Tavily returned, never
from the LLM's echoed `sources` field, regardless of the findings/opportunities schema change — a new
smoke test explicitly injects an attacker URL into the LLM's fake `sources` output and confirms it
never reaches the stored sources.

Verification:
- **New smoke PASS (22/22)** (`scripts/phaseag5-research-schema-repair-smoke.mjs`): the EXACT reported
  prompt ("Find current AI lighting design trends in Dubai luxury interiors") produces a valid
  `synthesisMode: llm_synthesized` structure with flattened why-it-matters findings, flattened
  opportunity/next-action recommendations, and flattened limitations; a fake provider that omits a
  required `findings[0].detail` on attempt 1 is repaired on attempt 2 once the retry corrective note is
  present (and the test explicitly asserts the model would NOT self-correct without that note reaching
  the prompt); `errorDetail` names the exact failing path (`findings.0.detail`) instead of a bare
  generic message; missing OPTIONAL fields (`whyItMatters`, `confidence`, `sourceIndexes`,
  `opportunities`, `nextActions`, `limitations`, and optional `sources[]` sub-fields) never break
  synthesis and never leak a literal `"undefined"` into report text; an LLM-injected source URL still
  cannot enter `sources`; deterministic fallback still activates (after exhausting `maxAttempts`) when
  the model's output is genuinely unrecoverable JSON, with `sourceMode` staying `search_api` throughout.
- Regression, all unchanged: `scripts/phaseag-research-fabric-smoke.mjs` **23/23** (fixture updated to
  the new structured-findings shape — assertions unchanged), `scripts/phaseag1-jarvis-research-routing-smoke.mjs`
  **13/13**, `scripts/phaseag2-research-reachability-smoke.mjs` **21/21**,
  `scripts/phaseag3-research-synthesis-smoke.mjs` **32/32** (fixtures updated the same way),
  `scripts/phaseag4-research-route-contract-smoke.mjs` **25/25**. `phaseab-personal-smoke.mjs`'s one
  pre-existing, unrelated failure is unchanged.
- `shared` `tsc -p tsconfig.json`, `gateway-api` and `internet-research-service` `tsc --noEmit` all
  clean (verified with real exit-code capture this time, not piped through `tail`, after an earlier
  pipe-masking mistake in Phase AG.3/AG.4's verification steps was caught during this phase).

**Secondary — stale "Last operation ... failed" shell text.** Investigated per the report. The
Phase AG.3 fix (`sortRecentSessions()` applied server-side to `/v1/operator/live-state`, plus
`completedAt` set on every `runLoop()` exit path) is still the correct, complete fix for the
server-side ordering bug and was not touched again here — no new server-side bug was found.
`OperatorConsole.tsx`'s "Last operation: ..." text is written by a `useEffect` that runs exactly ONCE
on component mount (guarded by `if (log.length > 0) return`) and never re-syncs afterward, including
across soft (SPA) navigation — this is a deliberate one-time chat-transcript seed, not a live status
widget, so it will only reflect current server state on a genuine fresh mount (hard reload / first
load), not indefinitely. If this text is still stale after both a hard reload AND confirming the
Phase AG.3 fix is actually deployed/running (this sandbox cannot verify a live process was restarted),
it points at the running dashboard-web/gateway-api processes not yet running Phase AG.3's build rather
than a remaining code defect — no further server-side issue was found in this investigation.

Honest remaining gaps: no live LLM call was made from this sandbox (same standing constraint as every
prior AG.x phase) — verification is at the pure-logic/unit level against the real compiled code with a
fake provider that reproduces the exact reported Zod error text and confirms the repair path. The
prompt's `SHAPE_EXAMPLE` improves the odds of first-attempt-valid output substantially but cannot
*guarantee* a real model never produces an unexpected shape; the retry-repair path exists precisely
because that guarantee isn't structurally possible with a probabilistic model — attempt 2's corrective
feedback is the actual safety net now, not just optimistic hope that attempt 1 succeeds.

**Manual verification (owner, on the real machine):**
```bash
pnpm sync:env && pnpm dev:all
curl -X POST http://localhost:4101/v1/operator/command \
  -H "content-type: application/json" \
  -H "x-factory-internal-token: $FACTORY_INTERNAL_TOKEN" \
  -d '{"text":"Find current AI lighting design trends in Dubai luxury interiors"}'
```
Expected: `sourceMode: search_api`, `synthesisMode: llm_synthesized`, a real executive summary, 5-7
findings with why-it-matters framing, and opportunity/next-action recommendations — no schema
validation failure. If the LLM still fails on both attempts (e.g. a genuinely unusual model response),
expect `synthesisMode: deterministic_fallback` with the specific repaired-but-still-failing reason
inline (Phase AG.3's guarantee), never a bare, undiagnosable error.

Scope: `shared/src/intelligence/index.ts`, `shared/src/llm/index.ts`,
`scripts/{phaseag-research-fabric-smoke.mjs, phaseag3-research-synthesis-smoke.mjs}` (fixtures updated),
`scripts/phaseag5-research-schema-repair-smoke.mjs` (new), `docs/{decision-log.md, phase-log.md}`.

## Phase AH — Premium Body Intelligence Map — COMPLETE (2026-07-10)

**Goal (owner report):** the Health zone's body visual read as a placeholder stickman —
6 line strokes with floating dots — unacceptable for the Living AI Government standard. Replace it
with a premium biometric-scan visualization: anatomical silhouette, semantic body regions, metrics
attached to meaningful zones, calm concern signaling, dark-glass luxury aesthetic.

**What was built:**

1. **`src/lib/bodyZones.ts` (new, JSX-free)** — pure zone-mapping logic: 7 semantic zones
   (`head`, `chest`, `abdomen`, `arms`, `legs`, `body`, `recovery`), an exact + keyword-fallback
   metric→zone table (energy/heart/hrv→chest, stress/focus→head, sleep→recovery orbit,
   nutrition/digestion→abdomen, activity/steps→legs, strength/mobility/habit→arms,
   weight/wellbeing/symptom→whole body, unknown→whole body so nothing is ever dropped),
   `buildZoneModel()` (per-zone active/concern/worst-level; every zone always exists → stable
   geometry, no hydration divergence) and `zoneTone()` (concern→err, level<4→warn, else ok).
   JSX-free by design so the smoke test compiles and exercises it standalone (AF.2 pattern).

2. **`BodyMap.tsx` rebuilt** — hand-tuned anatomical silhouette (front-facing cubic-bezier path,
   believable shoulder/waist/hip proportions, arms slightly apart from the torso), translucent
   accent→ok gradient fill with soft glow outline, concentric dashed biometric rings, dotted central
   biometric axis, and a recovery orbit around the head for sleep/rest. Per-zone markers (breathing
   core dot + soft ring) with leader-line labels in two clean columns (metric name + value); dormant
   zones render faint anchor points, never invented data. Concerns get a slow `bm-pulse` attention
   ring in the err tone plus a quiet top-left concern counter — signal, not alarm. Hover hotspots
   per region (whole-body path lowest hit priority) drive a highlight halo + a bottom status line;
   zero-metric state shows an intentional "Awaiting biometric signals" caption instead of a broken
   empty figure. Pure inline SVG, zero dependencies, CSS-only motion (`bm-pulse`/`bm-breathe` added
   to globals.css), static ids/geometry only (no hydration risk), accessible region labels.
   Geometry was verified visually (SVG→PNG render) before finalizing.

3. **Both surfaces upgraded at once** — `/health` (DomainRoom overview) and the homepage health
   card (HomeLive → UniverseZone) already rendered this same component; the existing `BodyMetric`
   data contract was kept, so no consumer changed.

**Verification:** `scripts/phaseah-premium-bodymap-smoke.mjs` (new, 33 checks) — old stickman
primitives gone; semantic data-zone regions present; metric→zone mapping correct incl. keyword
fallback and unknown→body; concern state distinct (model + bm-pulse ring + counter); zero/one/many
metric behavior (same-zone stacking, worst-level, warn tone); both surfaces import the same visual;
hydration safety (no Math.random/Date, static ids). Plus dashboard-web `tsc --noEmit` and the AF.2
domain-canvas + AF.5 domain-rooms regression smokes.

Scope: `services/dashboard-web/src/{components/BodyMap.tsx, lib/bodyZones.ts (new), app/globals.css}`,
`scripts/phaseah-premium-bodymap-smoke.mjs` (new), `docs/{phase-log.md, decision-log.md, roadmap.md}`.

## Phase AH.2 — Health Intelligence Surface — COMPLETE (2026-07-10)

**Goal (owner report):** Phase AH's silhouette was cleaner than the stickman but still read as a
decorative outline — anatomy too generic, no meaningful segmentation, too few body domains, no
severity grading, and no architecture for future health data. Rebuild it as a serious, scalable
health intelligence system, not a body picture.

**What was built:**

1. **Health Domain Model (`src/lib/bodyZones.ts`, rewritten)** — the surface is now data-first:
   - **14 anatomical regions:** hair/scalp, mind, vision (eyes), hearing (ears), dental (mouth),
     neck/throat/thyroid, heart & lungs (chest), digestion (abdomen), liver & gut, spine & posture,
     arms & hands, hips & pelvis, legs & knees, feet.
   - **6 systemic layers** for cross-body intelligence that must never be faked as an organ dot:
     sleep & recovery, stress & nervous system, movement & activity (incl. habits), body
     composition (weight/BMI/fat/muscle), energy & hormones, and a `general` whole-body layer.
     Unknown metrics land in `general` — nothing is ever dropped or invented.
   - **Graded severity**, not binary: critical (concern + level≤3) / attention (concern, or
     level<4) / moderate (4–6) / optimal (≥7) / noted (report without a level), each with one
     theme color. Domains inherit their worst metric's severity.
   - `buildHealthModel()` returns per-domain states plus derived-only aggregates (signal count,
     active domains worst-first, concern count, mean level). ~90 metric keywords map into the
     20 domains with exact + keyword fallback. JSX-free for standalone smoke compilation.

2. **`components/health/BodyScan.tsx` (new)** — the anatomical layer: refined skull-with-jaw head,
   ears, clavicles, sternum, three ribcage arcs, dotted spine axis, pelvic girdle, and ten joint
   nodes over the verified silhouette — a segmented biometric scan, not an outline. Active regions
   get on-body anchors; metrics surface as **severity-colored chip rails** left/right of the body
   with leader lines. Rails retain the worst-severity regions when space runs out (compact: 5/rail,
   full: 7/rail, then "+N more") and always lay out in anatomical order so leader lines never cross
   — many metrics stay structured, never ugly. Controlled hover (chips ↔ hotspots ↔ strip all
   highlight the same domain).

3. **`components/health/HealthIntelligence.tsx` (new)** — the layered surface both cards render:
   status summary (real derived numbers only) → BodyScan → systemic layer strip → fixed-height
   hover detail line → (full variant) a per-domain breakdown grid listing every metric. `compact`
   keeps the homepage card concise; `full` powers the /health room. One component, one model.

4. **`BodyMap.tsx` → thin compat wrapper** — same public name and unchanged `BodyMetric` contract
   (both consumers kept working; /health now passes `variant="full"`).

**Verification (all green, first attempt):** rewritten
`scripts/phaseah-premium-bodymap-smoke.mjs` (supersedes the AH checks) — **70/70**: registry
completeness, all 20 domain mappings incl. fallback rules, graded severity, concern visuals,
zero/one/many behavior (stacking, worst-level, derived average, chip overflow), both surfaces on
one system, hydration safety. `dashboard-web tsc --noEmit` — clean. Regressions: AF.2 domain-canvas
smoke 21/21, AF.5 domain-rooms smoke 29/29. Rail/anatomy geometry verified visually (SVG→PNG
render) before implementation.

Scope: `services/dashboard-web/src/{lib/bodyZones.ts, components/BodyMap.tsx,
components/health/{BodyScan.tsx, HealthIntelligence.tsx} (new), app/health/page.tsx}`,
`scripts/phaseah-premium-bodymap-smoke.mjs` (rewritten), `docs/{phase-log.md, decision-log.md, roadmap.md}`.

## Phase K1.1 — Test Substrate (Vitest + First Contract Tests) — COMPLETE (2026-07-10)

**Goal (master-direction §J.1):** trust substrate before any refactor. No features.

**What was built:**
1. Vitest 4 wired into the workspace: `shared/vitest.config.ts`, `shared` test scripts,
   root `pnpm test`, lockfile updated (additive: vitest toolchain only).
2. **93 contract tests in 6 suites** (`shared/test/*.contract.test.ts`) pinning: token auth
   guards; the `canAccess` isolation engine (fail-closed, user/tenant/global/case, consent gate,
   agent-approval prohibition, owner approval-gating); `stampScope`/`scopeFilter` fail-closed
   halves; the LLM router validation invariant (nothing unvalidated escapes, honest fallback
   traces, governance defaults, cost mapping — zero network); Jarvis grounding (bilingual intent
   fallback, packet ranking/cap, user_priority precedence, correction gate); API envelopes +
   event contract + id/time utilities.
3. **First real bug caught and fixed (D-155):** `SystemEventSchema.merge(ScopeFieldsSchema)`
   had silently made event `source` optional (field collision with scope provenance) — the bus
   accepted anonymous events. Re-asserted required via `.extend()`.

**Verification:** full suite 93/93 green (<1s); `tsc --noEmit` clean for shared,
service-kit, event-bus-service, gateway-api (the `source` consumers). Docs updated:
testing-and-ci.md (new), development-rules.md, decision-log.md (D-154/D-155), roadmap.md
(supersession header → master-direction.md).

Scope: `shared/{package.json, vitest.config.ts, test/*(new), src/schemas/event.ts}`,
root `package.json`, `pnpm-lock.yaml`, `docs/{testing-and-ci.md(new), development-rules.md,
decision-log.md, roadmap.md, phase-log.md}`.

## Phase K1.2 — GitHub Actions CI Gate — COMPLETE (2026-07-10)

**Goal (master-direction §J.1):** make CI the canonical verifier; red CI blocks merge.

**What was built:** `.github/workflows/ci.yml` — on push/PR to main:
install (`--frozen-lockfile`) → `build:deps` (shared + service-kit) → `pnpm -r run typecheck`
(all 21 projects incl. dashboard) → `pnpm -r run test`. pnpm version from `packageManager`,
Node from `.nvmrc`, pnpm cache enabled, 20-min timeout, per-ref concurrency cancel.
Full service builds/`next build` deliberately deferred to the 19→6 consolidation so CI
validates the real deployables (documented in the workflow header).

**Verification:** the workflow's exact command sequence executed locally against a clean
sandbox copy of the repo: frozen-lockfile install OK (no drift — proves lockfile/package.json
coherence), build:deps OK, typecheck OK for all 21 projects, tests 93/93 green. Confirmed
`browser-testing-agent` uses `playwright-core` (no browser postinstall) — no hidden CI
download. First live Actions run occurs on next push to GitHub (not possible from this
environment; commands proven identical locally).

Scope: `.github/workflows/ci.yml` (new), `docs/{testing-and-ci.md, phase-log.md}`.

## Phase K1.4a — Scope-By-Construction Data Layer — COMPLETE (2026-07-10)

**Goal (master-direction §C.5/§J.3, first half):** `scopedCollection(ctx)` exists, exported,
and its isolation guarantees are pinned by tests. ADDITIVE only — no route behavior changes.

**What was built:** `shared/src/db/scoped.ts` — reads `$and`-guarded (caller filters narrow,
never widen), inserts actor-stamped with conflicting scope fields rejected, scope identity
immutable via update (incl. dotted paths), fail-closed construction, injectable-collection
test seam. Exported through `shared/src/db/index.ts`.

**Verification:** 14 new contract tests (hostile-filter read, smuggled-write rejection,
scope-migration rejection, guarded deleteMany, project/case binding, fail-closed
construction) — full suite now **107/107 green**; `tsc` build clean on shared.
Docs: multi-tenant-governance.md (enforcement section), decision-log D-156.

**Remaining for K1.4 (deferred to the gateway split):** migrate kernel routes onto the
wrapper; lint rule confining raw `collection()` to global kernel collections; automated
cross-tenant probes against a live kernel.

Scope: `shared/{src/db/scoped.ts(new), src/db/index.ts, test/scoped-collection.contract.test.ts(new)}`,
`docs/{multi-tenant-governance.md, decision-log.md, phase-log.md}`.

## Phase K1.3 — Gateway Monolith Split (behavior-frozen) — COMPLETE (2026-07-10)

**Goal (master-direction §J.2):** split the 3,698-line `gateway-api/src/index.ts` into route
modules with ZERO behavior change, characterization tests first.

**Process (in commit order):**
1. **K1.3a seam** — `main()` body moved verbatim into exported `buildGatewayService(env,
   {connectDb})`; `index.ts` → 21-line bootstrap. Diff-verified byte-identical body.
2. **K1.3b characterization** — 193 tests pinning pre-split behavior through the real app
   (in-process inject + fake Mongo via `setTestDb`; no network): 85-surface auth sweep
   (exact 401 envelope / 200 admin / 200 internal / x-request-id), task pipeline (validation,
   persistence, queued-on-unreachable-orchestrator, viewer 403 + audit), approvals
   (approve→task completed, reject→cancelled, 400/404), infra confirm, events clamp,
   services-proxy fallback, safe-mode seed/persist/toggle/audit + 403 blocking + off-switch
   exemption, security check persistence, 61st-mutation 429 + security event, rbac shape,
   system status.
3. **K1.3c split** — routes moved VERBATIM into 10 modules
   (`src/routes/{tasks,capabilities,governance,security,operations,intelligence,voice,
   personal,operator,system}.ts`, 2,300 route lines); shared runtime + cross-group helpers
   stay in `server.ts` (1,655 lines) behind one flat `GatewayDeps` (`src/routes/deps.ts`).
   Deviations: exactly 2, documented in D-157 (dokploySync state object — 5 lines; 6 operator
   collection consts relocated to server.ts). Verbatim proof: unified-diff of every moved
   body vs the pre-split file — 7/10 modules byte-identical, 18 total changed lines, all
   accounted for by the two deviations.

**Verification:** gateway `tsc --noEmit` clean; gateway build clean; characterization suite
**193/193 green against the split gateway**; shared suite 107/107 green; route inventory
unchanged (same paths, same methods). Pre-existing duplicate errorHandler override observed
(FSTWRN004) and deliberately left unchanged.

**Left in place (too entangled to move safely this pass, per the split rules):** the
operator/Jarvis helper subsystem (~850 lines: code-operator proxy, tool executors, Jarvis
context/composition, runLoop) remains in `server.ts` — it is shared runtime used by BOTH the
personal and operator route modules; decomposing it is a separate future pass with its own
tests, not a route-move.

Scope: `services/gateway-api/{src/index.ts, src/server.ts(new), src/routes/*(new, 11 files),
test/*(new, 4 files), package.json, vitest.config.ts(new), README.md}`, `pnpm-lock.yaml`,
`docs/{decision-log.md, testing-and-ci.md, phase-log.md}`.

## Phase K1.4b — First Route Migration onto scopedCollection(ctx) + Static Boundary Gate — COMPLETE (2026-07-10)

**Goal (master-direction §C.5/§F.3, second half):** move a real gateway route off convention-
based scope filtering onto the K1.4a wrapper, and ship the lint rule K1.4a deferred.

**Inventory + classification (done before touching code):** all ~99 Mongo collection handles
the gateway touches are declared once in `server.ts` and threaded through one flat
`GatewayDeps` (K1.3); route modules already had zero direct `collection()` calls. Classified
every handle: global kernel state (self-development, governance, RBAC, ~60 collections),
intelligence/ops (global, no per-tenant metering yet), voice/Jarvis (user-scoped in
principle, but inside the D-157-deferred operator/Jarvis subsystem — untouched this pass),
identity/tenant block (mixed — tenant registry is global, memberships/consent/connectors/
userGoals/etc. are user- or tenant-scoped), and the "personal operating layer" (16
collections, all user-scoped, currently filtered only by hand-rebuilt
`{scope:'user', userId}` in every handler — the highest-value target). Zero legacy/unknown
collections found.

**What was built:** `routes/personal.ts`'s `scoped_memories` access (5 call sites — the
private per-user memory store, fully isolated: zero references anywhere else in the
codebase) migrated to a per-request `scopedCollection<ScopedMemory>(COLLECTIONS.
SCOPED_MEMORIES, {actor, scope:'user'})`; the raw handle removed from `GatewayDeps`,
`server.ts`'s declaration block, and its `deps` assembly entry — not left as dead code.
`scripts/check-scope-boundary.mjs` (wired into CI as a new step, plus `pnpm run
check:scope-boundary`): raw `collection()` confined to `shared/src/db/{index,scoped}.ts`
(one documented pre-existing exception, `shared/src/agentrun/index.ts` — global
self-development state, no scope fields); no `services/*/src/routes/**` module may call
`collection()` directly; a ratchet list that hard-fails CI if a *migrated* collection's raw
handle ever reappears anywhere in `services/` (seeded with `scoped_memories`). Non-blocking
signal: remaining raw-`collection()` count in `server.ts` (105) reported every run as tracked
debt for K1.4c+, not hidden.

**Verification:** new `characterization.personal-scope.test.ts` (4 tests) proves a foreign
user's `scoped_memories` row seeded directly into the fake collection never surfaces through
`GET /v1/me/memories` or `/v1/me/universe`, a request with no resolvable `primaryUserId` is
denied at `enforceScoped` (403) before the data layer is ever reached, and a write is
correctly scope-stamped. Documented honest limitation: real per-user auth doesn't exist yet,
so a second *real* HTTP identity can't be driven through the harness — isolation is proven by
seeding a foreign-scoped row directly (exactly the failure mode construction-based
enforcement defends against), with the wrapper's own fail-closed/no-widening guarantees
independently unit-proven in `shared/test/scoped-collection.contract.test.ts` (K1.4a). Full
suite: shared 107/107, gateway-api 197/197 (193 pre-existing + 4 new); typecheck and build
clean for both packages; scope-boundary script passes.

**Remaining unsafe direct access (by design, sequenced for K1.4c+):** the other 7
fully-isolated personal-fact collections (`personalHealthStates`/`LifeItems`/`FinanceItems`/
`LearningTracks`, `opportunityReports`, `connectorAccounts`, `connectorSyncRuns`,
`accessDecisions`), then the identity/tenant block, then (last, and only once it stops
conflicting with "do not rewrite Jarvis") the operator/Jarvis subsystem per D-157's boundary.

Scope: `services/gateway-api/{src/routes/personal.ts, src/routes/deps.ts, src/server.ts,
test/characterization.personal-scope.test.ts(new)}`, `scripts/check-scope-boundary.mjs(new)`,
`.github/workflows/ci.yml`, `package.json`,
`docs/{decision-log.md, multi-tenant-governance.md, phase-log.md}`.

## Phase K1.4c — Second Route Migration: Personal-Facts Family — COMPLETE (2026-07-10)

**Goal (master-direction §C.5, continuing §F.3 item 3):** extend scope-by-construction to the
next narrow, safe collection family — proving the D-158 pattern scales without a rewrite.

**Pre-edit reconciliation:** confirmed no drift since K1.4b (clean tree, ratchet held
`SCOPED_MEMORIES` only, 105 raw `collection()` calls in `server.ts`, 197/197 gateway tests
green). Re-verified the 7 candidate collections flagged in D-158; found `connectorAccounts`
writes with no `scope` field at all, so it's excluded from this pass (would require a write-path
fix, not a mechanical swap) and deferred.

**What was built:** `personal_health_states`, `personal_life_items`, `personal_finance_items`,
`personal_learning_tracks` (12 call sites: 4 inserts in the `/v1/me/reality/ingest` kind-switch,
4 reads each in `/v1/me/universe` and `/v1/me/universe/detail`) migrated onto
`scopedCollection(ctx)` via four new per-request accessors matching D-158's `memoriesFor` shape.
Raw handles removed from `GatewayDeps`/`server.ts` (declaration + assembly + unused type
imports), not left as dead code. `scripts/check-scope-boundary.mjs`'s ratchet extended to 5
collection names.

**Verification:** new tests in `characterization.personal-scope.test.ts` (3 added, 7 total in
the file) prove a foreign user's row per collection never surfaces through
`/v1/me/universe/detail`'s raw-array fields, all four ingest kinds write correctly scope-stamped
documents, and the fail-closed 403 holds. Full suite: shared 107/107, gateway-api 200/200
(197 pre-existing + 3 new); typecheck and build clean; scope-boundary script passes (server.ts
legacy debt 105 → 101).

**Remaining unsafe direct access (sequenced for K1.4d+):** `opportunityReports`,
`connectorSyncRuns` (both single-call-site, next-smallest); `connectorAccounts` (needs a
write-path fix — no scope stamp today — before it can migrate safely); `accessDecisions` (a
non-uniform owner-sees-all / user-sees-own pattern, not a simple `scope:'user'` filter, needs
design thought); the identity/tenant block; the Jarvis/operator subsystem stays untouched per
D-157's standing boundary.

Scope: `services/gateway-api/{src/routes/personal.ts, src/routes/deps.ts, src/server.ts,
test/characterization.personal-scope.test.ts}`, `scripts/check-scope-boundary.mjs`,
`docs/{decision-log.md, phase-log.md}`.
