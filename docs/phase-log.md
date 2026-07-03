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
