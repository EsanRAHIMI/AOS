# AOS Master Direction — Audit & Continuation Plan

**Date:** 2026-07-10
**Status:** Supersedes `roadmap.md` future phases, `TECHNICAL-REPORT.md`, and any prior directional statements where they conflict.
**Audit basis:** Full codebase inspection (all 19 services, `shared/` 10,760 LOC across 70 files, gateway 3,698 LOC, dashboard 187 TSX files / ~115 routes, 36 commits spanning 2026-06-25 → 2026-07-10), plus all 24 docs.

---

> **⟶ CURRENT STATE (read this first): `docs/current-state.md`.** This master
> direction is the strategic arbiter; for the exact as-built state, commit,
> verification statuses, and run/verify commands, the current-state snapshot is
> authoritative and kept up to date every session.
>
> **Progress vs this plan (as of commit `58a189e`, 2026-07-18):**
> - **K1** (trust substrate / reliable dispatch): the BullMQ queue backbone is
>   RUNTIME_VERIFIED against real Redis+Mongo (D-173/D-174/D-176).
> - **K2** (real intelligence): the shared agent loop, unified governed tool
>   registry, persistent Jarvis, Memory v2, missions, independent research,
>   watches/briefing, self-development pipeline, and specialist roles are
>   implemented and RUNTIME_VERIFIED against real Redis+Mongo+a real local
>   OpenAI-compatible server (D-177/D-178). **K2 is NOT declared complete:**
>   real-model reasoning quality and real-browser `/jarvis` are
>   BLOCKED_EXTERNAL in the build sandbox (no reachable model / no browser
>   libs). See current-state §5.
> - **K3/K4/K5** not started.

---

## A. Executive Diagnosis

### What AOS actually is today

AOS is a **well-disciplined, schema-first, single-operator kernel with a very wide but shallow surface**. It is not yet an AI operating system. It is a governance-and-bookkeeping engine with an LLM garnish.

The honest classification of the current system:

**A distributed monolith wearing a microservice costume.** There are 19 "services," but 14 of them are 70–200 line HTTP shells whose entire logic lives in `shared/` (10,760 LOC). Meanwhile the gateway is a genuine monolith: one 3,698-line `index.ts` with ~80 routes. You are paying the full cost of microservices (19 deploys, 19 env sets, 19 subdomains, network hops, token plumbing) while getting none of the benefit (independent scaling, independent teams, fault isolation). The real architecture is: **one library + one giant gateway + thin proxies**. This must be said plainly because every future decision depends on admitting it.

**Deterministic machinery presented as intelligence.** The system is engineered to run *fully without any LLM*. That was a defensible early choice (nothing fabricated, everything schema-validated — genuinely good engineering ethics), but it has hardened into the identity of the system. Concretely:

- Jarvis intent classification falls back to bilingual regex tables; the LLM path is a single-shot JSON completion, not a reasoning process.
- The "planner" is deterministic goal→tool-step mapping (`shared/src/operator`). Plan "scoring," "evaluations" (10 dimensions), "reliability scores," "pattern mining," and "prompt performance" are arithmetic heuristics over records — respectable telemetry, but not intelligence, and the dashboard presents them as if they were.
- The Architect agent's "service design" is `slugify(goal)` plus a static capability list. QA, Reviewer, and Report agents are ~70 LOC each and do essentially nothing real.
- There is **no agentic loop anywhere**: no multi-turn tool use, no streaming, no reflection over intermediate results, no conversation history. `generateStructured()` is one prompt → one JSON blob → fallback. That is a form-filler, not an agent.

**A dashboard that is a database viewer, not a command universe.** ~115 pages, roughly one per MongoDB collection. The Living Command Universe work (domain rooms, BodyMap/health intelligence, focus row) shows real ambition and some of the best code in the repo, but it sits on top of page sprawl, a 289-line `globals.css`, no design token system, and no unified component architecture. The user-reported experience — slow, inconsistent, crowded, fragmented — is structurally guaranteed by this layout.

**A single-user system with multi-tenant vocabulary.** Phase AA added excellent scope/tenant/consent/RBAC *schemas*. But enforcement is by convention: scope fields are optional on legacy data, there are no per-user accounts beyond one owner login (static admin token + `hash-password.mjs`), no OIDC, no query-layer guarantee that a tenant filter is ever applied, and rate limiting / safe mode / event fan-out are all in-memory (correctly self-reported in `AOS_SELF_KNOWLEDGE`). Nothing here would survive a second paying customer, let alone a government workload.

**A self-development engine that scaffolds, but does not develop.** The real parts: `code-operator-agent` genuinely executes workspace-scoped inspect/search/patch-preview/branch-edit/typecheck/build, refuses protected-core paths without approval, and staging workspaces exist (Phase Y). GitHub delivery defaults to "prepared" mode (real API only when configured). The service generator emits template boilerplate. What is missing is everything that makes self-development trustworthy: no test framework anywhere in the repo (zero vitest/jest/playwright dependencies — only 30+ bespoke smoke scripts), no CI, no automated verification gate, no deploy-observe-repair loop that has ever run against production.

**Phase inflation.** 30+ phases marked DONE in 15 days. Each "phase" is a feature slice. The docs are extensive and mostly honest in the details, but the cumulative effect is a paper trail that claims far more system than exists. Future agents reading `phase-log.md` will over-trust the system. This is a real operational risk for a project whose core mission is agents building on prior agents' work.

### What is genuinely good (keep and build on)

This is not an amateur codebase. The following are real assets, better than most agent projects at this stage:

1. **Contract discipline.** Zod-first schemas everywhere, one shared service kit, uniform manifest/health/status surface, consistent API envelopes. This is the hardest habit to retrofit and it already exists.
2. **The honesty ethos.** `not_configured` over fabrication, `sourceMode` on research, `usedFallback` on every LLM trace, evidence records, audit logs, approval gates. This is the exact differentiator a governed AI OS needs — most competitors fake it.
3. **Governance primitives.** Approvals, policy evaluation, protected-core refusal, safe mode, owner-only tools, scope model direction. The vocabulary of an AI Government OS is present.
4. **LLM observability.** Traces, cost records, budget events, prompt versioning, corrective-retry with failing-path feedback. Ahead of the curve.
5. **Real integrations where they exist:** Tavily research with honest degradation, OpenAI Realtime voice with server-side ephemeral tokens, Dokploy calibration, workspace-confined code operations.
6. **Bilingual (EN/FA) design** — a genuine product moat for the owner's market.

### Capability classification (per audit rules)

| Capability | Status |
|---|---|
| Service kit, manifests, health, registry, envelopes | **Implemented** |
| Mongo persistence, event persistence, SSE stream (single instance) | **Implemented** |
| Approvals workflow, audit logs, evidence records | **Implemented** |
| LLM router + traces + cost records + budget config | **Implemented** (but single-shot only) |
| Internet research (Tavily) with honest source modes | **Implemented** (needs key in prod; never live-verified per self-knowledge) |
| Voice realtime (OpenAI WebRTC, ephemeral tokens) | **Implemented** |
| Code operator (workspace tools, protected-core gate) | **Implemented** (narrow) |
| Jarvis layer (intent → context packet → composed reply) | **Partial** — single-shot, no conversation memory, regex fallback dominant when unkeyed |
| Orchestrator planning/delegation | **Partial** — deterministic pipeline with LLM garnish |
| Multi-tenancy / scope | **Partial** — schemas real, enforcement by convention, one real user |
| RBAC | **Partial** — data model exists; no per-user authn to hang it on |
| Memory & learning | **Partial** — structured fact records; no retrieval, no embeddings, no transcripts |
| Self-development engine | **Partial** — scaffold + typecheck + prepared PRs; no CI, no test gate, no closed loop |
| Monitor agent | **Partial** — health polling; no metrics/tracing/alerting stack |
| Architect "service design", QA, Reviewer, Report agents | **Fake/demo** — template output or ~70-LOC stubs |
| Evaluations/scoring/pattern-mining presented as intelligence | **Fake-adjacent** — real arithmetic, misleading framing |
| Per-collection dashboard pages (most of the ~115) | **Demo-grade** — raw table dumps |
| User accounts, OIDC/sessions for >1 user, tenant isolation enforcement | **Missing** |
| Test framework, CI/CD, contract tests | **Missing** |
| Streaming, multi-turn agentic loop, tool-use API usage | **Missing** |
| Retrieval memory (embeddings/vector or Atlas Search) | **Missing** |
| Personal/business connectors (email, calendar, finance, docs) | **Missing** (honestly reported as such) |
| Billing, metering, plans | **Missing** |
| Observability (metrics, distributed tracing, alerting), backups/DR runbooks tested | **Missing** |
| Queue/backplane surviving multi-instance | **Missing** |
| Design system | **Missing** |

### The five gaps that block everything

1. **No real agentic intelligence layer** — everything else is furniture until an LLM can actually run a multi-step, tool-using, self-checking loop inside the governance rails you already built.
2. **No trust substrate for change** — without tests + CI, the self-development engine can never be allowed to matter, and every refactor (including the ones in this document) is gambling.
3. **No identity** — one static admin token means no second user, no tenant, no customer, no revenue.
4. **Architecture inversion** — 19 deployables of overhead protecting ~2,000 lines of real agent logic, while the actual load-bearing code (gateway, shared) is a monolith with no module boundaries.
5. **Surface without depth in the UI** — 115 pages nobody can navigate instead of 15 surfaces that feel alive.

Everything in this document is sequenced to close those five gaps in that order of leverage.

---

## B. Corrected Product Definition

Replace the current vision/mission framing with the following (verbatim, into `docs/vision.md` and `docs/mission.md`):

> **AOS is a governed, self-developing AI operating system.** It gives a person — and later a team, a company, and a government unit — a single intelligent command layer (**Jarvis**) over every domain of life and work: health, finance, family, career, business, learning, research, civic life, systems, and opportunities.
>
> AOS is different from an AI assistant in five load-bearing ways:
> 1. **It owns state.** Long-term memory, evidence, decisions, outcomes, and domain data live in AOS, not in a chat scrollback.
> 2. **It owns tools and services.** Agents act through a governed tool registry against real services, connectors, and code — not through copy-paste suggestions.
> 3. **It is governed.** Every consequential action passes policy, scope, and human approval gates, and leaves audit and evidence trails. Autonomy is observable, auditable, and revocable.
> 4. **It develops itself.** AOS can inspect its own code and behavior, propose improvements, implement them in isolated workspaces, verify them against automated gates, and ship them with approval.
> 5. **It is honest by construction.** Unknown is reported as unknown; unconfigured as unconfigured; every AI output carries its provenance (model, prompt, cost, fallback status, sources).
>
> The product ladder: **(1)** Personal Jarvis OS for one operator → **(2)** multi-user Jarvis OS for founders/teams (first commercial product) → **(3)** organization OS with tenant governance → **(4)** Government OS: policy-governed AI operations for public-sector workflows. Each rung must be real before the next is attempted.

Explicit non-goals (write these down; they prevent regression): AOS is not a chatbot, not a dashboard product, not a workflow-automation toy, not an AGI claim. The dashboard is a *view* of the OS; Jarvis is the *interface*; the kernel is the *product*.

---

## C. Corrected Architecture Direction

### C.1 The core correction: consolidate to 6 deployables

The one-service-per-agent rule (development-rules / original project brief) is hereby superseded. Agents become **logical actors inside one runtime**, not network services. Service identity, manifests, and the registry survive as *logical* constructs (they're good), but the deployment topology collapses:

```
aos-kernel          — Fastify. The system of record and control plane.
                      Modules (in-process, strict boundaries):
                      api-gateway, identity/auth, governance (policy/approvals/audit),
                      registry, event-bus, file-assets, scope-enforced data layer.
aos-agent-runtime   — The intelligence plane. Hosts ALL agents (orchestrator,
                      architect, builder, qa, reviewer, monitor, memory, research,
                      report) as workers on a real agentic loop, consuming a task
                      queue. Scales horizontally by adding instances.
aos-jarvis          — The command plane. Conversation sessions, streaming,
                      context assembly, tool invocation via kernel governance,
                      voice transport. (May start as a kernel module; split when
                      streaming/voice load justifies it.)
aos-code-operator   — Stays separate. Sandboxing and blast-radius isolation
                      justify the process boundary (the only agent that touches code).
dashboard-web       — Next.js. The Living Command Universe.
infra               — MongoDB Atlas, S3, Redis (queue + pub/sub + rate limits +
                      safe-mode flag), Dokploy.
```

Why: the current topology multiplies every cross-cutting change by 19, makes local dev heavy, makes tracing miserable, and buys nothing — the shells share one library and one DB anyway. A modular monolith with enforced internal boundaries (lint-enforced import rules between modules) preserves every future split point. Splitting later is cheap *because* the contracts already exist; running 19 processes now is expensive *despite* them.

### C.2 The intelligence layer (the biggest rebuild)

Replace single-shot `generateStructured` as the primary reasoning mode with a real **agent loop**:

- **Native tool use** via provider tool-calling APIs (Anthropic tools / OpenAI function calling), not JSON-in-prose extraction. `extractJson()` remains only as a last-resort parser.
- **Multi-turn loop**: model ↔ tools with max-step budgets, streamed to the event bus, every step traced (extend `LlmTrace` to step-level).
- **Governance stays exactly where it is**: the loop can *request* any tool; the kernel's policy/approval/scope layer decides. The existing invariant — raw model output never mutates state — is preserved because tools are the only mutation path and tools are governed. This is the correct architecture and it is already half-built.
- **Model registry from config, not hardcoded strings.** Current code pins `claude-sonnet-4-6` / `gpt-4.1` in source. Move to env/DB-config with tiers: `reasoning` (hard planning, architecture, self-development), `standard` (Jarvis turns, agent steps), `fast` (classification, ranking, extraction). As of this writing the current Anthropic lineup is Claude Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5 — but the point is the registry, because models change monthly. Add prompt caching for the stable context prefix (system + tool defs + memory packet) — it directly cuts Jarvis cost per turn.
- **Deterministic fallback is demoted** from "co-equal mode" to "degraded mode": visibly flagged in UI, never silently substituting for reasoning on route-to-planner turns. An unkeyed AOS should say "intelligence offline," not pretend with regex.
- **Reflection and evaluation become LLM work**: after significant runs, a reviewer pass (fast model) scores outcome vs. goal and writes structured lessons to memory. The existing heuristic scores become *features* fed into that judgment, not the judgment itself.

### C.3 Memory v2

Keep the structured-fact discipline (it is right), add the missing halves:

1. **Transcripts**: `jarvis_sessions` / `jarvis_messages` — full conversational history, session-scoped, summarized progressively (rolling summary + pinned facts) to control tokens.
2. **Retrieval**: embeddings over memories, evidence summaries, doc chunks, and research findings — MongoDB Atlas Vector Search (no new infra; verify index limits for scale via research service). Context assembly becomes: scope filter → hybrid retrieve (vector + recency + weight) → rank → packet. The existing `buildJarvisContextPacket` ranking survives as the final stage.
3. **Consolidation**: a scheduled memory-agent job that merges duplicates, decays stale facts, promotes repeated patterns to skills — the current maintenance records become real operations.

### C.4 Event and execution backbone

- Event bus: keep Mongo persistence; move fan-out to Redis pub/sub so N kernel/dashboard instances see all events. Same publish contract — the code comment already anticipates this.
- Task execution: move agent task dispatch from HTTP-push-to-shells to a **Redis-backed queue** (BullMQ is the boring, right-sized choice) with retries, idempotency keys, dead-letter, and concurrency control. Task state machine stays in Mongo.
- Rate limits, safe mode: Redis-backed, not process memory.

### C.5 Identity, scope, and governance enforcement

- Real authn: user accounts + sessions via a mature library (evaluate Auth.js / better-auth via research service — pick one, boring and maintained), OIDC-ready. Owner remains a role, not a hardcode.
- **Scope enforcement moves from convention to construction**: a repository layer (`scopedCollection(ctx)`) that *requires* an actor context and injects tenant/user filters on every query. Direct `collection()` access outside the data layer becomes a lint error. This single change is what makes "multi-tenant" true.
- RBAC middleware on every kernel route, driven by the existing role schemas.
- Compound indexes led by `tenantId` on all scoped collections.

### C.6 Domain engine pattern (for section 10 / future domains)

Every life/business domain (health, finance, family, education, career, business, law/civic, science/research/invention, energy, governance, public services, opportunities, risks, infrastructure) follows one repeatable module pattern — this is what makes the OS scale horizontally across life without 19 more services:

```
Domain = {
  schema:    domain entities + metrics (Zod, scoped)
  ingestion: connectors + manual capture + Jarvis-conversational capture
  state:     current model, timeline, relationships to other domains
  intel:     domain agent policies (what to watch, score, recommend)
  actions:   governed tools (read/write tiers, approval rules)
  room:      one UI room on the shared design system
}
```

Domains are data + policy + prompts + one room — **not** new deployables. The health work (bodyZones/HealthIntelligence) is the prototype; generalize its shape (registry of domain metrics → severity grading → derived aggregates → room rendering) into the domain framework. Cross-domain edges (e.g., finance→stress→health; career→education) live in a `domain_links` collection and surface in Jarvis reasoning and the universe map.

---

## D. New Phase Roadmap

Five phases. Fewer, stronger, sequenced so each unlocks the next. Phase letters restart deliberately: **K1–K5** (kernel era), to visually break from the inflated A–AH history. Do not run phases in parallel; each has a hard verification gate.

### Phase K1 — Foundation Reset (trust substrate)

**Goal:** Make the system safe to change and true in its claims. No new features.
**Why it matters:** Every subsequent phase — especially self-development — is reckless without tests, CI, and an honest topology. This is the phase that converts a demo into an engineering asset.

- **Backend:** Consolidate 19 services → 6 deployables per C.1. Split `gateway-api/src/index.ts` (3,698 lines) into route modules (`routes/{tasks,approvals,jarvis,operator,voice,security,me,...}.ts`) with shared middleware (auth, RBAC, scope context). Introduce the scoped repository layer (C.5). Redis for events fan-out, queue, rate limits, safe mode. Real user auth + sessions.
- **Frontend:** No redesign yet. Only: delete dead per-collection pages that will not survive Phase K3 (mark redirects), fix the SSE client for the new backbone.
- **Intelligence/agents:** None (deliberately). Model registry moved to config as prep.
- **Data model:** `users`, `sessions` (real), `tenants` enforced; migration script stamps scope on all legacy records (extend existing `migrate-scope-foundation.mjs`); compound tenant-led indexes.
- **Verification gate:** Vitest installed; ≥ 150 unit/contract tests covering shared schemas, scope enforcement (prove cross-tenant reads fail), governance gates, and every kernel route's authn; GitHub Actions CI (typecheck + tests + build) green and required on main; two kernel instances behind one dashboard receive identical event streams; all 30+ smoke scripts either converted to tests or deleted.
- **Commercial value:** None directly — it is the precondition for all of it.
- **Risks:** Consolidation breaks Dokploy assumptions (mitigate: new `deployment/` specs in same PR); temptation to sneak features in (mitigate: hard scope freeze).

### Phase K2 — Real Intelligence (the agent loop)

**Goal:** Replace single-shot JSON generation with a governed, multi-turn, tool-using agent runtime; make Jarvis a real conversation.
**Why it matters:** This is the phase where AOS stops being deterministic machinery and becomes what the vision claims. Everything the governance layer was built for finally has a client.

- **Backend:** `aos-agent-runtime` with the agent loop (C.2): native tool calling, step budgets, streaming step events, per-step traces. Jarvis session engine: multi-turn transcripts, rolling summaries, streaming SSE responses. Tool registry unified (operator tools + agent tools, one governance surface).
- **Frontend:** Minimal but critical: Jarvis becomes a streaming conversational surface (token streaming, visible tool-call steps, approval prompts inline). Ugly is acceptable; real is mandatory.
- **Intelligence/agents:** Rebuild the four fake agents (architect/qa/reviewer/report) as *prompted roles* on the shared loop with distinct tool grants — an architect that actually reasons over the real service map; a reviewer that actually reads diffs via code-operator tools. Reflection pass after every significant run writes lessons to memory. Retrieval memory (C.3) online: embeddings + Atlas Vector Search + hybrid context assembly.
- **Data model:** `jarvis_sessions`, `jarvis_messages`, `memory_embeddings`, step-level `llm_traces` extension, `tool_invocations` (request → policy decision → result → evidence link).
- **Verification gate:** A scripted end-to-end demo run in CI-adjacent staging: user asks Jarvis (in Persian) to research a topic, plan a change, and request an approval → live web research cited, ≥ 3 tool calls traced, approval blocks the write, approval grant completes it, memory contains the lesson, all with real model keys. Budget enforcement proven (a capped task halts with a budget event). Fallback mode visibly labeled "degraded" in every reply it produces.
- **Commercial value:** This is the demo that raises money / lands design partners. Nothing before it is sellable.
- **Risks:** Cost blowups (mitigate: existing budget rails + caching); latency (streaming hides most); prompt-injection via researched web content (mitigate: tool results sandboxed as data, injection-aware system prompts, governance on all writes — document threat model in `security-and-permissions.md`).

### Phase K3 — The Living Command Universe (UI reset)

**Goal:** One design system, ~15 surfaces replacing ~115 pages, Jarvis omnipresent. Detailed spec in section H.
**Why it matters:** The interface *is* the product perception. Current sprawl actively hides the system's real strengths (evidence, governance, honesty).

- **Backend:** View-model endpoints per surface (aggregate on the server; the dashboard stops joining raw collections client-side). Event stream filtered per surface.
- **Frontend:** Design tokens + primitive library first (section H.2); then Bridge, Jarvis, Rooms, Console, Ledger surfaces; kill remaining collection pages (data lives behind drill-ins). Motion system per H.4.
- **Intelligence/agents:** Jarvis "explain this screen" — every surface can ask Jarvis for the story of its own data (uses the same context assembler, grounded in the view-model).
- **Data model:** `view_preferences` (per user), `domain_links`. No other changes — that's the sign the backend was right.
- **Verification gate:** Every route renders from the design system (zero pages on old scaffolding); Lighthouse perf ≥ 90 on Bridge and Jarvis; p95 surface load < 1.5s against production data volumes; a stranger can find any pending approval, any task's evidence, and any domain's status in < 3 clicks (usability test with 3 outside people, recorded).
- **Commercial value:** The difference between "impressive engine, can't show it" and a product screenshot that sells itself.
- **Risks:** Redesign scope creep (mitigate: token/primitive freeze after week 1; new components require deleting an old one); losing rare-but-needed admin views (mitigate: generic governed data explorer in Console, not bespoke pages).

### Phase K4 — Connected Reality (domains with real data)

**Goal:** AOS knows the operator's real life/business: calendar, email, finance, documents, GitHub — through governed connectors; 4 domain engines live (health, finance, career/business, learning) on the C.6 pattern.
**Why it matters:** Jarvis without real data is a demo. Retention and daily habit come from AOS seeing what the user cannot hold in their head. This is also where "OS for life and business" stops being a metaphor.

- **Backend:** Connector framework (OAuth per provider, per-connector consent grants using the existing consent schemas, sync workers on the queue, honest sync-state surface). Start: Google Calendar + Gmail (read-first), one finance source (aggregator or CSV/manual capture where APIs are regionally unavailable — honest about it), GitHub.
- **Frontend:** Domain rooms fill with real data; connector onboarding flows; per-connector data-access ledger (what AOS read, when, why — this is a trust feature competitors don't have).
- **Intelligence/agents:** Proactive layer: daily brief generated from real events (extend `daily-brain`), risk/opportunity watchers per domain, cross-domain inferences surfaced as suggestions (never silent actions). Conversational capture hardened (Jarvis writes structured domain facts from chat with confirmation).
- **Data model:** `connectors`, `connector_syncs`, `domain_entities` (per-domain collections on the shared scoped pattern), `domain_links`, provenance on every ingested fact (source, sync id, confidence).
- **Verification gate:** Morning brief in Persian references real calendar + email + finance facts with per-fact provenance links; revoking a consent grant provably halts sync and hides data within one cycle; connector failure degrades to explicit "stale since X" (never silently old data).
- **Commercial value:** This is the retention engine and the first thing a design partner will pay for.
- **Risks:** OAuth verification timelines (start Google review early); privacy blast radius grows (mitigate: encryption at rest for connector tokens, data-deletion path built *now*, not at compliance time); regional API gaps for finance (mitigate: manual/CSV ingestion is a first-class citizen).

### Phase K5 — Self-Development v2 + First Customers

**Goal:** Close the loop the project was named for — AOS improves itself through the same governed pipeline a human team would use — and onboard 3–5 paying design partners on the multi-user foundation.
**Why it matters:** Self-development is only credible *after* K1's gates exist; selling is only credible after K2–K4 are real. This phase makes both true simultaneously because they share infrastructure (CI, evidence, governance).

- **Backend:** Self-development pipeline: monitor/reflection surfaces a weakness → improvement proposal (evidence-linked) → approved → code-operator implements on a branch in staging workspace → CI gates (typecheck, tests, smoke) → PR with evidence bundle → owner approves → Dokploy deploy → post-deploy watch → auto-rollback on health regression. Billing/metering: per-tenant usage records (LLM cost records already exist — aggregate them), Stripe, plan limits. Observability: OpenTelemetry traces kernel↔runtime↔providers, error tracking (Sentry), uptime alerting. Backups: scheduled Atlas snapshot verification + restore runbook actually rehearsed.
- **Frontend:** Improvement workflow surface upgraded to show the real pipeline (current `improvement-workflows` pages become real); tenant admin + billing pages; onboarding flow for new users.
- **Intelligence/agents:** Builder agent writes real code through the loop for *bounded* change classes first (docs, tests, new domain metrics, prompt updates) before touching service logic; reviewer agent gates PRs with structured findings; skill library starts being written by the reflection pass and *read* by planners.
- **Data model:** `usage_records`, `invoices/plans`, `deployments` (real history), `rollbacks`, `improvement_runs` (proposal→PR→deploy→outcome chain).
- **Verification gate:** At least 3 self-authored PRs merged and deployed through the full gated loop with zero manual code edits; one induced failure auto-detected and rolled back; 3 external users on isolated tenants for 30 days with zero cross-tenant incidents (verified by automated probes); first real invoice paid.
- **Commercial value:** Revenue starts; the self-development story becomes demonstrably true (fundraising and marketing substance).
- **Risks:** Self-modification safety (mitigate: bounded change classes, protected-core rules stay, human approval stays mandatory); support load from design partners (mitigate: 3–5 max, weekly cadence, expectations written).

**Explicitly deferred beyond K5:** government/public-sector workflows (needs compliance posture, procurement, certifications — see I), robots/physical devices, fine-tuning/custom models (keep collecting the dataset the docs already describe), additional domain engines beyond the first four, GraphQL, NATS.

---

## E. Required Documentation Updates

Rewrite or amend these files; each line says what the file must state after the update.

| File | Required content after update |
|---|---|
| `docs/vision.md`, `docs/mission.md` | Replace with the Section B product definition and ladder verbatim. |
| `docs/master-direction.md` | This document. Referenced from README as the single source of direction. |
| `docs/roadmap.md` | Archive A–AH history into `docs/history/phase-log-archive.md` reference; roadmap becomes K1–K5 only, with gates. |
| `docs/phase-log.md` | Freeze; new entries only for K-phases. Add a header stating the honest reading: prior "DONE" claims describe feature slices, capability classification lives in master-direction §A. |
| `docs/architecture.md` | The 6-deployable topology (C.1), module boundary rules inside kernel, queue/event backbone, agent-runtime loop, where the old 19-service model went and why. |
| `docs/service-map.md` | Regenerate for 6 deployables; agents listed as logical actors of aos-agent-runtime with tool grants, not services. |
| `docs/agent-map.md` | Per-agent: role prompt, model tier, tool grants, approval requirements, memory access. Delete subdomain-per-agent content. |
| `docs/development-rules.md` | Supersede one-service-per-agent and no-local-docker rules (local docker-compose for Mongo/Redis is now correct); add: no `collection()` outside data layer, no new dashboard page outside the design system, no feature merges without tests, no hardcoded model IDs. |
| `docs/service-communication-protocol.md` | Queue-based task dispatch contract, event contract on Redis fan-out, retained manifest/health surface. |
| `docs/memory-strategy.md` | Memory v2 (C.3): transcripts + facts + embeddings + consolidation; token-budget rules for context assembly. |
| `docs/security-and-permissions.md` | Real authn model, RBAC middleware, scope-by-construction, connector consent/revocation, prompt-injection threat model, data deletion. |
| `docs/multi-tenant-governance.md` | Enforcement mechanics (repository layer, indexes, probes), not just schemas. |
| `docs/api-contracts.md` | Regenerate after kernel route split; add Jarvis session/streaming and tool-invocation contracts. |
| `docs/data-model.md` | Add K2/K4/K5 collections (jarvis_sessions/messages, embeddings, tool_invocations, connectors, usage/billing, improvement_runs); mark deprecated collections. |
| `docs/deployment-plan.md`, `docs/dokploy-setup.md`, `deployment/` | 6 apps instead of 19; Redis provisioning; env matrix per deployable. |
| `docs/environment-variables.md` | Regenerate; add model registry, Redis, auth, connector, billing vars. |
| `docs/decision-log.md` | Entries for: consolidation decision, agent-loop adoption, Redis adoption, auth library choice, vector search choice, fallback demotion. Each with rationale + alternatives considered. |
| `README.md`, `README-SETUP.md` | Rewrite for the new topology and local dev flow; remove claims not in §A "Implemented". |
| `TECHNICAL-REPORT.md` | Mark superseded by this document; keep as historical artifact. |
| **New:** `docs/design-system.md` | Tokens, primitives, motion rules, surface map (section H). |
| **New:** `docs/jarvis-spec.md` | Section G verbatim, maintained as Jarvis evolves. |
| **New:** `docs/testing-and-ci.md` | Test taxonomy (unit/contract/scenario/probe), CI gates, staging smoke policy. |
| **New:** `docs/commercialization.md` | Section I; updated as design partners sign. |
| **New:** `docs/domain-framework.md` | C.6 pattern + how to add a domain (the "add a domain in a day" playbook). |
| `shared/src/jarvis` `AOS_SELF_KNOWLEDGE` | Keep the honest-self-knowledge mechanism, but source it from a doc-generated record tied to this file's classification table, so Jarvis's self-description and the master direction cannot drift apart. |

---

## F. Codebase Refactor Plan

**Immediately (K1, weeks 1–4):**
1. Add vitest + first contract tests + GitHub Actions CI (do this *before* any refactor — the refactor needs the net).
2. Split `gateway-api/src/index.ts` into route modules + middleware; zero behavior change; tests prove it.
3. Introduce `scopedCollection(ctx)` data layer in `shared/src/db`; migrate kernel routes to it; lint rule against raw `collection()` outside it.
4. Fold registry, event-bus, file-asset into kernel as modules (their code is small and already library-shaped); keep external contracts stable during transition.
5. Collapse the thin agent shells (all ≤200-LOC services, plus monitor) into `aos-agent-runtime` workers; delete the per-service folders after their handlers move (git history preserves them).
6. Model IDs → config registry; add current-generation defaults; verify with a live health check.
7. Redis: events fan-out, rate limits, safe mode, then task queue.
8. Real auth (sessions + users) replacing the static admin token for humans; internal token stays for service-to-service.

**Wait (do NOT touch yet):**
- Dashboard page rewrites (K3, after the design system exists — rewriting pages now doubles the work).
- New domains beyond the existing four surfaces (K4).
- Any self-development automation expansion (K5).
- Fine-tuning datasets pipeline (keep passively collecting).

**Delete:**
- The ~90 per-collection dashboard pages that K3 replaces (list them in the K3 PR; add redirects).
- Smoke scripts superseded by real tests (each deleted in the PR that converts it).
- `templates/` variants that generate the old thin-shell services (replace with agent-role template + domain template).
- Dead exports in `shared/` after consolidation (measure with knip or ts-prune).
- `_tmp_*` junk files at repo roots.

**Stabilize (keep, harden):**
- Event contracts and envelopes; manifest/health surface; approvals/audit/evidence chain; LLM trace/cost/budget rails; code-operator confinement; voice pipeline; research service and its source-mode honesty; scope schemas; bilingual composer fallbacks (as labeled degraded mode).

**Redesign (K2+):**
- Orchestrator pipeline → agent-loop planner (the 1,302-line deterministic pipeline becomes: goal → LLM plan with tool grants → governed execution → reflection). Keep its governance calls; replace its brain.
- Architect/QA/Reviewer/Report agents → prompted roles with tools (their current bodies are not worth preserving).
- Jarvis command path → session engine (G).
- Heuristic evaluation/scoring/pattern modules → feature inputs to LLM reflection, with UI relabeled ("signals," not "intelligence").

---

## G. Jarvis Command Layer Specification

### G.1 Definition

Jarvis is the **persistent command intelligence between the leader and the OS** — not a page, not a chatbot widget. Architecturally it is a session engine + context assembler + governed tool loop + presence layer. Every other surface is a *view*; Jarvis is the *hand and voice* of the system.

### G.2 Core objects

```
JarvisSession   — long-lived per user (days/weeks), holds transcript,
                  rolling summary, pinned facts, active thread contexts.
JarvisTurn      — user input (text|voice) → assembled context → agent loop
                  (0..N tool calls) → streamed reply + structured extract
                  (priority, blockers, next action — keep the existing
                  AE.1 structured split, it is right).
ToolInvocation  — every tool call: request, policy decision, approval link,
                  result, evidence link, cost. One collection, one ledger.
ContextPacket   — evolution of the existing packet: scope filter → hybrid
                  retrieval (facts, transcript summary, domain state,
                  evidence, research) → weight ranking → token-budgeted
                  packet with per-fact provenance. Grounding invariant kept:
                  Jarvis may only assert from packet + tool results, and
                  `groundedIn` is preserved per reply.
```

### G.3 Behavior contract

1. **Understands every domain** — context assembly draws from all domain engines the actor's scope permits; cross-domain links included.
2. **Reads freely, writes through governance** — read tools auto-execute within scope; write/external tools pass policy → approval when required; the approval renders *inline in the conversation* and in the Ledger. Raw model output never mutates state (unchanged invariant).
3. **Explains decisions** — every consequential reply can expand into: which facts, which tools, which policy decisions, what it cost. This is a UI affordance backed by the trace chain that already exists.
4. **Reports system state honestly** — self-knowledge is generated from the live classification (§E last row), never hand-waved; degraded mode (no keys, stale connectors) is announced, not masked.
5. **Surfaces risk and initiative** — proactive triggers (daily brain, watchers, monitor alerts) open Jarvis threads with a proposal, never a silent action.
6. **Bilingual by construction** — EN/FA parity in intent, composition, and UI copy; language follows the user per turn (existing detection kept).
7. **Multi-transport** — text, voice (existing WebRTC realtime pipeline becomes a transport into the *same* session/tool layer), and later mobile/notification digests. One brain, several mouths.

### G.4 Runtime shape

Turn pipeline: `input → language/intent (fast model) → context assembly → agent loop (standard model; reasoning tier for planning-class intents) → stream tokens + step events over SSE → structured extract persisted → reflection hooks (memory writes with confirmation where user-personal)`. Budgets per turn and per day (existing budget rails). Prompt-cached stable prefix: persona + tool defs + pinned profile.

### G.5 What Jarvis is not

Not an unrestricted shell (tool grants are explicit), not a search engine (research service does that, cited), not a mood-mirroring companion (tone: calm, precise, professional), and never a fabricator — "I don't have that connected" stays a first-class answer.

---

## H. Living Command Universe — UI Specification

### H.1 Diagnosis-driven principles

The current UI fails structurally: ~115 sibling pages, no token system, per-collection dumps, inconsistent components. The correction is not more polish per page — it is **fewer, deeper, composed surfaces on one visual language**.

Principles: one design system or it doesn't ship; realtime is ambient (event-driven state changes, not spinners); honesty is visual (known/stale/not-connected/degraded are distinct visual states everywhere); motion carries meaning (state transitions animate, decoration doesn't); density with hierarchy (a command center, not a marketing page); every surface answers "what needs me, what changed, what's next."

### H.2 Design system (build first, freeze early)

- **Tokens:** spacing (4px base), radius, type scale (one variable sans + mono for data; verified Persian companion face — test RTL/mixed-direction early, it will break layouts late), color as semantic roles (`surface/1..3`, `ink/1..3`, `accent`, `ok/warn/critical/neutral-unknown`), elevation/blur tiers for the glass layers, motion durations (fast 120–160ms, standard 200–260ms, deliberate 320–400ms) with standard easings.
- **Primitives (~16):** Panel (glass tiers), Card, Stat, Badge/Status, Timeline, DataGrid (virtualized — one grid, everywhere), Command Palette, Approval Prompt, Evidence Chip (provenance affordance), Sparkline/Trend, Domain Ring (the status motif domains share), Toast/Alert, Drawer/Inspector, Tabs/Segmented, Form controls, Skeleton.
- **Aesthetic:** the requested iOS-26-class discipline — soft glass over deep neutral field, restrained accent light, generous spacing, readable first. Nothing childish, no random particles, no fake terminals.

### H.3 Surface map (~15 routes replacing ~115)

```
/bridge            — Home. Jarvis brief, focus row, pending approvals,
                     live activity, domain rings, alerts. The room you land in.
/jarvis            — Full command session (streaming, steps, explanations).
                     Also present everywhere as a persistent dock + ⌘K palette.
/universe          — Spatial map of domains + system: status, relationships,
                     cross-domain links (evolves the existing domain canvas).
/domains/:domain   — Rooms (health, finance, career/business, learning, …):
                     domain header state → timeline → entities → intel
                     (risks/opportunities/recommendations) → governed actions.
                     One shared room chassis, per-domain visual identity
                     within tokens (the health room is the prototype).
/operations        — Tasks/runs/queue live view; drill into any run's steps,
                     traces, costs. (Replaces tasks/operations/agents pages.)
/governance        — The Ledger: approvals inbox, policy decisions, audit,
                     consents, access log. The trust product, made visible.
/memory            — Memories, skills, session summaries, provenance search.
/evidence          — Evidence explorer (keep; restyle).
/research          — Reports + live research threads (keep; restyle).
/system            — Console: deployables health, LLM status/costs/budgets,
                     incidents, repair, deployment state, self-development
                     pipeline. (Absorbs ~40 current kernel pages as tabs/
                     drill-ins, plus one generic governed data explorer
                     replacing all remaining raw-collection pages.)
/settings          — Profile, tenants, connectors, models, billing.
```

### H.4 Jarvis presence (the fundamental redesign requested)

Jarvis is a **layer, not a page**: a persistent dock (collapsed: status pulse + one-line awareness; expanded: session) available on every surface; ⌘K command palette routed through the same intent engine; inline approval prompts; "explain this" on every panel opens Jarvis pre-grounded in that panel's view-model; voice toggle enters the same session. Visual identity: calm geometric presence animating only with meaning (listening / reasoning / executing / awaiting-approval / degraded are distinct, subtle states) — no cartoon orb, no fake waveforms while idle.

### H.5 Realtime discipline

One SSE/event client feeding a client store; server-computed view-models per surface (kill client-side collection joins); virtualized lists; optimistic UI only for user-owned actions; every panel has honest empty/stale/degraded states designed on day one.

---

## I. Commercialization Path

**Positioning:** "A governed AI chief of staff that runs on your life and business — with memory, evidence, and an approval ledger." The governance/honesty layer is the moat; every competitor demos autonomy, almost none can *account* for it.

**Stage 0 (now → end of K2): Internal truth.** One real user (the owner) using Jarvis daily. Metric that matters: owner-initiated Jarvis turns/day and % of turns that touch a real tool. Nothing is sold.

**Stage 1 (K3–K4): 3–5 design partners, paid pilots.** First users: founders / solo operators / small agency owners who already juggle business + personal ops and feel the pain of context scattered across tools; the Persian-speaking founder/diaspora niche is a defensible first wedge (bilingual Jarvis is rare). First use case sold: **the daily command brief + governed research + approvals over real calendar/email/finance** — not "an AI OS." Price as a pilot ($100–300/mo range, positioned as concierge software; validate willingness, not revenue).

**Must be real before any sale:** real auth + tenant isolation (K1) with automated cross-tenant probes; data deletion and export; encrypted connector tokens; a written privacy policy honestly matching data flows; uptime monitoring + backup restore rehearsed; billing that meters LLM cost per tenant (the cost records exist — aggregate them); degraded-mode honesty in UI. **Can stay internal:** self-development engine (it is your velocity advantage, not their feature), Dokploy specifics, voice (beta flag), domains beyond the first four.

**Stage 2 (post-K5):** team/tenant product (shared domains, roles, delegated approvals) for 10–50 person companies. **Stage 3 (deliberately distant):** Government OS — pursue only after Stage 2 revenue, via one small pilot workflow (e.g., a municipal case-management adjacent process) with a partner integrator; the compliance/procurement burden (audits, certifications, data residency) is a multi-year commitment that would kill the company if attempted first. The architecture keeps the door open (scope model, audit, evidence, consent); the business must earn its way there.

---

## J. Critical Next Actions (priority order)

1. **Install vitest + write the first 30 contract tests** (shared schemas, envelopes, auth guards) and stand up GitHub Actions CI (typecheck + test + build, required on main). *Nothing else starts first.*
2. **Split the gateway monolith** into route modules + shared middleware, behavior-frozen, proven by the tests from (1).
3. **Ship `scopedCollection(ctx)`** in `shared/src/db`, migrate kernel routes, add the lint rule, and write the cross-tenant read/write failure probes.
4. **Provision Redis** (Dokploy service) and move event fan-out, rate limits, and safe mode onto it; verify with a two-instance kernel test.
5. **Consolidate the 13 thin agent shells** into `aos-agent-runtime` with a BullMQ task queue; delete the shells; regenerate `deployment/` for 6 apps.
6. **Replace static human auth** with real users/sessions (choose the library via one research-service pass; document in decision-log); keep internal token for services.
7. **Move model IDs to a config registry** with current-generation defaults and tiers; add a startup health check that verifies the configured models respond.
8. **Build the agent loop** (native tool use, step budgets, step-level traces, streaming step events) in aos-agent-runtime; port the operator tool registry into it under the existing governance gates.
9. **Build the Jarvis session engine** (transcripts, rolling summary, streaming SSE) on that loop, with the K2 end-to-end verification scenario scripted and repeatable.
10. **Ship retrieval memory:** embeddings + Atlas Vector Search + hybrid context assembly feeding the existing packet ranker.
11. **Freeze the design tokens + 16 primitives** (`docs/design-system.md`), then build `/bridge` and `/jarvis` as the first two K3 surfaces.
12. **Execute the documentation rewrite** in §E in the same PRs as the code they describe — direction docs first (vision, architecture, roadmap, development-rules), generated maps after consolidation.

Each action lands as a PR against `main` with tests, a decision-log entry where a choice was made, and no scope beyond its line above.

---

*End of master direction. This document is the arbiter: when any older document, phase log entry, or code comment disagrees with it, this document wins until a decision-log entry says otherwise.*
