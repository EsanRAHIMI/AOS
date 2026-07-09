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

## Phase 13 — Real Intelligence Integration — DONE
1. Provider governance + budget controls (allowed providers, cost/token caps, safe-mode fallback) — DONE.
2. 13 versioned agent-prompt reasoning contracts; schema-validated outputs only — DONE.
3. Intelligence engines (research/plan/review/QA/report) with deterministic fallback — DONE.
4. New services: internet-research-service, reviewer-agent, qa-agent, report-agent — DONE.
5. Orchestrator research→plan→review→QA→report pipeline; budget + safe-mode force fallback — DONE.
6. Cost records + budget events; gateway reads + dashboard /llm,/llm/costs,/llm/prompts,/research,/reviews,/qa,/reports — DONE.
7. Full typecheck (16 services) + dashboard build + 16/16 intelligence smoke; security intact — DONE.

## Phase 14 — Real Product Experience & Onboarding Layer — DONE (dashboard-only, no fake data)
1. Onboarding: /start, /start/overview, /start/actions, /start/system-map — DONE.
2. Real action templates that create real tasks (RBAC-gated) — DONE.
3. System map from real registry + documented catalog — DONE.
4. Human-readable task lifecycle on task detail — DONE.
5. Next-Best-Action panel on overview from real state — DONE.
6. Proof & Evidence explorer + Reports center (real data, copy/print) — DONE.
7. Product readiness checklist from real state — DONE.
8. Language cleanup + contextual empty states; typecheck + build clean; security intact — DONE.

## Phase 15 — Safe Real Operations inside Overview — DONE (no new mission-control page)
1. operation_plans / dokploy_targets / deployment_snapshots models + classification engine — DONE.
2. Protected-core detection → critical + owner-only approval; safe mode blocks operation approval — DONE.
3. Gateway operation lifecycle (create→target→decision→executed) with real /health + registry verification — DONE.
4. Manual Dokploy instructions when no API token (no fake success / no fake targets) + snapshot on existing-app — DONE.
5. /overview = Mission Control: command panel, active operation console, timeline, target/risk/approval/manual/verify/evidence/next-action — DONE.
6. All services typecheck + dashboard build; 16/16 ops-engine smoke; security + governed AI intact — DONE.

## Phase 16 — Real Dokploy API Execution — DONE
1. Dokploy API client (server-side, token redacted) + config + testConnection — DONE.
2. Dokploy sync engine → real dokploy_targets; manual confirmation fallback kept — DONE.
3. Execution-step model (executionMode/apiMethod/request/responseSummary/error/retryable) — DONE.
4. API executor on approve for low/medium non-core; unsupported→manual_required (no fake) — DONE.
5. Snapshot before existing-app mutation; owner-only snapshot-based rollback; retry — DONE.
6. Overview console shows API status/sync/source/per-step api-or-manual/response/retry/rollback — DONE.
7. Safe mode blocks API mutations; protected core never auto-modified; secrets never exposed — DONE.
8. All typecheck + dashboard build; 12/12 Dokploy smoke (both scenarios); no Docker — DONE.

## Phase 17 — Real Dokploy Calibration & Production Validation — DONE (calibration, no new features)
1. Dokploy API diagnostics (read-only probes, key-only shapes, redacted samples) + dokploy_api_diagnostics — DONE.
2. Calibrated multi-shape sync parser; missing fields = unknown, never invented — DONE.
3. AOS service ↔ Dokploy mapping (matched vs not_found_in_dokploy_sync) — DONE.
4. Overview calibration panel: connection/last-sync/targets/supported+unsupported endpoints/mapping — DONE.
5. Health-check end-to-end (real /health + registry) is the verified low-risk flow — DONE.
6. Protected core unchanged (critical/owner-only/non-auto/safe-mode-blocked); manual fallback kept — DONE.
7. All typecheck + dashboard build; 10/10 calibration smoke; no fake data/success; no Docker — DONE.

## Phase 18 — Realtime Voice Operator Agent — DONE
1. voice-operator-agent service (4121) — realtime ephemeral token, explanation, memory/learning — DONE.
2. Voice schemas/collections + deterministic tool-mediation router + 10 anti-mistake guardrails — DONE.
3. Gateway voice endpoints (context/session/message/tool-confirm/permission) under RBAC + safe mode — DONE.
4. Floating VoiceOperatorDock on every page; text + browser STT/TTS; provider optional; overview stays surface — DONE.
5. /voice, /voice/settings, /voice/sessions; voice approvals + tool calls audited/evidenced — DONE.
6. All 18 services typecheck + dashboard build; 15/15 voice-router smoke (A–D + guardrails + learning) — DONE.

## Phase 19 — Full Realtime Voice WebRTC Integration — DONE
1. `useRealtimeVoiceSession` hook: token → RTCPeerConnection → mic → data channel → SDP → remote audio — DONE.
2. GA token mint (`/v1/realtime/client_secrets`) + beta fallback; gateway SDP proxy `/v1/voice/realtime/sdp` — DONE.
3. `create_response=false` + deterministic `/v1/voice/message` mediation — raw model output never acts — DONE.
4. Barge-in/interrupt, push-to-talk default, visible always-listening, mic level, timer, reconnect — DONE.
5. All fallbacks intact (provider missing → browser voice → text); mic/autoplay/expired-token handling — DONE.
6. Session-end tracking (duration/mode/errors/fallback/toolCalls) + sanitized realtime events — DONE.
7. All services typecheck + dashboard build; 11/11 Phase 19 smoke; no Docker; Dokploy independence — DONE.

## Phase 19.5 — Voice Operator Production Fix & Real Command State Machine — DONE
1. UtteranceGate: final-only, min 4 chars, 5s dedupe, in-flight lock, echo suppression, reply dedupe — DONE.
2. Dock state machine (11 states) + end-of-utterance silence gate (800ms) for browser STT — DONE.
3. Realtime priority (browser STT never parallel) + realtime transcript echo guard — DONE.
4. Gateway dedupe/min-length on /v1/voice/message (protects against client bugs) — DONE.
5. Operator-language replies from live state; `run_system_status_check`; no capability spam — DONE.
6. Interrupt cancels audio/TTS/pending output and resets the gate cleanly — DONE.
7. 23/23 pipeline smoke + 11/11 Phase 19 smoke; all typechecks; dashboard build — DONE.

## Phase X — Autonomous Operator Runtime (Jarvis-Class Control Layer) — DONE
1. Live tool registry: 45 real tools, 15 categories, schemas/risk/approval/execution paths — DONE.
2. Real agent loop: plan → tool → observe → approve → continue → evidence → report → memory — DONE.
3. Dynamic “what can you do?” from the live registry (grouped, risk-labeled, config-sensitive) — DONE.
4. code-operator-agent (4122): inspect/search/dry-run patch/edit/typecheck/build/smoke/git/PR, workspace +
   branch isolation, protected-core refusal — DONE.
5. OperatorConsole replaces the voice dock (serious UI, runtime panel, inline approvals); Overview shows
   the active runtime session — DONE.
6. Failure → cause + next action + mistake memory; narration via operator.* events — DONE.
7. 28/28 Phase X smoke + 23/23 + 11/11 regressions; all typechecks; dashboard build — DONE.

## Phase Y — Autonomous Staging Workspace & Service Evolution Runtime — DONE
1. 8 workspace collections + 7 modes + 15 statuses; disposable `.workspaces/` (gitignored) — DONE.
2. Isolated service copy (source untouched, commit recorded) + complete new-service generator — DONE.
3. Deep multi-file edit batches, no per-step approval inside the workspace; limits as guardrails — DONE.
4. Temp-port boot + real factory probes (health/manifest/status/token guard) with captured logs — DONE.
5. 15-check verification matrix + check-fix iteration loop (never fabricates green) — DONE.
6. Migration plans (core ⇒ critical/owner/open_pr_only) + staged Dokploy app spec + rollback that
   preserves the old version; promote = snapshot branch, default branch untouched — DONE.
7. 15 operator tools + planner scenarios (evolve console / new service / repair / core upgrade) with
   cross-step context; 31/31 Phase Y smoke incl. REAL generated-service typecheck; all regressions — DONE.

## Phase Z — Live Runtime Fix Loop & Operator Command Center — DONE
1. service-kit: manifest/status/capabilities public metadata; task+logs token-guarded — DONE.
2. ws_run probes all six factory endpoints token-aware; matrix +capabilities +logs_endpoint — DONE.
3. Real auto-fix loop (verify → repair → rebuild/reboot → re-verify) streamed live; GREEN gate — DONE.
4. Honest outcomes: critical-step failure ⇒ session FAILED with cause + next action, never “Done” — DONE.
5. 12-phase live state machine + console command center (phase strip, matrix grid, loop counter,
   logs preview, migration readiness) — DONE.
6. 18/18 Phase Z smoke incl. REAL in-process service boot with the full probe suite GREEN; all
   regressions; all typechecks; dashboard build — DONE.

## Phase AA — Scope, Identity & Multi-Tenant Governance Foundation — DONE
(Executed ahead of the Reality-Baseline track; front-loads the identity/tenancy parts of Phase AC/AD.)
1. Scope model (global/tenant/user/project/case) + 16 identity/governance collections — DONE.
2. Central `canAccess` engine at the gateway boundary; missing scope fails closed; denials audited — DONE.
3. Esan seeded as owner/platform governor; legacy login backward compatible via AuthContext mapping — DONE.
4. Consent/connector read-only foundation (revocation blocks syncs; metadata only, never secrets) — DONE.
5. Personal operating layer APIs (/v1/me/*) + honest briefings (not_configured sources) — DONE.
6. Scope-aware operator (goal classification, scoped sessions, ACTOR/SCOPE/MODE in console) — DONE.
7. Five identity settings pages; idempotent non-destructive migration script — DONE.
8. 39/39 isolation smoke (scenarios A–G); all regressions; all typechecks; dashboard build — DONE.

## Phase AB — Personal Reality Baseline & Jarvis Intelligence Layer — DONE
1. 14 scoped reality collections; facts/inferences/recommendations strictly separated — DONE.
2. Personal Intelligence Graph + missing-data detection with exact ingest guidance — DONE.
3. Next-best-action engine (deterministic, specific reasons, source/confidence/freshness) — DONE.
4. Daily briefing + weekly strategy engines with honest not_configured sources — DONE.
5. Opportunity engine (value scoring, no fake market claims) + resume intelligence (never invents
   credentials; claims ≠ facts) — DONE.
6. Ingestion framework (11 kinds) + decision→scoped-memory learning — DONE.
7. Operator answers “What should I do now?” specifically; AOS-build analysis routes to global
   evolution with approval — DONE.
8. /me Personal Command Center + 8 subpages; 26/26 smoke + all regressions — DONE.

## Phase AC+ — Living AI Government Interface / Jarvis Command Universe — DONE
1. New `/` home: 9-zone living operating surface (health/daily/life/finance/ventures/growth/
   opportunities/systems/presence) on ONE scope-enforced contract (/v1/me/universe) — DONE.
2. Abstract SVG body map (real metrics only; dormant setup-ready nodes) — DONE.
3. Finance structure (income/expense/bill/installment/obligation/investment) with monthly-normalized
   real math; life/family/home structure; 3 new ingestion kinds — DONE.
4. Jarvis bridge: every zone summons the console with a contextual command; console deep-links back —
   DONE.
5. Old overview preserved as /operations Engine Room; zones honest (live only with real data) — DONE.
6. 18/18 universe smoke + all 7 regression suites; all typechecks; dashboard build — DONE.

## Phase AD — Jarvis Intelligence Core & Living Command Home — DONE (2026-07-09)
Real Jarvis reasoning core (`shared/src/jarvis`) + `/v1/jarvis/*` endpoints + the first
`page.tsx` consumer of the briefing contract. See `phase-log.md` for detail.

## Phase AE — Jarvis Memory, Daily Brain & Real Context Upgrade — DONE (2026-07-09)
Memory-fact ingestion, quality scoring, and the restructured briefing engine
(`primaryPriority`/`activeBlockers`/`systemWarnings`/`recommendedNextActions`).

## Phase AE.1 — Jarvis Priority & Memory Correction — DONE (2026-07-09)
Fixed priority-first response logic so a stated priority is never displaced by a
system warning; broadened memory-fact extraction. See D-related entries in
`decision-log.md`.

## Phase AF.1–AF.4.4 — Living Command Universe, Domain Canvas, Realtime Runtime & Live Activity — DONE (2026-07-09)
The homepage (`/`) became a persistent, realtime command surface: Jarvis
Presence Bar + Focus Row wired to the briefing endpoint, all nine Command
Universe zones given real domain-specific visual renderers (`BodyMap`,
`FinanceFlow`, `HouseholdMap`, `VentureBoard`, `SkillLanes`,
`OpportunityRadar`, `SystemPulse`, `PresenceBadges`, `PriorityStack`), a
domain action layer (accept/reject/ingest controls on zone cards), a
realtime block-invalidation runtime (`UniverseProvider` + SSE), a persistent
`GET /v1/operator/live-state` snapshot that survives refresh/navigation, a
hydration fix for relative timestamps, and a rebuilt Live Activity feed that
groups every operation into one card by stable identity instead of a raw,
duplicated event dump. Full phase-by-phase detail (AF.1 through AF.4.4,
7 sub-phases) is in `phase-log.md`; decisions D-108 through D-128 in
`decision-log.md`.

## Phase AF.5 — Dedicated Per-Domain Routes — DONE (2026-07-09)
Closed the "Command Universe follow-through" gap: every zone's "Open" link now leads to its own
dedicated room (`/health`, `/daily`, `/life`, `/finance`, `/ventures`, `/growth`, `/opportunities`,
`/systems`, `/presence`) built on one shared, comparable template (`DomainRoom`), showing the
complete unsliced record set per domain via a new `GET /v1/me/universe/detail` endpoint, with
"go deeper" links into whichever pre-existing richer page already manages that domain. 29/29 new
smoke + 131/131 regression unchanged. See `phase-log.md`; decisions D-129 through D-131.

## Phase AG — Real Research & Intelligence Fabric — DONE (2026-07-09)
Closed the most-cited gap across every audit document (including the untouched Persian
`TECHNICAL-REPORT.md`): `internet-research-service` had no real web-search API. New
`shared/src/research` provider abstraction (`TavilyProvider`, `webSearchProviderFromEnv`,
`estimateReliability`); `runResearch()` now grounds on real search results with structurally
guaranteed URL integrity (source records are rebuilt from the real results, never trusted from the
LLM's echo); new `sourceMode: 'search_api' | 'llm_only' | 'curated_fallback'` field tracked
separately from the existing `mode`, surfaced as its own badge in the `/research` dashboard pages.
23/23 new smoke + 183/183 cumulative regression. See `phase-log.md`; decisions D-132 through D-135.

## Carried-forward directions (not yet scheduled or phase-lettered)

These themes from the earlier AA–AE "NEXT" planning are still real and still
pending — they are listed here without phase letters to avoid colliding with
the AA/AB/AC+/AD/AE/AE.1/AF.1–4.4 phases above, which already completed under
those same letters. Assign a fresh phase name only when work actually starts.

**Documentation & environment truth**
1. Keep docs synchronized with the current service/route/collection reality (this audit pass is the first instance of that discipline being applied explicitly).
2. Verify live env/integration status: MongoDB, S3, Dokploy, GitHub, LLM, voice, registry, event bus.
3. Add automated doc-health checks for service map, constants, env examples, and deployment docs.
4. Point Dokploy diagnostics at the live instance and capture parser/endpoint deltas honestly.

**Real research & intelligence fabric**
5. ~~Add a real web search + fetch provider~~ — **DONE, Phase AG** (2026-07-09): `TavilyProvider` +
   `webSearchProviderFromEnv()` (`shared/src/research`), `runResearch()` grounds on real results with
   source-URL integrity guaranteed structurally, honest `sourceMode` tracking. See `docs/phase-log.md`.
6. Still open: research sources aren't yet fed into daily briefing/opportunity scoring/reports; no
   watch-topics scheduler; only one provider (Tavily) is wired though the interface supports more.

**Multi-user operating layer**
7. Onboard real second users/tenants on top of the Phase AA scope/RBAC skeleton (today only Esan is seeded as owner).
8. Read-only connectors: calendar, email, files/drive, GitHub/projects.
9. User-scoped daily briefing and weekly strategy loops for non-owner users; opportunity engine extended beyond the single-owner case.

**Production hardening & scale**
10. OIDC/OAuth2 login + JWT/session revocation + persistent per-user RBAC (today: env-credential login + signed HMAC cookie).
11. Redis-backed rate limits, safe-mode propagation, and session invalidation for multi-instance deploys.
12. Redis Streams or NATS behind event-bus-service for multi-instance SSE fan-out.
13. OpenTelemetry traces/metrics/log correlation; OpenAPI/AsyncAPI generation from shared schemas; contract tests per standard endpoint.

**Governed autonomous execution**
14. LLM-planned goals and LLM-synthesized workspace edit batches through the LLM router.
15. Reviewer/QA loop on workspace promotion branches before PR creation; GitHub PR automation when configured.
16. Approval-gated connector write actions with previews and evidence; public-service/citizen workflows only after tenant policy, audit, and privacy gates pass.

**Command Universe follow-through**
17. ~~Dedicated per-domain routes~~ — **DONE, Phase AF.5** (2026-07-09): all nine zones now link to their own room (`/health`, `/daily`, `/life`, `/finance`, `/ventures`, `/growth`, `/opportunities`, `/systems`, `/presence`). See `docs/phase-log.md`.
18. `next build` verification once this sandbox has a working SWC binary (or an equivalent CI environment) for linux/arm64.

## Technology direction
TypeScript · Next.js 16 · Fastify 5 · MongoDB Atlas · AWS S3 · Zod 4 · SSE
(→ Redis/NATS if needed) · OpenAI + Anthropic via an LLM router abstraction ·
GitHub + Dokploy.
