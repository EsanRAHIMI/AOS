# Decision Log

Records significant engineering decisions and why. Newest first.

## 2026-07-09 — Phase AG Real Research & Intelligence Fabric

### D-132 Tavily as the first real web-search provider, behind a swappable `WebSearchProvider` interface
Chosen over Serper/Bing because it's purpose-built for LLM/RAG grounding (returns concise content
snippets ready to feed a prompt, not raw HTML to parse) and has a single-endpoint REST API with no
OAuth flow — matching the existing "direct `fetch()`, no SDK" style already used for
Anthropic/OpenAI/GitHub/Dokploy clients in this codebase (`shared/src/llm`, `shared/src/github`,
`shared/src/dokploy`). The `WebSearchProvider` interface is provider-agnostic by design — a second
provider can be added later without touching `runResearch()`. `webSearchProviderFromEnv()` returns
`null` (not a Mock provider) when `TAVILY_API_KEY` is unset — there is no honest deterministic
stand-in for "the internet said X", unlike the LLM router's `MockProvider`, which validly returns
an empty completion for its caller to handle via the existing fallback path.

### D-133 `sourceMode` tracked separately from `mode` — a real LLM does not mean a real URL
`ResearchRun`/`ResearchReport`/`ResearchSource.mode` already tracked whether the LLM call was real
or fallback. That said nothing about whether the *source URLs* were ever verified to exist — before
this phase, even "real" mode meant an LLM recalling plausible-looking URLs from training data, the
exact "no fake success" violation flagged in `TECHNICAL-REPORT.md` §9 and `docs/roadmap.md`'s
carried-forward research-fabric item. New `sourceMode: 'search_api' | 'llm_only' |
'curated_fallback'` is orthogonal: a run can be `mode: 'real'` (genuine LLM reasoning) with
`sourceMode: 'llm_only'` (URLs unverified) at the same time — both facts are true and both are now
surfaced, including as separate badges in the `/research` dashboard pages, rather than collapsed
into one "real" label that overstated what was actually verified.

### D-134 When grounded, source URLs are always rebuilt from the real search results, never from the LLM's echo
`runResearch()` asks the LLM to "echo back" the given search result URLs in its structured output
(so the schema-required `sources` field is still populated), but the final `ResearchSource` records
are constructed directly from the original `WebSearchResult[]` the provider returned — the LLM's own
`sources` field is discarded entirely when grounded. An LLM can typo, truncate, or subtly alter a
URL even under an explicit instruction to reproduce it exactly; rebuilding from the original data
makes that class of error structurally impossible rather than trusting the model to be faithful.
Verified directly in `scripts/phaseag-research-fabric-smoke.mjs` with a fake router that
deliberately echoes a different, wrong URL.

### D-135 A configured search provider with no LLM still returns real results, never degrades to canned fallback text
The pre-existing `fallbackResearch()` (curated, hand-written OWASP/NIST text) is now used only when
*neither* search *nor* a real LLM is available. When search succeeds but the LLM is unavailable or
fallback-forced, a new `fallbackFromSearchResults()` builds findings directly from the real
retrieved snippets instead — configuring search should never make output *worse* than the
LLM-recall path it's meant to improve on.

## 2026-07-09 — Phase AF.5 Dedicated Per-Domain Routes

### D-129 One `/v1/me/universe/detail` endpoint for all nine domains, not nine separate endpoints
Each dedicated room needs the FULL unsliced records for its domain, not the 3-6 item homepage
summary `/v1/me/universe` returns. Rather than add nine narrow endpoints (one per domain, each
duplicating the same scoped-query pattern), one endpoint reuses the exact same collections, same
`userId` filter, and the same `buildUniverseZones()` call as `/v1/me/universe`, and additionally
returns the complete per-domain arrays. This guarantees every room reads from one consistent
snapshot and keeps the "comparable" requirement structural rather than aspirational — a ninth
endpoint could quietly drift in shape from the other eight; one shared endpoint cannot.

### D-130 A dedicated room is a front door, not a replacement for an existing deep page
`/me/reality`, `/me/projects`, `/me/opportunities`, `/me/resume`, `/operations`, and
`/settings/connectors` already did real, deep, CRUD-style management for some domains before this
phase. Rebuilding all of that inside nine new rooms would have duplicated working UI for no
reason. Instead every room (`DomainRoom` component) follows the identical structure — header,
metrics, visual, actions, "go deeper," full record list — and the "go deeper" section links onward
to whichever pre-existing page already manages that domain in more depth
(`services/dashboard-web/src/lib/domainRoomLinks.ts` is the single manifest for this mapping).
Domains with no pre-existing deep page (life, finance,
most of daily, and learning tracks specifically) rely on the room's own full record list being the
complete picture — nothing was invented to fill the gap.

### D-131 Zone hrefs changed for all nine domains, including two that already worked
`systems` (`/operations`) and `presence` (`/settings/connectors`) already pointed at real,
dedicated, comprehensive pages before this phase — only health/life (colliding on `/me/reality`),
finance (mismatched to `/me/opportunities`), daily/ventures/growth/opportunities (generic or
partially-dedicated) were the documented complaints
(`docs/living-command-universe-vision.md` §A.4). Systems and presence were changed anyway, to
`/systems` and `/presence`, so that "click Open on any zone" behaves identically across all nine —
a comparable front door for every domain — rather than seven zones landing on a new room and two
zones landing directly on an old page with a different visual language. Both new rooms deep-link
straight back to the original pages, so no existing functionality was removed or hidden.

## 2026-07-09 — Phase AF.4.4 Live-State Cap Hardening

### D-127 `activeSessions` limit raised 5→20 as a correctness fix, not a cosmetic tweak
The old `opSessions.find({ status: in active states }).limit(5)` meant a 6th concurrent active/waiting-approval
session silently vanished from both the Overview panel and the Live Activity feed — not a display nicety but a
real operation going invisible to the operator. Raised to 20 (a realistic ceiling for concurrent Jarvis
sessions on a single-operator system; not unbounded, so a runaway loop still can't grow the payload without
limit). `recentSessions`/`recentTasks` raised 5→10 and `recentEvents` 30→50 for the same reason — these feed
`buildOperationFeed`'s grouping, and a too-tight window meant a fast-moving operation's supporting events could
already be evicted before the card patched correctly. `pendingApprovals` (limit 10) was left unchanged since
approvals are only ever "waiting on you," a state a single operator resolves quickly, and it already generously
exceeds realistic pending-approval counts.

### D-128 Overview stays capped at 4 visible active-session rows regardless of backend snapshot size
`ActiveOperationsPanel` is the concise homepage summary, not the full operations view — raising the backend
limit to 20 without a companion UI cap would have let a busy day balloon the Overview module to 20 rows,
directly undermining its purpose. Kept `.slice(0, 4)` (matching the pattern already used for
`pendingApprovals`/`recentTasks` in this same component) with an honest "+N more active — open Jarvis" link
rather than a fake "and more..." label with no action. The full, scrollable, all-of-them Live Activity feed
(AF.4.3's `buildOperationFeed`) remains the place every active operation is always visible as a real card.

## 2026-07-09 — Phase AF.4.3 Live Activity Module Rebuild

### D-125 An approval is merged into its session's card, not rendered as its own item
A pending `OperatorToolPermission` always belongs to exactly one `runtimeSessionId` and exists only because
that session is blocked — it is not an independent operation. `buildOperationFeed` matches an approval to its
session by that shared id and updates the session card's status/meta rather than creating a second card,
directly matching the product requirement's own example output ("one operation card ... status: waiting
approval"). A standalone approval card is only created in the defensive case where a pending approval
references a session absent from the current snapshot — real data is never dropped, just shown minimally.

### D-126 Scoped inline styles instead of editing the shared `.feed` CSS class
`Live Activity`'s box needed a fixed height and internal scroll, but the global `.feed` class it used is
referenced by 12 other pages (task/incident/capability detail timelines, the `/events` page, ...). Giving it a
`max-height`/`overflow` would have changed those unrelated pages' timelines too — directly against this
phase's explicit "do not touch unrelated parts" instruction. `LiveEvents.tsx` now builds its own scoped
inline-styled card list instead of reusing `.feed`, leaving every other consumer of that class untouched.

## 2026-07-09 — Phase AF.4.2 Re-verification + Actor-Scoping Investigation

### D-124 `live-state` stays globally scoped behind RBAC, not per-record actor-filtered
Investigated adding per-actor filtering to `GET /v1/operator/live-state`. `OperatorRuntimeSession.userId`
actually stores the declared RBAC role (`'owner'`, `'agent'`, …), not a real per-person id;
`OperatorToolPermission` has no actor field at all; no sibling endpoint (`/v1/operator/sessions`,
`/v1/tasks`, `/v1/events`, `/v1/approvals`) filters by actor today. Filtering by role risks hiding real
active operations from the single human owner the moment any session was ever created under a different
declared role — a regression against this phase's own core goal. Kept the existing `guard(req)` RBAC gate as
the access boundary (consistent with every sibling endpoint) instead of inventing a filtering scheme the data
model doesn't actually support. [[D-116]] [[D-122]]

## 2026-07-09 — Phase AF.4.1 Persistent Live Operation Feed, Hydration Fix & Approval UX Hardening

### D-123 A stable placeholder render, not `suppressHydrationWarning`, fixes the relative-time mismatch
The reported hydration bug (`PresenceBar` rendering "3s ago" server-side and "5s ago" client-side) could have
been silenced with `suppressHydrationWarning` on the offending element — that hides the React warning but
does nothing about the underlying cause, and the visible text would still visibly jump right after load.
Instead, `RelativeTime.tsx` renders an identical, non-time-dependent placeholder on both the server pass and
the client's first render (so there is genuinely nothing to reconcile), and only computes the real elapsed-
time label inside `useEffect`, which by construction never runs during SSR. The fix addresses the actual
value mismatch rather than muting React's warning about it.

### D-122 `IMPORTANT_OPERATOR_EVENT_TYPES` lives in `shared/src/constants`, not duplicated per-service
The live-state endpoint's Mongo query (gateway-api) and the `LiveEvents` SSE subscription list + grouping
decision (dashboard-web) both need to agree on which events count as "important enough for the default feed."
Rather than maintaining two independently-edited allowlists that could silently drift apart (one service adds
a new important event type and forgets the other), the allowlist is one exported array in
`shared/src/constants`, imported by both. [[D-116]]

### D-121 `'live-pulse'` is a real block, not a redesign of the block-invalidation model
AF.4's 12-block manifest already reserved `'live-pulse'` as a named block but nothing invalidated it — the
Active Operations panel and the upgraded Live Activity card are wired to it exactly the same way every other
block already works (`UniverseProvider.refresh()`, the `aos:invalidate-blocks` bus, `LiveEvents`' SSE bridge).
No new invalidation mechanism was introduced; this phase's UI additions plug into AF.4's existing model rather
than inventing a parallel one. [[D-118]] [[D-117]]

### D-120 Optimistic approval feedback disables and relabels the clicked button; it does not fabricate a
### success state
Real user testing found the multi-second gap between clicking Approve and seeing any change felt broken. The
fix sets a `decidingAction` state immediately (before the network call) that disables both buttons and swaps
the clicked one's label to "Approving…"/"Rejecting…" — but the actual session/permission state is not touched
until the real backend response lands, and `decidingAction` is cleared in a `finally` block so a failed
request still leaves the UI in an honest, interactive state rather than stuck showing a decision that never
actually happened.

## 2026-07-09 — Phase AF.4 Realtime Block Runtime, Fast Jarvis Response & Operation Lifecycle Fix

### D-119 `createTaskInlineAction` is a new sibling, not a modified `createTaskAction`
The existing `createTaskAction` unconditionally `redirect()`s to `/tasks/:id` — correct for the dedicated
task-creation forms/pages that already depend on that navigation, wrong for an inline Domain Canvas control
where navigating away on every "create task" click would violate the phase's "update in place" requirement.
Rather than making the redirect conditional (which would change behavior for every existing caller and
require threading a flag through), a second, smaller function with the identical permission check and
gateway call — just without the `redirect()` — was added alongside it. `createTaskAction` and its callers are
completely unchanged.

### D-118 Client-side referential-identity merge instead of a per-block backend endpoint
The backend only exposes one combined `/v1/me/universe` endpoint; building nine separate per-zone endpoints
was out of scope for this phase and not clearly justified yet. `UniverseProvider.refresh(blocks)` instead
refetches the one real endpoint and replaces only the `Map` entries for zones whose block was actually
requested, leaving every other zone's object reference untouched — components reading an unaffected zone
correctly skip re-render. This is "block-level" in the sense that matters (React update scope), built
honestly on the real endpoint that exists rather than a fabricated one; the network cost of refetching the
whole universe payload on every refresh is a known, accepted tradeoff, not a hidden one — see the phase-log's
"honest remaining gaps."

### D-117 A `window` CustomEvent bus for cross-tree invalidation, not a second SSE connection or prop drilling
`OperatorConsole` is mounted at the root layout, outside `page.tsx`'s React tree where `UniverseProvider`
lives — it cannot call `useUniverse()` directly, and prop-drilling a refresh callback through the layout
would require restructuring the mount order. A `window` `CustomEvent('aos:invalidate-blocks')` was chosen
instead, mirroring the app's existing `aos:jarvis` event (used the opposite direction, `UniverseZone` →
`OperatorConsole`) — a precedent already established and working, not a new pattern. `invalidateBlocks()` is
a safe no-op when no provider is mounted, so calling it from a component that might render on a non-homepage
page is never an error. Extending the app's one existing `LiveEvents` `EventSource` to also call
`invalidateBlocks()` (rather than opening a second `EventSource` anywhere) was the same reasoning applied to
the SSE side specifically.

### D-116 Session execution is backgrounded per-request, not moved to a job queue
The 10+ second Jarvis latency came from three sequential LLM-bound calls plus a fully synchronous tool loop,
all inside the request/response cycle. A full job-queue rewrite (e.g. a dedicated worker service consuming
from a queue) would have been the "correct-at-scale" answer but was more architecture than this bug needed:
the existing `opSessions` collection plus the client's already-working 2.5s poll were enough infrastructure
to support "return immediately, keep working in the background, let the poll observe progress" — the fix was
backgrounding the same in-process work (`void (async () => {...})()`, individually try/catch-wrapped so a
failure still writes an honest `status: 'failed'`) and making `recordStep` persist incrementally so the poll
has something real to observe mid-run. A queue-based rewrite remains a reasonable future step if session
volume ever makes in-process backgrounding insufficient, but wasn't justified for a first pass at the actual
reported bug.

## 2026-07-09 — Phase AF.3 Jarvis Guided Control & Domain Action Layer

### D-115 A blocker without a schema field becomes a risk record, not a new column
`PersonalProject` has no blocker or next-action field. Rather than adding one (a schema change touching the
zone builder, the ingest handler, and every consumer), "report blocker" routes through the already-real
`risk` ingestion kind, and "next action" routes through already-real task creation. Both are honest, existing
record types that already mean approximately the right thing — adding a narrower-purpose field later remains
possible without this decision blocking it, but wasn't justified for a first pass.

### D-114 Opportunity "Save" reuses the `accepted` status — no new status value invented
The phase brief asked for "save/reject/follow" on an opportunity. `PersonalOpportunity.status` only has
`proposed/accepted/rejected/in_progress/done/expired` — there is no `saved`. Introducing a new enum value
would touch the shared schema, the zone builder's status filter (`['proposed','accepted','in_progress']`),
and every place that reads status. `accepted` is the closest existing real meaning ("keep pursuing this"), so
"Save" maps there; a future phase can split them if the product actually needs the distinction.

### D-113 Add-data and opportunity-decision actions get an in-form preview, not a new approval gate
Item 5 of the phase brief asks Jarvis to show what it understood, what's missing, and what happens on
approval. The existing `session.pendingPermission` UI already does exactly that for the one class of action
that requires owner approval. Ingest (`POST /v1/me/reality/ingest`) and next-action/opportunity decisions
were never gated by that system — they are, and always were, scope-enforced-but-unapproved personal CRUD.
Building a second, parallel "pending approval" flow for these would misrepresent their actual risk tier (and
contradict the existing `/me` forms that already write through them with no approval step). Instead
`DomainActionControl` shows a one-line preview of exactly what will be created before a lightweight
client-side Confirm — honest about the (low, personal-scope) stakes of the action instead of inventing
ceremony that doesn't match the rest of the system.

### D-112 `itemId` is additive and opt-in per zone, not a blanket `ZoneItem` requirement
Per-item decide controls (accept/reject an opportunity or next-action) need a real record id, but most zone
items (health metrics, life items, finance obligations, ventures, learning tracks) aren't individually
decidable records at all — they're facts or aggregates. Rather than forcing every zone's items through a
decision-capable shape, `itemId` stays `optional` on `ZoneItem` and is only populated by the two zone
builders (`daily`, `opportunities`) that have a real underlying record and a real decision endpoint. A decide
control only ever renders when `itemId` is present, so there is no risk of a control appearing for a
record that can't actually be decided on.

## 2026-07-09 — Phase AF.2 Full Domain Canvas Expansion & Jarvis-Guided Interaction

### D-111 The generic item list is a fallback, not a supplement — suppress it when a real visual exists
`UniverseZone.tsx` was unconditionally rendering both a domain's custom visual (`children`) AND the same
`zone.items` again as a plain bullet list underneath it, for every zone that had one (Health/Finance/Systems/
Presence since AF.1). This is a real duplication bug, not a design choice — found while wiring in
`domainInsight`. Fixed by rendering the generic list only `!children`. Directly addresses part of the user's
"still too text-heavy" complaint: some of that text was literally the same data rendered twice.

### D-110 One unified domain-specific annotation replaces two separate boxes
AF.1 had two separate explanation surfaces on a card: `JarvisAnnotation` (attention-only, generic "Jarvis
suggests" line) and a dashed setup-hint box (setup_needed/not_configured only), deliberately kept apart in
AF.1 to avoid restating the same text twice. AF.2's `buildDomainInsight()` makes each zone's explanation
genuinely different per domain/status, so the two-box split is no longer needed to avoid redundancy — one
annotation now covers attention/setup_needed/not_configured/opportunity uniformly. The dashed box is kept
only as a defensive fallback for a hypothetical zone type with no insight branch (should never render in
practice, since all nine real zoneIds are covered).

### D-109 Domain links point at homepage anchors, not secondary pages — because that's where the real work is
Before this phase, `domainLinks.ts` pointed Jarvis's "Related: Zone →" chips at `/me/*` secondary pages that
were still generic list views. Now that every zone has a real, domain-specific visual on the homepage itself
(`/#zone-<id>`), pointing there is more honest than pointing at a page that hasn't been upgraded yet.
`approvals_tasks` is the deliberate exception — Approvals is a real distinct workflow page, not a Domain
Canvas zone, so re-pointing it at a zone anchor would be incorrect, not just unnecessary.

### D-108 Fix the dropped financial-risk-items bug now rather than deferring it
While building the finance zone's Jarvis insight text, direct code reading found `FinanceFlow.tsx` only ever
read `tone: 'warn'` items from `zone.items`, silently dropping the `tone: 'err'` financial risk items the
backend's `finRisks` computation already produces. This is the exact "half-used backend data" pattern flagged
twice by the user (first for `/v1/jarvis/briefing`, again for `memoryInsights`). Fixed immediately as part of
this phase rather than filed as a follow-up, since it was directly in the file already being touched and the
fix is small, additive, and zero-risk (purely additive rendering, no contract change).

## 2026-07-09 — Phase AF.1 Living Command Universe Foundation

### D-107 Refactor the persistent shell in place — do not create a second Jarvis surface
`OperatorConsole.tsx` already lived in `app/layout.tsx`, mounted once, outside every `page.tsx` — so its
state already survived navigation before this phase touched it. The temptation was to build a brand new
"JarvisShell" component from scratch to match the vision doc's language. Rejected: that would create two
competing Jarvis surfaces (old console + new shell) and risk losing the working voice/session/approval logic
during a rewrite. Instead the existing component was extended in place — ambient mode added, expanded mode
unchanged — honoring the explicit instruction "refactor or wrap it properly rather than duplicating it badly."

### D-106 System-warning-last is a structural guarantee, implemented twice on purpose
The exact rule Phase AE.1 enforced in `composeJarvisResponseFallback` (explicit priority outranks system
health) is re-implemented independently in `src/lib/focus.ts::buildFocusItems()` for the homepage Focus Row,
rather than trying to share one function across the `shared` package and the Next.js app. Two independent,
each-unit-tested implementations of the same rule in two different layers (answer composition vs. homepage
ranking) is preferred here over a forced shared abstraction across a package boundary that would need its own
plumbing — simplicity and testability at each layer over premature cross-layer reuse.

### D-105 No second live-event subscription without proven need
The ambient shell's activity indicator reuses the SAME `session` state the expanded panel already polls —
it does NOT open an independent SSE/EventSource connection alongside `LiveEvents.tsx`'s existing one. Adding
a second subscription "for the shell" with no concrete content plan for it yet would be exactly the kind of
speculative, not-really-used code this phase was chartered to eliminate. Recorded as a deliberate scope cut,
not an oversight — a future phase can add it once there's a specific cross-page live signal worth showing.

### D-104 A domain-link chip only where the data is real — no guessed categories
`domainLinkFor()` is applied only to `answer`-kind operator replies, which carry a real, already-classified
`intentCategory`. `session`-kind replies do not currently return `intentCategory` from
`/v1/operator/command` at all (confirmed by reading `services/gateway-api/src/index.ts` directly — the
session response object never sets that field). Rather than guessing a category from the goal text
client-side (which would be exactly the "fake intelligence" this phase forbids), the domain-link chip is
scoped to only where the real classification exists, and the gap is recorded honestly as a follow-up instead
of papered over.

## 2026-07-09 — Phase AE.1 Jarvis Priority & Memory Correction

### D-103 Recency is the supersession mechanism — no deactivation write needed
`pickActivePriorityFact()` always picks the most recent `priority`/`decision` fact from a
newest-first-sorted list. When the owner restates a priority, the OLD fact is never mutated or marked
inactive — it simply stops being picked once a newer one exists. This was chosen over an explicit
deactivation write (which would require the extraction step to know about and update prior records) because
it's simpler, cannot drift out of sync, and is trivially testable (confirmed in
`scripts/phaseae1-jarvis-priority-memory-smoke.mjs`: a restated priority supersedes the old one with zero
extra writes). The `active` field still exists on `JarvisMemoryFact` for a future explicit "forget X" command,
but nothing sets it to `false` yet — documented honestly as a known gap, not implemented speculatively.

### D-102 A correction gate, not a second LLM call
Phase AE's `composeJarvisResponse()` is grounded by PROMPT INSTRUCTION, not by construction — a real
conversation proved a model can still ignore a present, high-weight `user_priority` fact and lean on louder
system-health text instead. Rather than adding a retry-with-different-prompt loop (non-deterministic, harder
to test, another LLM call in the hot path), `answerIgnoresStatedPriority()` is a pure, cheap check, and the
correction is the EXISTING deterministic fallback (`composeJarvisResponseFallback`), which structurally
cannot skip a present `user_priority` fact. Same philosophy as the rest of Jarvis: prefer a deterministic,
testable safety net over a smarter-but-unpredictable second model call.

### D-101 An explicit stated priority is injected as its own weight class, above system health
`gatherJarvisFacts()` now unconditionally queries `jarvis_memory_facts` and injects `user_priority` (weight
20), `user_blocker` (weight 12), `user_decision` (weight 11) — all deliberately above the system-health
ceiling (~10). This was the actual root cause of the failing conversation: extraction and persistence
already worked (Phase AE), but nothing ever read the collection back into context, so an explicitly-stated
priority was structurally invisible to every future answer regardless of how it ranked. Unconditional
retrieval (not gated by intent category) was chosen over per-category logic because the failing conversation
showed intent classification itself is an unreliable gate for this — Persian phrasing regularly falls
through to `general_conversation` or `clarify`, and the fix must not depend on getting classification right.

### D-100 Priority/blocker/next-action are structurally separated in the response, not just prose-ordered
`JarvisResponseSchema` gained `primaryPriority` / `activeBlockers` / `nextAction` fields alongside the
existing `reply` string. `composeJarvisResponseFallback` populates all four consistently from the same
underlying facts, so a caller (briefing endpoint, quality scoring, a future dashboard) can programmatically
tell "what the owner said matters" from "what's technically broken" instead of re-parsing prose. Additive
only — `reply`/`language`/`suggestedFollowUps`/`groundedIn` are unchanged, so nothing that already consumed
`JarvisResponse` needed to change.

## 2026-07-09 — Phase AE Jarvis Memory, Daily Brain & Real Context Upgrade

### D-099 Quality scoring is pure and never LLM-graded
`scoreJarvisAnswer()` is a deterministic function with zero LLM calls — it grades the ALREADY-COMPOSED
reply against the context packet it claims to be grounded in, using structural checks (do the claimed
`groundedIn` labels exist, does the reply contain generic dead-end phrasing, does the declared language
match the detected input language). This means LLM-composed and fallback-composed answers are graded by
the exact same bar, the score is reproducible for the same inputs, and scoring itself can never become
another thing that "sounds right but might be lying" — the failure mode this whole project exists to avoid.

### D-098 Completion status is passed through verbatim, never summarized by the LLM
`composeTaskCompletionSummary()` gives the LLM the session's real `status` (`completed`/`failed`/
`cancelled`) as an explicit instruction ("report this status honestly, never as a success if it is not"),
and the deterministic fallback template branches on the literal status field, not on sentiment inferred
from the observations. A failed session cannot become "mostly done" or "completed with minor issues" —
either wording would be a fabricated success and this project's core discipline forbids that class of bug
structurally, not just by prompt instruction.

### D-097 Memory extraction is conservative by design — empty is an honest answer
`extractMemoryFacts()`/`extractMemoryFactsFallback()` only fire on clearly declarative phrasing ("I've
decided…", "blocked by…", "تصمیم گرفتم…") and cap at 6 facts per message. Most turns legitimately produce
zero extracted facts, and that's treated as correct behavior, not a bug to work around — the alternative
(aggressively inferring facts from ambiguous phrasing) would silently pollute the daily brain with
low-confidence "memories" the owner never actually stated, undermining every downstream consumer
(prioritization, decisions/blockers summary, briefings) that trusts this collection is fact, not guesswork.

### D-096 The daily brain packet composes from real records only, gateway-fetched
Same pattern as Phase AD's context packet (D-093a) and Phase AB's personal engines (D-090): `daily-brain.ts`
never fetches anything itself. The gateway assembles a `DailyBrainInput` from real collections (kernel
`tasks`, `personalProjects`, `decisionMemories`, `incidents`, `personalRisks`, `jarvis_memory_facts`,
`nextBestActions`, safe-mode state) and `buildDailyBrainPacket()` only ranks/summarizes what it's given.
This keeps the module pure and unit-testable without a database (30/30 smoke checks run with zero DB
dependency) and keeps the "no fake success" discipline enforced structurally rather than by convention.

## 2026-07-09 — Phase AD Jarvis Intelligence Core

### D-095 Backfill: the Jul 6 "Update jarvis answer" commit
`abf2c3d` shipped between Phase AC+ and Phase AD without a phase-log/decision-log entry, breaking the
project's own documentation invariant for the first time. Backfilled in phase-log.md rather than silently
skipped, and treated as a reminder: every commit that touches `shared/` or a service's routes gets a log
entry BEFORE the next phase starts, not after.

### D-094 LLM decides HOW to talk, never WHAT to execute
Phase AD adds real LLM usage (intent classification + response composition) to the operator/Jarvis path for
the first time, but the existing Phase X invariant — raw model output never executes a tool — is
unconditionally preserved. `classifyIntent`/`composeJarvisResponse` only ever produce schema-validated
structured data (same `generateStructured` pattern as capability-gap analysis and strategic planning); the
deterministic `planForGoal`/`classifyGoalScope`/approval pipeline is untouched and remains the only path
from a decision to an actual mutating action. The fix for "Jarvis feels like a weak chatbot" did not
require weakening any existing safety boundary.

### D-093 Direct-answer mode for read-only/meta intents, route-to-planner for everything else
Rather than replacing the deterministic planner with an LLM agent loop (higher risk, harder to audit),
Phase AD classifies intent first and only bypasses the planner for `system_status`, `meta_self_assessment`
and `general_conversation` — categories that are pure reads or self-knowledge, answered directly from a
freshly gathered context packet with no session/approval machinery needed. Every other category still goes
through the exact same tool pipeline as before; Jarvis only wraps a grounded natural-language reply around
the real result instead of the previous mechanical narration string. This kept the change additive instead
of a rewrite: zero existing tool-execution code paths were removed.

### D-093a Context packets are built from facts the caller supplies, not fetched internally
`shared/src/jarvis` stays pure and testable: `buildJarvisContextPacket()` only ranks/compacts a
`JarvisContextFact[]` array the gateway already fetched (reusing `execSystemCheck()` for system-status facts
so the existing evidence-writing behavior is unchanged). This mirrors the existing pattern in
`shared/src/personal` (`buildUniverseZones` is pure; the gateway feeds it real data) and keeps the smoke
suite able to test intelligence logic without a database.

### D-093b The regex planner gets one new branch, not a rewrite
Quality-bar prompt E ("create a task that solves the Jarvis brain problem") exposed that the `create_task`
tool was registered in the operator tool registry but `planForGoal` never actually routed to it — no
regex branch existed for generic task creation. Added one bilingual (EN/FA) branch, checked last (after
every more specific branch) so it only catches leftover "create/make a task ..." phrasing. Minimal,
additive, and the existing `create_task` executor (already present) required no changes.

## 2026-07-05 — Phase AC+ command universe

### D-092 One aggregation contract for the whole world view
The home surface is fed by a single scope-enforced endpoint (/v1/me/universe) built on a pure,
deterministic zone builder in shared. Every domain — body, time, family, money, ventures, growth,
opportunities, kernel, presence — has ONE status vocabulary (live/attention/setup_needed/
not_configured), and a zone can only be LIVE when real scoped data backs it. Empty states are part of
the product: premium, specific, and actionable (exact ingest kind or consent path). This contract is
what lets the interface scale to tenants, organizations and citizens later without redesign.

### D-091 Jarvis is the connective layer, not a widget
Zones summon the operator console with contextual commands over a browser event bridge; the console
executes them through the SAME gated runtime (scope classification, deterministic planning, approvals)
and offers deep links back into the relevant views. Human and AI look at the same world and act through
the same governed paths — no side channel, no bypass.

## 2026-07-05 — Phase AB personal reality & Jarvis layer

### D-090 Honest intelligence or none
Every personal engine works ONLY on recorded, scoped data. Missing sources are named
(`calendar: not_configured`), empty baselines produce requests for data instead of output, resume
analysis keeps verified facts / user claims / labeled inferences / suggestions in separate buckets and
never invents credentials, and opportunity scores carry source + confidence with no market claims the
system cannot back. Deterministic engines (same input ⇒ same ranking) make honesty testable — 26 checks.

### D-089 Personal analysis, global building — and decisions are training data
“What should AOS build next for me?” is analyzed in user scope but building routes to the global
workspace evolution flow with approval: personal context informs, the kernel stays unified. Every
accept/reject/complete on a recommendation writes scoped memory (rejections → mistake_avoidance), so the
ranking engines have a growing, user-owned signal about what actually helps — the seed of real
personalization without any cross-scope leakage.

## 2026-07-05 — Phase AA scope, identity & multi-tenant governance

### D-088 One authorization engine, enforced at the gateway boundary
All scoped access flows through the shared `canAccess()` — no duplicated or scattered checks. Verdicts
are allowed/denied/approval_required with audit + evidence flags; every denial writes an access_decision
and a security event. Missing scope fails closed everywhere (engine, stampScope, scopeFilter). Even the
OWNER cannot silently read another user's private data or a citizen case — those paths return
approval_required and are audited, which keeps support access possible but never invisible.

### D-087 Global software evolution, scoped human data
The kernel (services, schemas, prompts, deployments, the workspace self-development engine) stays ONE
governed global unit; user/tenant/project/case data is isolated by construction. Existing schemas gained
optional scope metadata without breaking writers; legacy records default to global and the idempotent
migration stamps them explicitly, scoping only the unambiguous single-owner history to Esan. Consents
start read-only; connector accounts hold metadata + consent references, never secrets. Esan is seeded as
first owner and platform governor, and the legacy env login maps to user_esan — nothing broke.

## 2026-07-03 — Phase Z live runtime & honest outcomes

### D-086 Service metadata is public; actions and internals stay guarded
/.factory/manifest, /status and /capabilities are non-secret metadata — they are now public like
/health, because infrastructure validation, registry checks and workspace temp-port probes must read
them without credentials (this exact guard caused the failed status-inspector verification).
/.factory/task (acts) and /.factory/logs (internals) remain internal-token-guarded, and the workspace
probe suite verifies BOTH sides: guarded endpoints must reject without the token and answer with it.

### D-085 A session that failed is a failed session
`stopSessionOnFailure(category)`: critical-chain failures (code/test/service/deploy/repair/git/dokploy)
stop the runtime session as FAILED with cause + next action; only observational categories may continue.
Completing a plan with failed steps reports failure. Combined with the streamed workspace phase events
and the GREEN gate before migration plans, the system cannot claim success it did not earn.

## 2026-07-03 — Phase Y staging workspace & service evolution

### D-084 Isolation is the approval boundary, not the edit
Inside a disposable `.workspaces/<id>/` copy, the operator edits as many files as it wants with no
per-step approval — the live tree cannot be touched from there, and env-configurable limits
(iterations / minutes / files changed) bound the loop with pause-and-ask instead of silent stops or
infinite runs. Approval concentrates where it matters: migration plans, staged deploys, promotion,
rollback, and anything protected-core (owner). This makes the system aggressive in development and
conservative in release — both structurally.

### D-083 Promotion is a snapshot branch, never an overwrite
`ws_promote` requires an approved migration, then: record HEAD, create `ws/<id>-promote`, rsync the
workspace service over `services/<target>` ON THAT BRANCH, commit. The default branch and the previous
version are always intact; protected core additionally demands the owner flag and lands as
`open_pr_only`. Staged Dokploy apps (`<svc>-staging.<domain>`) verify /health before final promotion,
and the rollback record ships with every migration plan.

## 2026-07-03 — Phase X autonomous operator runtime

### D-082 The runtime is the product; every capability is a schema'd tool with a real execution path
All operator ability flows through one registry (45 tools) where each tool declares category, I/O schema,
risk, approval/owner flags, timeout, rollback/evidence discipline, and one of five REAL execution paths.
Unavailable integrations register `available:false` + reason instead of being hidden or faked, so
“what can you do?” is always answered truthfully from live state. The loop executes reads immediately,
pauses at typed permissions for everything else, and hands protected-core/critical actions to the visible
Overview flow — autonomy is structural, and so is control.

### D-081 Code changes go through a dedicated agent with workspace + branch isolation
code-operator-agent (4122) is the only path to the codebase: confined to CODE_WORKSPACE_ROOT, default
branch refused, dry-run preview before any write, protected-core paths refused without an explicit
owner-approved flag from the gateway, and typecheck/build/smoke tools to prove changes before deploy.
The runtime plans inspect → propose → approve → apply → verify, never a blind write.

## 2026-07-03 — Phase 19.5 voice command pipeline fix

### D-080 One gate for every utterance source, mirrored server-side
All voice/text input funnels through a single client `UtteranceGate` (final-only, min length, normalized
5s dedupe, single in-flight lock, echo suppression) — and the gateway independently enforces min length +
dedupe on `/v1/voice/message`. Client and server share one normalization function (parity smoke-tested),
so a buggy or malicious client still cannot produce word-by-word or duplicate command execution. Echo
suppression applies to voice only; typing while the assistant speaks is a legitimate command and cuts audio.

## 2026-07-03 — Phase 19 full realtime voice WebRTC

### D-079 Realtime model muted by design: `create_response=false` + kernel-grounded speech
The WebRTC session is configured so the provider model can never respond on its own. Every final user
transcript goes through the deterministic `/v1/voice/message` router; the model only vocalizes the exact
kernel-produced reply (`response.create` with verbatim instructions). This makes the safety property
structural — even a hallucinating realtime model can neither act nor claim it acted, because it is never
given autonomy, tools, or unmediated turns.

### D-078 SDP exchange proxied through the gateway with the ephemeral secret only
OpenAI supports direct browser SDP with the ephemeral token, but we route the offer through
`POST /v1/voice/realtime/sdp` anyway: one audited path, sanitized `voice.realtime.*` events (never SDP
bodies or secrets), bounds checks preventing a long-lived key from transiting disguised as an ephemeral
secret, and GA (`/v1/realtime/calls`) → beta (`/v1/realtime?model=`) endpoint tolerance in one place.
The gateway never holds the provider API key — minting stays in the voice-operator-agent.

## 2026-06-27 — Phase 18 realtime voice operator

### D-077 Voice never mutates directly — deterministic tool-mediation router
Every utterance goes through `routeUtterance` → ONE `ToolProposal`. The gateway then enforces RBAC, safe
mode and approvals before any action. The router is deterministic (same input → same proposal) so the
guardrails are guaranteed regardless of the LLM. Read tools run immediately; everything else needs
confirm/approval.

### D-076 Anti-mistake guardrails encoded in the router (not just the prompt)
The 10 guardrails (analyze→learning, security→security, research→intelligence never Dokploy; only infra ops
use operation plans; protected-core never voice-executed; no destructive ops; overview is the surface) are
hard-coded routing rules, so a misheard request can't be funnelled into a Dokploy target selection or a core
mutation.

### D-075 Browser-native voice + text fallback; provider optional; key stays server-side
The dock works fully with text plus the browser's SpeechRecognition/speechSynthesis — no provider required.
When a realtime provider is configured, the voice-operator-agent mints a short-lived ephemeral client secret
server-side; the raw API key never reaches the browser. Critical/protected approvals require the visible
Overview UI, never voice-only.

## 2026-06-27 — Phase 17 real Dokploy calibration & validation

### D-074 Diagnostics are READ-ONLY; mutation endpoints recorded as not-probed
`buildDiagnostics` only calls GET discovery endpoints (project.all → project.one → application.one). It
never calls deploy/restart/saveEnvironment (those have side effects); they're listed as "not probed —
confirmed at execution time". Diagnostic records store key-only `responseShape` and a redacted sample.

### D-073 Calibrated parser leaves missing fields empty (unknown), never invented
`parseDokployTargets` tolerates the common Dokploy shapes and fills what's present; absent domain/port/
rootDir stay empty and the UI shows "unknown". No target is fabricated; empty data → zero targets.

### D-072 AOS↔Dokploy mapping is honest: not_found_in_dokploy_sync
`mapAosServices` matches catalog ids to real synced `dokploy_api` targets; anything unmatched is explicitly
`not_found_in_dokploy_sync` rather than invented. Calibration lives on `/overview` — no separate page.

## 2026-06-27 — Phase 16 real Dokploy API execution

### D-071 Auto-execute only low/medium NON-core ops; everything else stays gated/manual
`canAutoExecute` allows API execution for health_check_only/new_app/existing_app_repair/existing_app_restart
on non-protected-core targets only. Protected-core mutations escalate to `protected_core_update` (critical,
owner-only) and are never auto-executed. env updates / core updates / anything destructive stay manual or
owner-critical. No delete is implemented.

### D-070 Unsupported/failed API steps become manual_required — never fake success
The Dokploy client returns structured results (404 → `unsupported`); the executor marks the step
`manual_required` with exact manual instructions and a retry option instead of pretending it worked.
Verification is always a real `/health` + registry check afterward.

### D-069 Token server-side only; summaries redacted
The Dokploy token lives in gateway env and is never returned by `/v1/dokploy/status` or sent to the browser.
`redactSummary` strips token/secret/password/key fields from any request/response summary stored on a step.

## 2026-06-27 — Phase 15 safe real operations inside overview

### D-068 Overview IS Mission Control — no separate page
The guided operation journey (command → target → risk → approval → execute → verify → evidence → next)
lives entirely on `/overview` via `OperationCommand` + `OperationConsole`. Other pages stay as archives.
No `/mission-control` route is created.

### D-067 Protected core escalates to critical + owner-only; safe mode blocks operation approval
A mutation targeting any of the 9 protected core services is re-classified to `protected_core_update`
(critical) and can only be approved by an owner. Approving any mutating operation is blocked while safe
mode is on. Both are enforced server-side in the gateway (defense in depth over the dashboard UI).

### D-066 No fake Dokploy — manual instructions + real verification
Without a Dokploy API token, the gateway records the target as `manual_user_confirmed`, emits the exact
manual Dokploy steps, waits for the operator's confirmation, then runs a **real** HTTP `/health` + registry
check for verification. Success is never simulated; existing-app changes capture a snapshot first for rollback.

## 2026-06-27 — Phase 14 real product experience & onboarding

### D-065 No fake data — product layer reads only real state
Onboarding, system map, next-best-action, evidence explorer, reports center and readiness all source live
gateway/registry data. There is no demo/simulation mode and no seeded sample records. Where live data is
absent (e.g. a service hasn't registered), the UI says so honestly rather than fabricating it.

### D-064 Action templates create real tasks via the existing RBAC-gated path
Templates are static real prompts; the card posts the prompt to `createTaskAction`, which already enforces
RBAC + safe mode. So "run a template" is a real task with no special demo code path.

### D-063 Service catalog = documented config, not fabricated runtime data
The system map's static catalog (id/role/domain/port/boundary) is real deployment configuration (same facts
as the brief), kept in the dashboard to avoid importing backend code. Runtime status (registered/last-seen/
version/capabilities) is merged in from the real registry only.

## 2026-06-27 — Phase 13 real intelligence integration

### D-062 LLM reasoning only via schema-validated structured output
Every agent reasons through `router.generateStructured(zodSchema, { fallback })`. The validated result —
or a schema-validated deterministic fallback — is the only thing returned, so raw model text can never
mutate state. Each call emits an `LlmTrace` and a cost record.

### D-061 Per-task budget + safe-mode force deterministic fallback
The orchestrator sums `llm_cost_records` per task; on reaching `LLM_MAX_COST_PER_TASK_USD` it sets
`forceFallback`, writes an `llm_budget_events` record and continues deterministically. Safe mode +
`LLM_SAFE_MODE_FALLBACK` likewise forces fallback — the pipeline still runs (read-only analysis), it just
stops calling providers. Provider failures fall back, never crash.

### D-060 Reviewer and QA must be able to fail
The reviewer-agent and qa-agent return real pass/fail verdicts and required fixes; QA never passes without
evidence. Their deterministic fallbacks also fail inadequate inputs, so the gate is real even without keys.

### D-059 Use canonical reserved ports for the 4 new services
`reviewer-agent` (4106), `qa-agent` (4107), `report-agent` (4114), `internet-research-service` (4115) were
already reserved in `constants` (ids/ports/subdomains). We used those rather than the spec's suggested
4117–4120 so peer-discovery (`SERVICE_PORTS`) stays consistent. Research is `serviceType: integration`
(the manifest enum has no `service`).

## 2026-06-27 — Phase 12 security, auth & production hardening

### D-058 Stateless HMAC session cookie (Web Crypto), scrypt passwords (node)
Session tokens are HMAC-SHA256 signed via Web Crypto so the same verify path runs in middleware (edge)
and server actions/components — no shared session store needed. Passwords use node `scrypt` (or a
dev-only plain compare) in the login action. Cookie is HttpOnly + Secure + SameSite=Lax;
`DASHBOARD_SESSION_SECRET` signs it. Admin/internal tokens never reach the browser.

### D-057 Trust the dashboard's declared role only with the admin token
The dashboard sends `x-factory-role`; the gateway honors it only alongside a valid admin token
(server-to-server), otherwise the caller is `agent`. This lets the gateway record the true actor and
enforce RBAC without a second identity system, and prevents client self-elevation.

### D-056 Enforce RBAC + safe mode in BOTH dashboard and gateway
The dashboard server actions deny early (best UX: explanatory `/denied` page) and the gateway re-checks
every mutation (`enforce()`). Defense in depth: bypassing the UI still hits gateway RBAC + safe-mode.

### D-055 Runtime safe mode in system_settings, seeded from env
`AUTONOMY_SAFE_MODE` sets the boot default, but the live value lives in `system_settings` so an owner can
toggle it instantly from the dashboard without a redeploy — required for the emergency kill-switch and
the demo. Blocked attempts are audited + raised as security events.

### D-054 Dashboard RBAC mirrored, not imported from @factory/shared
The dashboard keeps a small `lib/rbac.ts` mirror of the action→permission map instead of importing the
backend package, so the Next bundle stays free of Mongo/AWS/server-only code. The gateway remains the
authoritative enforcer; the mirror is kept in sync and documented.

## 2026-06-27 — Phase 11.5 UI QA, cleanup & polish

### D-053 Responsive tables via global CSS, not 40 rewrites
Wide tables scroll horizontally inside their card on mobile (`.card{overflow-x:auto}` +
`table{white-space:nowrap;min-width:max-content}`). This fixes viewport overflow for every table page at
once. Only the 5 table pages with inline action buttons were hand-converted to cards (buttons in a
horizontally-scrolling row are bad on touch); the rest stay scrollable hybrids, which is the right UX for
dense operator data.

### D-052 Route-level loading/error/not-found over per-page states
Added `app/loading.tsx`, `app/error.tsx` (client boundary with retry), and `app/not-found.tsx`. One set of
files gives all 64 routes polished loading, error, and 404 states for free, instead of touching each page.

### D-051 Keep dead-but-harmless code explicit
Removed truly-unused `Nav.tsx` and the `.menu-btn` rule. Kept `Placeholder.tsx` (used by 5 pages) and the
`.layout` selector (harmless, paired with `.app-shell`) — documented rather than risk-removed.

## 2026-06-27 — Phase 11 control-room experience (premium glass UI)

### D-050 Rewrite the design system, preserve legacy class names
Rather than editing ~60 pages, `globals.css` was rewritten around the same class names the pages already
use (`.card`, `.badge`, `.label`, `.sub`, `.h1`, `.feed`, …). Every page inherits the premium glass look
for free; only the priority pages were hand-redesigned. Lowest risk, widest coverage.

### D-049 Pure-CSS design system, no new UI dependencies
Glass, depth, ambient blobs, grain, and motion (`fadeInUp`/`shimmer`/`pulse`) are all CSS — no Framer
Motion or component library added. Keeps the dashboard light and Dokploy-deployable, honors
`prefers-reduced-motion`, and avoids bundle/security surface from new deps.

### D-048 UI-only phase — backend strictly untouched
Phase 11 changed only `services/dashboard-web` presentation. `lib/gateway.ts`, all server actions, the
`/api/stream` SSE proxy, and every service contract are unchanged; admin/internal tokens stay
server-side. Design work must never alter behavior or contracts.

## 2026-06-26 — Phase 10 continuous learning & autonomous improvement

### D-047 Approval converts recommendations into structured workflows (not generic tasks)
The Recommendation Conversion Router maps rec type → workflow type with explicit steps + target engine.
Execution requires an approved recommendation; a waiting one yields a `waiting_approval` workflow and
gates the task. Nothing executes silently.

### D-046 Workflows reuse existing engines and are evidence-backed
The executor runs steps through the skill library, validation engine, scoring/policy proposal flows,
strategic planner, monitor, and browser-testing — each step records evidence. Engines aren't duplicated.

### D-045 Impact is measured, never faked
`buildImpactAssessment` compares before/after metrics (reliability, incidents, validation, skill count).
If nothing improved, it says "no measurable improvement yet" and recommends re-measuring after more
history — honest by design.

### D-044 Continuous memory maintenance; compressed context first
`buildMemoryMaintenanceRun` keeps the latest summary per scope and deprecates the rest, tracking token
budget saved. Future agents load compressed_contexts → active skills → reliability → patterns → raw
evidence last.

## 2026-06-26 — Phase 9 operational learning & memory intelligence

### D-043 Learning aggregates history; recommends; approval applies
The Historical Learning Engine reads 15 collections and produces reliability scores, patterns,
summaries, and recommendations. Nothing changes behavior automatically — recommendations are
evidence-backed, RBAC-gated (`approve_recommendation`), audited, and convert to a task/proposal on approval.

### D-042 Reliability + patterns are statistical, from many records (not one)
Reliability blends success/validation/incident/repair rates with a recent-vs-older trend and a
sample-size confidence. Patterns require support counts. This is the shift from single-decision
learning (Phase 8) to operational collective learning.

### D-041 Compressed memory first; raw history second
`memory_summaries` + `compressed_contexts` give future agents a low-token view of system state and
weak points, so they don't re-read raw history. Summaries cite source memory/evidence ids.

### D-040 Synthetic test history is marked and separate
Verification seeds history with `synthetic: true`; production analysis runs on real records. The
engine is pure over a history bundle, so it is testable without polluting production data.

## 2026-06-26 — Phase 8 learning governance & adaptive intelligence

### D-039 No silent learning: propose → approve → version → audit
Outcome reviews recommend scoring-weight changes, but they never apply automatically. A
`scoring_change_proposals` record is created; approval (RBAC) versions a new active
`scoring_profiles` entry and writes an audit log. Rejecting preserves the current profile.

### D-038 Active scoring profile drives the engine; scores reference the version
`scorePlans` takes the active profile's weights; every `plan_scores` row records `profileVersion`,
so decisions are reproducible and auditable across weight changes.

### D-037 Configurable policy with hardcoded safety overrides
`resolvePolicy` overlays scoped `policy_rules` on the code default, but `file_delete` and
`physical_action` are always blocked regardless of configuration — dangerous actions can never be
enabled by a config overlay.

### D-036 RBAC gates approvals; everything governance is audited
Roles owner/operator/viewer/agent with a permission catalog; `hasPermission` gates approval endpoints
(admin token → owner, internal token → agent). Approvals, denials, and scoring/policy changes all
write `audit_logs` entries with before/after.

## 2026-06-26 — Phase 7 strategic reasoning & policy-governed execution

### D-035 Planner never returns one plan; the scorer chooses with justification
`generateCandidatePlans` always yields ≥3 labelled plans (safe/fast/ambitious). `scorePlans`
ranks them across 10 dimensions and records the selection reason + rejection reasons, so every
choice is explainable and auditable.

### D-034 Policy engine gates every sensitive action; some are blocked outright
`evaluatePolicy` returns allowed / approval_required / blocked. `file_delete` and `physical_action`
are blocked by default; code/github/deploy/env/external/message/data/production require approval.
Decisions persist to `policy_decisions`. The selected plan's safe steps execute; sensitive steps
are gated by an approval.

### D-033 Reasoning is real but never trusted raw
The orchestrator reasons through the LLM router (real provider when keys are set). All output is
Zod-validated (`CandidatePlansSchema`); the deterministic fallback is itself validated. `promptVersion`
is recorded on every trace; `/v1/llm/status` shows real vs fallback. No raw LLM text mutates state.

### D-032 Decisions are remembered and become a skill
Each strategic decision writes a `decision_memories` record (+ a `decision_memory` Memory) capturing
options/choice/why/outcome/lessons, and reinforces `skill_strategic_planning` so future planning improves.

## 2026-06-26 — Phase 6 autonomous repair & execution

### D-031 Repair is diagnose→plan→approve→execute→re-verify; never faked
The monitor drives the loop deterministically. Execution runs only safe/approved actions and
re-runs the live activation check; the incident resolves and the capability returns to `active`
only when real HTTP evidence proves health. Incidents never close without an `incident_closed`
evidence record.

### D-030 Sensitive repair actions stay approval-gated
Env changes, code patches/PRs, and redeploys require approving the repair plan in the dashboard
before the executor runs. Safe artifacts are produced as evidence; nothing destructive or
production-changing happens automatically.

### D-029 Repair executor lives in the monitor (owns activation + incidents)
Diagnosis/plan engines are pure shared functions; the monitor persists and executes. Re-activation
uses `checkLiveService` directly so a re-check failure updates the existing incident instead of
opening a duplicate.

### D-028 Every repair produces learning
On resolution the kernel writes a `solution_memory`, reinforces a reusable
`skill_repair_service_activation`, and appends a `repair-log` doc.

## 2026-06-26 — Phase 5 live activation & runtime autonomy

### D-027 `active` is never faked — gated on live HTTP verification
`validated → active` requires the Live Service Activation Engine to pass real probes against
the service's domain (health, manifest, capabilities, safe task). If the service isn't
reachable, the capability stays `validated`, an incident opens, and a repair is proposed.

### D-026 Manual Dokploy flow kept; kernel guides, doesn't pretend to deploy
DevOps generates a precise checklist; the human creates the app; the kernel then runs the
activation check. The system never claims it deployed unless it actually did.

### D-025 Monitor owns activation + health; repair loop is deterministic-first
The monitor-agent runs activation checks and periodic scans, opening incidents + repair tasks
on failure. The first repair loop is deterministic (diagnosis + redeploy proposal, approval
required) — the model exists for richer automation later.

### D-024 Real modes behind credentials; status surfaced
GitHub delivery uses real REST when token+owner+repo are set (feature branch + PR only),
else prepared mode. LLM uses real providers when keys are set, else the schema-validated
fallback. `/v1/system/integrations` and `/v1/llm/status` make the mode visible; traces show
real vs fallback per call.

## 2026-06-26 — Phase 4 reality execution layer

### D-022 No claim without evidence; capability lifecycle gated on proof
`generated → validated` requires the runtime validation to pass; `validated → active`
requires the service-registry to confirm a reachable manifest. Every promotion and outcome
produces an `evidence_records` entry. The dashboard surfaces evidence on task/capability/
validation pages.

### D-021 GitHub delivery is feature-branch + PR only; prepared fallback offline
`GitHubDelivery` never pushes to the base branch — it creates a feature branch + PR (review
before merge), so it needs no extra approval gate. Real GitHub REST runs when `GITHUB_TOKEN`+
`GITHUB_OWNER`+`GITHUB_REPO` are set; otherwise a deterministic "prepared" operation records
the branch/files + git instructions. Pushing to main / prod deploy remain approval-gated.

### D-020 Validation co-located in the builder (owns the generated files)
The validation engine is a shared module run inside the builder-agent, which has the generated
files on its filesystem (avoids a cross-container shared volume). Static checks always run;
build/typecheck are opt-in via `ALLOW_BUILD_VALIDATION` so production containers don't shell out.

### D-019 Browser agent: Playwright with HTTP fallback, internal-only by default
`browser-testing-agent` uses `playwright-core` (optional dep, no browser auto-download) and
falls back to an HTTP-level check when no browser is present — still producing a real,
evidence-backed result. Targets are restricted to internal/owned hosts (`localhost`,
`*.simorx.com`); external targets require approval.

### D-018 browser_testing seeded as `generated`
Reflects the Phase 3 outcome (the agent was designed/generated). Phase 4 activates it. New
capability gaps can still be demoed with other capabilities (e.g. email, web research).

## 2026-06-26 — Phase 3 self-expanding capability engine

### D-017 LLM router with deterministic fallback; nothing unvalidated mutates state
`generateStructured(schema, { fallback })` returns only Zod-validated data. With no
provider key (local/test) the deterministic fallback is used and is itself validated.
This satisfies "an agent uses the LLM router for structured reasoning" while guaranteeing
no raw LLM text can mutate system state. Traces persist to `llm_traces` with cost/tokens.

### D-016 Capability analysis lives in the orchestrator; capability data in shared graph
The gap detector is part of goal handling (orchestrator owns decomposition). The capability
graph + gaps + proposals + evaluations are plain MongoDB collections read via the gateway —
no new always-on service required, keeping independent deployability intact. A dedicated
capability-service can be extracted later if needed.

### D-015 Expansion is approval-gated; approval converts a proposal into a build task
Detecting a missing capability never silently fails — it creates a proposal in
`waiting_approval`. Approving (gateway) emits `expansion.decided` and dispatches a
`build_from_proposal` task to the orchestrator. Sensitive self-expansion stays governed.

### D-014 Generator writes standard services to a configurable SERVICES_ROOT
The builder-agent scaffolds via `shared/generator` into `SERVICES_ROOT` (default a sandbox
dir, not the live repo) so a running container never clobbers source. Generated services are
real, build cleanly, and use the standard factory endpoints. GitHub-commit delivery is a
later refinement.

### D-013 Evaluation is deterministic from signals
`buildEvaluation` scores 10 dimensions from observed signals (docs updated, memory stored,
scaffold created, delegations succeeded, runtime validated, …) so the system never
hallucinates progress; recommendations flag what's missing (e.g. runtime validation).

## 2026-06-26 — Phase 2 first autonomous loop

### D-012 Test-only DB seam (`setTestDb`)
Added `setTestDb()` to `shared/db` so the real compiled pipeline/handlers can run
in-process against a fake Db for verification (the sandbox blocks downloading a
mongod binary). Clearly marked test-only; never used in production paths.

### D-011 Approval is the human-in-the-loop gate that drives the task
The orchestrator finishes the pipeline at `awaiting_approval` after devops creates the
infrastructure request. The gateway's approval decision endpoint then drives the linked
task: approve → `completed` + `task.completed`; reject → `cancelled` + `task.failed`.
Keeps the loop truthful (sensitive action gated) without a complex pause/resume engine.

### D-010 Orchestrator responds immediately; pipeline runs in background
`POST /.factory/task` returns `accepted` at once and runs the delegation pipeline
asynchronously with paced steps, so the dashboard shows a live, progressive timeline.

### D-009 Cross-service calls via env-configured peer URLs (`peerUrl`/`PeerClient`)
Resolution: `<SERVICE>_URL` env override → localhost default from `SERVICE_PORTS`.
Production sets these to subdomains. No shared runtime code, no registry hard-dependency
for the happy path — fully compatible with independent Dokploy deployment.

## 2026-06-25 — Phase 1 foundation

### D-008 Verified-current dependency versions
Pinned to June 2026 stable: Node 24 LTS (engines `>=22 <25` for sandbox compat),
Next.js 16.2, React 19, Fastify 5.8, Zod 4.4, MongoDB driver 6.x, AWS SDK v3,
TypeScript 5.9, pino 9. Verified via official sources before pinning.

### D-007 SSE via event-bus + dashboard server proxy
Event bus persists events to MongoDB and fans out over SSE. The dashboard
subscribes through a server-side Next.js route (`/api/stream`) that holds the
internal token, so browser secrets are never exposed. Redis/NATS backplane
deferred until multi-instance scale requires it.

### D-006 Internal vs admin tokens (RBAC later)
Two tokens now: internal (service-to-service) and admin (human/dashboard),
compared in constant time. Designed to evolve into full RBAC without breaking
the contract.

### D-005 MongoDB Atlas primary; AWS S3 objects
Per brief. No PostgreSQL. One `MongoClient` per process; `FileStorage` wraps S3
with presigned URLs; object metadata tracked in `s3_objects`.

### D-004 `@factory/service-kit` separate from `@factory/shared`
`shared` stays framework-agnostic (contracts/schemas/db/storage/utils). The
Fastify bootstrap lives in a second workspace package so the Next.js dashboard
and any non-Fastify consumer don't pull Fastify transitively. `createFactoryService`
gives every backend service identical standard endpoints, auth, registration,
and lifecycle.

### D-003 pnpm workspaces monorepo, independently deployable services
Chosen by owner. Shared code linked at build time; each service builds and
deploys independently on Dokploy (own root dir, env, port, subdomain). Runtime
communication is HTTP + internal tokens only.

### D-002 Standard factory endpoint surface
Every service exposes `/health` + `/.factory/{manifest,status,capabilities,task,logs}`
so the registry, dashboard, and agents can treat services uniformly.

### D-001 Production domain `simorx.com`
Subdomains derived in `shared/src/constants` (api., factory., orchestrator., …).
Swappable via `ROOT_DOMAIN` + env.
