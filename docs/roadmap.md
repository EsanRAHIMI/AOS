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

## Technology direction
TypeScript · Next.js 16 · Fastify 5 · MongoDB Atlas · AWS S3 · Zod 4 · SSE
(→ Redis/NATS if needed) · OpenAI + Anthropic via an LLM router abstraction ·
GitHub + Dokploy.
