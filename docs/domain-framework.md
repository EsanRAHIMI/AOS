# Domain Framework (K2 — D-177)

How AOS scales across every area of life/work without a new deployable per
domain (master-direction §C.6). A domain = data + policy + prompts + tools +
one room — never a new service.

## The mission/objective backbone

Every domain's work hangs off ONE durable hierarchy (`shared/src/missions`,
collection `mission_nodes`):

```
vision → strategic_objective → program → mission → plan → task → action
                                                       ↳ evidence / outcome / lesson
```

Integrity by construction: each node type may only attach to its declared
parent (`NODE_PARENT`), and creation is duplicate-guarded (same normalized
title + same parent + active ⇒ reuse, never duplicate). Cross-domain edges
(finance→stress→health, career→learning) are expressed by linking nodes and by
`linkedDecisionMemoryIds` / `linkedResearchIds`.

Jarvis creates and updates this hierarchy from natural language through the
governed `mission_create` / `mission_update` / `mission_list` / `mission_tree`
/ `mission_health` tools.

## Memory as the shared domain substrate

`shared/src/memory2` (`memory_records`) holds confirmed/inferred/temporary
facts, preferences, commitments, decisions, people, projects, research
knowledge, lessons and skills — scoped per owner, provenance-tagged. Domains
read/write it through the `memory_*` tools. This is what makes any domain
"remembered" without a bespoke store.

High-stakes domains (finance, health, legal) stay **advisory and
approval-governed**: facts are never fabricated, and mutating tools carry
`requiresApproval`.

## Research feeds every domain

`shared/src/research/providers` gives every domain the same independent
retrieval stack (SearXNG/direct/RSS/sitemap) with a provenance ledger
(`research_sources`, publication + retrieval dates). Findings become
memories/missions, not disposable reports.

## Adding a domain (the playbook)

A new domain (e.g. "family", "opportunities") needs, at most:

1. **Schema** — if the domain needs structured entities beyond `memory_records`
   and `mission_nodes`, add a scoped collection following the ScopeFields
   pattern (or reuse the existing personal collections in `shared/src/personal`).
2. **Tools** — register domain read/write tools in a `buildCoreToolFamilies`-
   style module with correct policy categories (read auto; sensitive → approval).
   Mark unconfigured integrations `available:false` with a reason.
3. **Prompts** — a versioned role prompt if the domain warrants a specialist
   role (mandate §J roles are prompted actors on the shared loop, not services).
4. **Room** — one dashboard surface on the shared chassis (see the health room
   prototype); it renders the domain's mission nodes, memories and research.

No new deployable, no new queue, no new auth. The agent loop, governance,
memory, missions and research are shared infrastructure; a domain is
configuration + prompts + one room on top of them.

## Roles (specialist actors, not microservices)

Orchestrator, Researcher, Architect, Planner, Code Operator, Reviewer, QA,
Risk/Policy Analyst, Personal Chief of Staff, Financial Planning Assistant,
Learning Coach, Opportunity Analyst, Executive Reporter, Reflection Agent —
each is a **versioned prompt + tool grants + scope rules + output contract** on
the ONE shared agent loop (`startAgentLoop({ role, systemPrompt, grants, ... })`).
The Jarvis role (`jarvisSystemPrompt`, `JARVIS_ROLE_PROMPT_VERSION`) is the
reference implementation.

---

## Personal operating state as-built (D-178)

Personal domains do NOT get a new architecture. `shared/src/personal2/index.ts`
is a thin owner-facing layer over the two existing stores:

- **Memory v2** (`memory_records`) carries commitments, decisions, people,
  notes, deadlines, opportunities, risks, preferences — with
  confirmed/inferred status + provenance + last-confirmed timestamp.
- **Missions** (`mission_nodes`) carry goals/objectives → programs → missions →
  plans → tasks → actions.

`buildPersonalStateSnapshot(actor)` aggregates both into one owner-scoped read;
`applyOnboardingAnswers(actor, answers)` deterministically turns a small set of
explicit owner answers into confirmed, provenance-tagged records + a seed
vision (nothing fabricated — empty answers are skipped). Governed tools:
`personal_state` + typed writers (`personal_add_commitment/decision/person/
note/opportunity/risk`). HTTP: `/v1/jarvis/personal-state`,
`/v1/jarvis/onboarding`. Adding a new domain still = data + policy + prompts +
tools + one room; no new deployable.
