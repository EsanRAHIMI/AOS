# Roadmap

## Phase 1 — Foundation — DONE
Repo, shared contracts, service-kit, core services, dashboard, data models,
docs, Dokploy specs. (See phase-log.md.)

## Phase 2 — First Autonomous Loop — DONE (core)
1. Live task timeline — DONE (SSE-filtered + final report).
2. Agent-to-agent delegation (orchestrator → 5 specialists) — DONE.
3. Infrastructure request workflow end-to-end — DONE (confirm marks fulfilled).
4. Approval center (request → decide → drive task) — DONE.
5. Memory write after task completion — DONE.
6. Documentation auto-update workflow — DONE.

Carried to Phase 3:
7. internet-research-service.
8. reviewer-agent, qa-agent, monitor-agent, report-agent.
9. Service health monitoring + registration validation + live infra reachability checks.
10. S3 artifact upload from task outputs; richer event-history views.
11. LLM router so agents reason instead of running deterministically.

## Phase 3 — Self-Expanding Capability Engine — DONE (core)
1. Capability graph + gap detector — DONE.
2. Expansion proposal system (+ approve/reject/changes → build) — DONE.
3. Service generator (template-driven, standard endpoints) — DONE.
4. LLM router as shared infrastructure (schema-validated) — DONE.
5. Evaluation engine (10 dimensions) — DONE.
6. Skill library + extraction — DONE.
7. Dashboard: capabilities/gaps/expansions/evaluations/skills/llm-traces — DONE.

Phase 4 candidates:
8. Real LLM provider keys + richer prompts; agent-specific system prompts.
9. Live runtime validation of generated services (auto smoke tests).
10. GitHub branch/commit delivery of generated services (vs local SERVICES_ROOT).
11. reviewer/qa/monitor/report agents; internet-research-service.
12. Dokploy infrastructure checklist generator + cost dashboards.

## Phase 4 — Reality Execution Layer — DONE (core)
1. Runtime Validation Engine (+ runtime_validations) — DONE.
2. GitHub Delivery Engine (+ github_operations; real API or prepared) — DONE.
3. Reality Evidence Store (+ evidence_records) — DONE.
4. Capability lifecycle generated→validated→active with gated promotion — DONE.
5. Real browser-testing-agent (Playwright + HTTP fallback, permission-governed) — DONE.
6. Activation pipeline + dashboard validations/github/evidence pages — DONE.

Phase 5 candidates:
7. Real LLM keys + agent-specific prompts.
8. Live runtime validation (auto build + start + health/manifest probe of generated services).
9. Real GitHub pushes/PRs via token; auto-open PR on activation.
10. reviewer/qa/monitor/report agents; internet-research-service; cost dashboards.

## Phase 5 — Live Activation & Runtime Autonomy — DONE (core)
1. Live Service Activation Engine (+ service_activations) — DONE.
2. Dokploy activation checklist (+ deployment_checklists, dashboard actions) — DONE.
3. Real GitHub mode behind credentials (feature branch + PR) — DONE.
4. Real LLM activation: prompts, health, status (real vs fallback, cost) — DONE.
5. Monitor agent: health scans, activation checks, incidents, repair tasks — DONE.
6. Repair loop (incident → repair proposal, approval-gated) — DONE.
7. Dashboard: checklists/activations/monitor/incidents/repairs/llm-status — DONE.
8. Lifecycle reaches `active` only after live verification — DONE.

Phase 6 candidates:
9. Automated repair execution (redeploy/fix-env) behind approval.
10. Multi-instance event bus (Redis/NATS); RBAC; cost budgets + alerts.
11. reviewer/qa/report agents; internet-research-service.

## Phase 6 — Autonomous Repair & Execution — DONE (core)
1. Repair Diagnosis Engine (+ repair_diagnoses) — DONE.
2. Repair Plan Engine (+ repair_plans, plan types) — DONE.
3. Repair Executor (safe/approved actions + re-activation) — DONE.
4. Extended incident/repair lifecycles + repair evidence types — DONE.
5. Approval-gated repair execution — DONE.
6. Repair learning (memory + reusable skill + repair-log) — DONE.
7. Dashboard: incident detail, repair-task detail, diagnoses, plans — DONE.

Phase 7 candidates:
8. LLM-assisted diagnosis (real provider) with schema-validated causes.
9. Automated execution of low-risk fixes (env/redeploy) via Dokploy API behind policy.
10. Multi-instance event bus (Redis/NATS); RBAC; cost budgets.

## Phase 7 — Strategic Reasoning & Policy-Governed Execution — DONE (core)
1. Strategic Planner (≥3 plans, LLM + validated fallback) — DONE.
2. Plan Scoring Engine (10 dimensions, justified selection) — DONE.
3. Policy Engine (allowed/blocked/approval_required) — DONE.
4. Decision Memory + reusable strategic-planning skill — DONE.
5. Real LLM operational: versioned prompts, promptVersion, status — DONE.
6. Reasoning dashboard + task reasoning trail — DONE.

Phase 8 candidates:
7. Real provider keys end-to-end with LLM-generated plans (still schema-validated).
8. Learned scoring weights from decision outcomes; confidence-calibrated asking.
9. Policy-as-config (editable policies) + RBAC; cost budgets/alerts.

## Phase 8 — Learning Governance & Adaptive Intelligence — DONE (core)
1. Outcome Learning Engine (predicted vs actual + recommendations) — DONE.
2. Adaptive scoring proposals + versioned scoring profiles — DONE.
3. Active profile used by the scoring engine (profileVersion on scores) — DONE.
4. Configurable policy + hardcoded safety overrides — DONE.
5. RBAC (owner/operator/viewer/agent) gating approvals — DONE.
6. Audit logs for all governance actions — DONE.
7. Governance dashboard (reviews/profiles/proposals/policy/rbac/audit) — DONE.

Phase 9 candidates:
8. Learned weights from many outcomes (statistical, not single-review deltas).
9. Full auth (OIDC/JWT) + per-user RBAC; policy-as-config editor in the dashboard.
10. Multi-instance event bus (Redis/NATS); cost budgets + alerts; report-agent.

## Phase 9 — Operational Learning & Memory Intelligence — DONE (core)
1. Historical Learning Engine aggregating 15 collections — DONE.
2. Reliability scores + snapshots (trend + confidence) — DONE.
3. Pattern miner (success + failure/weak-point) — DONE.
4. Memory compression (summaries + compressed contexts) — DONE.
5. Evidence-backed system recommendations (approve→convert) — DONE.
6. Prompt performance from traces + outcomes — DONE.
7. Learning dashboard (runs/reliability/patterns/summaries/recommendations/prompt-perf) — DONE.

Phase 10 candidates:
8. Scheduled/continuous learning runs; auto-prune raw memory into summaries.
9. Apply approved recommendations through the existing proposal pipelines automatically.
10. Cross-task causal analysis; report-agent for periodic governance/learning reports.

## Phase 10 — Continuous Learning & Autonomous Improvement — DONE (core)
1. Learning scheduler (schedules + triggers; manual trigger; continuous-ready) — DONE.
2. Improvement workflow engine + recommendation conversion router — DONE.
3. Workflow executor through existing engines (evidence-backed) — DONE.
4. Impact assessment (before/after; honest "no measurable improvement yet") — DONE.
5. Continuous memory maintenance (deprecate superseded; token budget) — DONE.
6. Dashboard: workflows(+detail)/impact/memory-maintenance/schedules/triggers — DONE.

## Phase 11 — Control-Room Experience (Premium Glass UI) — DONE (design-only)
1. Original glass design system (tokens, blobs, grain, CSS motion; legacy classes preserved) — DONE.
2. New shell: glass sidebar + mobile top/bottom chrome + responsive app-shell — DONE.
3. Reusable UI components (PageHeader/MetricCard/EmptyState/StatusPill) — DONE.
4. Priority pages redesigned (overview, tasks, tasks/:id, agents, services, approvals, capabilities) — DONE.
5. Mobile-first cards, vertical live timeline, clear/safe approvals — DONE.
6. Typecheck + `next build` clean; no backend/API/contract changes — DONE.

## Phase 11.5 — UI QA, Cleanup & Product Polish — DONE
1. Removed dead UI code (Nav.tsx, `.menu-btn`); kept used Placeholder.tsx — DONE.
2. Global responsive tables (no page overflows on mobile); 5 action+table pages → cards — DONE.
3. Safe-area padding for top bar + content; touch-friendly controls — DONE.
4. Route-level loading skeleton, error boundary (retry), and 404 across all 64 routes — DONE.
5. Accessibility: focus-visible, tap-highlight reset, contrast, reduced-motion — DONE.
6. Consistency: design-system components on converted pages; button intent normalized — DONE.
7. Typecheck + `next build` clean; only dashboard-web + docs changed — DONE.

## Phase 12 — Security, Auth & Production Hardening — DONE
1. Dashboard login + HMAC HttpOnly session cookie + logout + middleware route protection — DONE.
2. RBAC enforced in dashboard actions and gateway (owner/operator/viewer/agent); denials audited — DONE.
3. Gateway mutation protection, role propagation, rate limiting, prod-safe errors + request id — DONE.
4. Internal-token verified on all service `/.factory/*` + custom routes; `/health` public — DONE.
5. Env/secret audit, security_checks + security_events, `/security/*` dashboard — DONE.
6. Safe mode (env default + runtime toggle in system_settings) blocks mutations; banner — DONE.
7. Backup/recovery runbook, secret rotation, Dokploy rollback, password-hash script — DONE.
8. Full build/typecheck + 22/22 security-engine smoke; scope limited to security surfaces + docs — DONE.

Phase 13 candidates:
9. Real timer-driven scheduler (monitor-agent fires learning on thresholds).
10. Cross-run impact trends; report-agent for periodic improvement/security digests.
11. OIDC/JWT login + per-user RBAC store (beyond env users); session revocation.
12. Redis-backed rate limiter + distributed safe-mode signal; rename `middleware.ts` → `proxy.ts` (Next 16).
13. Global command palette; convert remaining ~38 read-only data tables to richer mobile views if desired.

## Technology direction
TypeScript · Next.js 16 · Fastify 5 · MongoDB Atlas · AWS S3 · Zod 4 · SSE
(→ Redis/NATS if needed) · OpenAI + Anthropic via an LLM router abstraction ·
GitHub + Dokploy.
