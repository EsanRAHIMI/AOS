# Living AI Government — Jarvis Command Universe

**Product vision & transformation plan — Phase AF**
Written 2026-07-09 as the required product-architecture step before the homepage rebuild began.

**Status update (2026-07-09, same day, after Phase AF.1–AF.4.4):** the
original banner below said "nothing in this document has been implemented
yet." That is no longer true. Phases AF.1 through AF.4.4 implemented the
large majority of Sections C–H: the Presence Bar/Focus Row (Section J's
recommended first step), all nine domain-specific zone renderers (Section
A.1/A.2's core complaint), the domain action layer (Section A.9's "read-only
only" complaint), the persistent live-state snapshot and grouped Live
Activity feed, and the hydration fix. Section A's diagnosis below is
preserved as-written because it is an accurate historical record of what was
wrong and why this rebuild happened — it is **not** a description of the
current product. For current status, see `docs/phase-log.md` (Phase AF.1
through AF.4.4) and `docs/decision-log.md` (D-108 onward). Known items from
this document still genuinely open: dedicated per-domain routes (Section
A.4's "no `/finance`, no `/health` route" finding still holds — zones live
only on the homepage), and per-actor scoping of live-state (deliberately not
implemented — see D-124).

This document is deliberately grounded in a direct code audit of the current
system (file paths, component names, and API contracts are real, not
illustrative) — not abstract inspiration. Every claim in Section A was
verified by reading the actual files named. Every recommendation in Sections
C–H is designed to reuse and complete work that already exists in
`shared/src/personal`, `shared/src/jarvis`, and `services/gateway-api` rather
than reinvent it.

---

## A. Brutally honest diagnosis

**The headline problem: AOS has a genuinely sophisticated intelligence
backend wearing a generic admin-dashboard skin.** Phases AB through AE.1
built real domain modeling, real ranking, real memory, real briefing
generation. Almost none of it is visible. The gap between "what AOS knows"
and "what AOS shows" is now the single biggest product liability.

Specific, verified findings:

1. **Every domain looks identical.** `UniverseZone.tsx` is the ONLY renderer
   for all nine domains (`health`, `daily`, `life`, `finance`, `ventures`,
   `growth`, `opportunities`, `systems`, `presence`). It is one template:
   colored top border, a title, a status pill, a metrics row, a headline
   sentence, a bulleted item list, an optional setup hint, and two footer
   buttons. Finance and health and ventures and systems all get the *exact
   same shape*. A command universe with nine identically-shaped rooms isn't
   a universe, it's a spreadsheet with rounded corners.

2. **One accidental exception proves the rule.** `BodyMap.tsx` is a real,
   hand-built SVG figure — the only bespoke visual in the entire dashboard —
   and it's wired into exactly one zone (`health`, via a `children` prop
   passed only in that one case in `page.tsx`). This proves the team already
   knows how to build domain-specific visuals and already validated the
   pattern works. It was simply never extended to any other domain. That's
   not a hard problem to solve — it's an unfinished one.

3. **The backend already computes richer data than the frontend ever shows.**
   `buildUniverseZones()` in `shared/src/personal/index.ts` computes real
   `monthlyIn` / `monthlyOut` / `net` / `obligations` figures for the finance
   zone. None of that becomes a cashflow visual — it becomes the same bullet
   list as "Learning & Growth." The intelligence is real. The interface
   throws most of it away by force-fitting it into a template built for the
   lowest common denominator across nine unrelated domains.

4. **Domains have no home.** There is no `/finance` route and no `/health`
   route. The finance zone's "Open" link goes to `/me/opportunities`; the
   health zone's goes to `/me/reality` — generic, catch-all pages, not
   dedicated domain rooms. Clicking into a domain doesn't take you deeper
   into that domain, it takes you sideways into an unrelated generic page.
   There are 8 dedicated pages under `/me/*` and 9 zones — they don't even
   map one-to-one.

5. **The AI factory dominates the navigation; the person's life is a guest.**
   Of ~65 route directories under `services/dashboard-web/src/app/`,
   roughly 55 are internal AOS-the-software-factory surfaces: `activations`,
   `capabilities`, `compressed-contexts`, `expansion-proposals`, `gaps`,
   `policy-change-proposals`, `policy-decisions`, `policy-profiles`,
   `policy-rules`, `scoring-change-proposals`, `scoring-profiles`,
   `governance`, `evaluations`, `reasoning`, `patterns`, and more. This is
   *engine-room* surface — necessary, but it currently outnumbers and
   out-prioritizes the *life-command* surface roughly 6 to 1. The product's
   information architecture currently says "this is an AI ops console that
   happens to have a personal tab," when the vision says the opposite: this
   should be a living command center for a person's whole reality, with the
   engine room accessible but subordinate.

6. **Jarvis is a corner chat widget, not a central intelligence.**
   `OperatorConsole.tsx` renders Jarvis as `position: fixed, right, bottom`
   — a floating pill that expands into a ~420px docked chat panel, opened by
   a browser `CustomEvent` (`aos:jarvis`). This is the exact shape of a
   customer-support widget grafted onto the corner of an unrelated page. It
   is summonable but not present. A user has to *go get* Jarvis; Jarvis does
   not *live inside* the domains it's supposed to be governing.

7. **Jarvis's per-domain integration is a label, not a relationship.**
   Every zone card has an "◈ Jarvis" button. Clicking it just opens the
   floating chat with a canned command string. Jarvis never annotates a
   card directly ("this is why I ranked this first"), never writes a note
   onto a domain, never shows its reasoning next to the fact it's reasoning
   about. The visual language never lets you see Jarvis *thinking about*
   a specific part of your life — only *talking* in a box in the corner.

8. **Confirmed, concrete instance of the exact failure pattern already
   flagged: real backend intelligence with zero UI consumption.** A direct
   grep of `services/dashboard-web/src` for `jarvis/briefing`,
   `primaryPriority`, `activeBlockers`, `systemWarnings`,
   `recommendedNextActions` returns **zero matches**. The `/v1/jarvis/briefing`
   endpoint — built in Phase AE, restructured in Phase AE.1 specifically to
   surface primary priority vs. technical blockers vs. system warnings vs.
   recommended next actions — is fully live on the backend and completely
   invisible in the product. (To be fair to the history here: Phase AE's
   brief explicitly said "dashboard integration only after backend quality
   is proven," so this was a deliberate sequencing choice, not an oversight
   — but it is now the single most finished, highest-leverage piece of
   intelligence with the least UI surface, and it should be first in line.)
   A second, smaller instance: `/v1/me/universe`'s `memoryInsights` field is
   typed all the way through `dashboard-web/src/lib/gateway.ts` and then
   never read anywhere in `page.tsx` — a genuinely stale, forgotten field.

9. **No control surface — every domain is read-only.** You cannot mark a
   bill paid, snooze a risk, dismiss a blocker, or edit a goal from a zone
   card. The only interactive elements are "talk to Jarvis about this" and
   "navigate away." A command *center* should let you command something.
   Right now it only lets you *read* something and then *leave*.

10. **No sense of "alive."** Aside from `BodyMap`'s node-opacity pulse and a
    live-events list at the bottom of the page, nothing moves, nothing
    escalates visually, nothing tells a cross-domain story ("your finance
    blocker is why your venture zone shows attention"). Status is
    communicated by a colored 2px border and a text label — the minimum
    viable signal, not a living system.

11. **No multi-tenant visual story yet, even though the backend has one.**
    `shared/src/scope` already enforces global/user/tenant/project/case
    scoping, and `docs/vision.md` already commits AOS to serving "a family,
    businesses, teams, organizations, and citizens." But the zone system
    has no visual concept of "whose reality is this" beyond a single owner
    name in the hero card. There is currently no way to imagine this page
    rendering for a second person without a redesign — which means the
    *product*, not just the UI, is still conceptually single-user.

**Root cause, stated plainly:** every phase so far optimized for *proving
the intelligence works* (and it does — Phases AB–AE.1 are honestly strong,
verified, tested engineering). None of them were chartered to make that
intelligence *visible, domain-specific, and actionable*. This document
exists to charter exactly that, and only that.

---

## B. Corrected product vision

**AOS is not a dashboard for an AI factory. AOS is a living command layer for
a person's (and eventually a family's, a business's, an organization's, a
citizen's) entire operating reality — and the AI factory is one domain
living *inside* that reality, not the frame around it.**

Today the frame is inverted: 55+ engine-room routes are the main navigation,
and "the person's life" is a single generic tab. The corrected vision
inverts this back:

- The **Command Universe** (the home page) is the primary surface for every
  user, forever. It shows the whole of their reality: body, time, family,
  money, ventures, growth, opportunities, and yes — their AI systems too,
  as one domain among equals, not the whole building.
- **Jarvis is not a feature of the page. Jarvis is the nervous system running
  through every domain on the page.** It doesn't sit in a corner waiting to
  be asked; it has already looked at everything, already knows what matters,
  and is already visible in-context wherever it has something to say.
- **Every domain is a room, not a card.** A room has its own visual grammar,
  its own controls, its own depth, and its own door (a real dedicated route)
  you can walk through for more.
- **The system is built once and rendered for anyone.** The same Command
  Universe shell that shows Esan's reality today must, by construction
  (scope-driven, not redesign-driven), be able to show a family member's,
  a business's, or eventually a citizen's reality tomorrow. This is a
  *product* requirement, not a stretch goal: the scope engine already
  exists in `shared/src/scope` — the UI has simply never been asked to
  honor it visually.
- **The engine room still exists — it becomes one well-organized domain
  ("Systems"), not sixty routes competing for the sidebar.** Nothing about
  AOS's self-development machinery is deleted; it is demoted to its correct
  place in the hierarchy: infrastructure the universe runs on, not the
  universe itself.

North star sentence: *when someone opens AOS, they should see their life
and work the way a brilliant, honest chief of staff sees it — organized,
prioritized, visually legible at a glance, and ready to act on — with an
intelligence that already did the thinking and is standing right next to
the thing it thought about.*

---

## C. The living command center — full concept

### C.1 Structural shell (replaces the current hero-card + flat-grid layout)

```
┌─────────────────────────────────────────────────────────────────┐
│  IDENTITY STRIP            (who + scope + freshness, not a card) │
├─────────────────────────────────────────────────────────────────┤
│  JARVIS PRESENCE BAR       (ambient, always visible, not floating)│
├─────────────────────────────────────────────────────────────────┤
│  FOCUS ROW      1–3 cards — what actually needs you right now    │
├─────────────────────────────────────────────────────────────────┤
│  DOMAIN CANVAS  the Rooms — variable-sized, domain-specific       │
│                 visualization per room, not a uniform grid       │
├─────────────────────────────────────────────────────────────────┤
│  HORIZON RAIL   opportunities / research / longer-horizon signal  │
└─────────────────────────────────────────────────────────────────┘
```

- **Identity Strip** — replaces the current hero `.card`. Not a card, a
  slim persistent header: whose universe this is, what scope (self / family
  / business / tenant — reusing `scope` from `shared/src/scope` directly),
  and a data-freshness indicator (reusing the `dataFreshness` field already
  returned by `/v1/jarvis/briefing`, which today has no consumer at all).

- **Jarvis Presence Bar** — this is the single most important structural
  change. It replaces the floating bottom-right widget as Jarvis's *primary*
  presence (the docked conversational panel can still exist for deep
  back-and-forth, but it is no longer where Jarvis *lives*). The bar is
  always on-screen, directly under the identity strip, and is driven
  end-to-end by the already-built `/v1/jarvis/briefing` endpoint:
  `primaryPriority` in large type, `activeBlockers` as small inline chips,
  `recommendedNextActions` as one-click buttons. This single change wires
  up the exact endpoint flagged in Section A.8 as fully built and totally
  unused — it is not new backend work, it is the first real frontend
  consumer of work that already exists and was already verified (26/26 in
  `scripts/phaseae1-jarvis-priority-memory-smoke.mjs`).

- **Focus Row** — 1 to 3 cards, populated directly from
  `rankPriorities()`/`buildDailyBrainPacket()` in `shared/src/jarvis/daily-brain.ts`
  (already built, already tested, currently called only from the
  `/v1/jarvis/briefing` endpoint with no UI reader). This is "what Jarvis
  thinks matters most right now" rendered as the literal top of the page,
  not buried in one text line inside a card. This is where the priority
  correction work from Phase AE.1 finally pays off visually: if the owner
  says "my priority is fixing the Jarvis brain," that sentence — not a
  service-health warning — is what appears first, biggest, on the page.

- **Domain Canvas** — the Rooms (Section D). Not a CSS grid of equal
  cards. A curated layout where each domain's visual footprint matches its
  actual richness: Health gets a body map (already exists — extend the
  pattern). Finance gets a flow visualization. Ventures get a status board.
  Systems get a compact health strip, deliberately small, because the
  vision explicitly says systems should be "visible but not dominate."

- **Horizon Rail** — opportunities, research, and anything with a longer
  time horizon than "today." This uses the opportunity-ranking engine that
  already exists (`rankOpportunities`, `shared/src/personal`) and currently
  only renders as a bullet list inside the generic `opportunities` zone.

### C.2 What does NOT change structurally

- The API contract discipline (`/v1/me/universe`, `/v1/jarvis/briefing`,
  scope enforcement, honest status vocabulary `live/attention/setup_needed/
  not_configured`) is correct and stays. This is a rendering and
  information-architecture transformation, not a rebuild of the backend
  contracts. Where new backend surface is genuinely needed (a couple of
  write-actions per domain — see Section F), it is additive to the existing
  pattern, not a new architecture.
- The safety model (approval gates, safe mode, "no fake success") is
  untouched and must be respected by every new interactive control added to
  a domain room — a "mark bill paid" action is a real mutation and goes
  through the same approval-aware path every other mutation in AOS uses.

---

## D. The domains and how each must be represented

Each domain below already exists as a `zoneId` in `buildUniverseZones()`.
None of these are new inventions — they are the real nine domains, each
finally given a visual grammar suited to what it actually is, plus the two
or three genuinely new domains the vision calls for that don't yet exist as
zones at all.

| Domain (existing `zoneId`) | Current treatment | Required treatment |
|---|---|---|
| **Health** (`health`) | `BodyMap.tsx` SVG — already good | Keep and extend: add a timeline of recent health entries and a single "attention" highlight state on the figure itself (already has the hook — `concern` flag exists in `PersonalHealthState`). |
| **Today & Priorities** (`daily`) | Bullet list | Becomes the **Focus Row** itself (Section C.1) — this zone shouldn't be a room among rooms, it should be promoted to the top of the page, because "what matters today" is not a domain, it's the lens over all domains. |
| **Family & Home** (`life`) | Bullet list | A relationship/household board: grouped by person or responsibility (`PersonalLifeItem.domain` already distinguishes family/home/relationship/household/personal) — small people/role chips instead of an undifferentiated list. |
| **Money & Commitments** (`finance`) | Bullet list, despite real `monthlyIn/monthlyOut/net/obligations` numbers already computed | A real cashflow visual: in vs. out bar, net trend, upcoming obligations as a mini-timeline (due dates already exist on `PersonalFinanceItem`). This is the clearest case of backend richness being thrown away today — fix first among the domain visuals. |
| **Ventures & Projects** (`ventures`) | Bullet list | A status board: each active project as a compact status chip (on-track / attention / blocked), income potential as a visual weight (already scored via `PROJECT_INCOME_WEIGHT` in `daily-brain.ts`), linked next-best-actions inline. |
| **Learning & Growth** (`growth`) | Bullet list | A track/progress visual — learning tracks already have `targetSkill` + `status`; render as progress lanes, not prose. |
| **Opportunity Radar** (`opportunities`) | Bullet list | Moves to the Horizon Rail (Section C.1) as a ranked, scored list — it already IS ranked and scored by `rankOpportunities()`; it just needs to look ranked (ordered visual weight, not a flat bullet list). |
| **AI Kernel & Systems** (`systems`) | Bullet list, currently as visually prominent as every other zone | Deliberately compact: a single-row health strip (service count / incidents / safe-mode / active operation), expandable on click to the existing `/operations` / `/system-map` pages. Visible but subordinate, exactly per the product brief. |
| **Presence & Channels** (`presence`) | Bullet list | Connector status chips (calendar/email/social) — honest `not_configured` states stay exactly as-is (this is working correctly today), just rendered as connector icons/badges instead of prose bullets. |
| **Decisions & Blockers** *(new — not a `zoneId` today)* | Does not exist as a domain; blockers are scattered across incident/risk facts inside other zones | New first-class room, directly powered by `summarizeDecisionsAndBlockers()` in `daily-brain.ts` (already built, already tested, currently only feeds the briefing endpoint's text). Show recent decisions (with the reasoning already captured in `DecisionMemory.selectedReason`) and active blockers in one place — this is exactly the domain the real failed conversation in Phase AE.1 needed to exist visually. |
| **Approvals** *(exists as a page, not a domain room)* | `/approvals` is a full page but has no home-page presence | Small persistent chip in the Identity Strip or Jarvis Presence Bar (pending count), because approvals are a cross-cutting control surface, not a domain — they belong in the frame, not a room. |

New domains are additive to `UniverseZone['zoneId']` (a `z.enum` in
`shared/src/personal/index.ts`) — this is a small, safe schema extension,
not a rearchitecture.

---

## E. Jarvis's role in this universe

Jarvis stops being "the chat button" and becomes four distinct, already
partially-built capabilities finally made visible and connected:

1. **Observer** — Jarvis has already read every domain before the user
   opens the page (this is literally what `gatherJarvisFacts()` +
   `buildDailyBrainPacket()` already do server-side on every request). The
   Presence Bar is where that observation becomes visible instead of
   silent.

2. **Prioritizer** — `rankPriorities()` + the Phase AE.1 priority-correction
   work (explicit stated priority always outranks system noise) is already
   real and tested. The Focus Row is where that ranking becomes the literal
   top of the screen instead of a hidden ranking used only to write one
   sentence.

3. **Annotator** — new capability: Jarvis attaches a short, specific note
   directly to a domain room when it has something to say about that room
   specifically ("this bill is 3 days overdue," "this project has no
   next-best-action in 2 weeks"), rendered inline on the room, not only in
   the corner chat. This reuses the same `JarvisContextFact` shape already
   used everywhere else in `shared/src/jarvis` — a room-scoped fact with a
   `weight` and `status` is not a new concept, it's the existing concept
   rendered next to the thing it's about instead of only inside a text
   reply.

4. **Actor** — the existing, safety-preserving path stays exactly as it is:
   Jarvis proposes, the deterministic planner
   (`shared/src/operator/index.ts::planForGoal`) or the domain's own
   write-action executes, and approval gates guard anything sensitive. What
   changes is *where the proposal appears* — as a button on the room it's
   about ("Mark this bill paid?" / "Snooze this risk for a week?"), not
   only as a sentence in a chat window three clicks away.

The docked conversational panel (today's `OperatorConsole`) does not
disappear — deep, open-ended back-and-forth still needs a real chat surface,
and Persian free-text input still needs somewhere to go. What changes is
that it stops being Jarvis's *only* visible form. Ambient presence
(Presence Bar + Focus Row + inline annotations) is Jarvis's primary form;
the chat panel becomes Jarvis's *conversation* form, summoned for depth, not
required for basic awareness.

---

## F. Interaction model — user, AI, and each domain

| Actor | Can read | Can act | Mechanism |
|---|---|---|---|
| **User** | Every domain in their scope, at a glance | Direct room-level actions (mark paid, snooze, dismiss, edit a goal, mark a task done) | New, small, domain-scoped write endpoints — additive to existing `/v1/me/reality/*` ingestion pattern, each one still `scope: user`-enforced and audit-logged like every other mutation in AOS |
| **Jarvis** | The same domains, via the same `gatherJarvisFacts`/`loadGraphInput` read paths already in production | Proposes actions inline on the room they concern; executes only through the existing deterministic planner + approval gate — never a direct, ungated mutation | Existing Phase X invariant, unchanged: raw model output never executes a tool |
| **Both together** | Shared view — user and Jarvis are looking at the *same* room, not a private admin view and a private chat log | A proposal made by Jarvis on a room is visible to the user in that room; a correction made by the user (e.g., restating a priority) is immediately reflected back into that room's next render, closing the loop that Phase AE.1 fixed at the data layer but that today still has no visual confirmation | `pickActivePriorityFact()` + Focus Row rendering (Section C.1) |

Every new write action must go through the same three things every existing
mutation in AOS goes through, with zero exceptions: scope enforcement
(`shared/src/scope`), an evidence/audit record, and an approval gate for
anything the security doc already classifies as sensitive. Room-level
"quick actions" are a UI convenience over the existing safety model, never
a bypass of it.

---

## G. Design character and visual direction

Minimal but powerful, not decorative. Concretely, this means:

- **One shared visual language, many domain-specific renderers.** A single
  design system (color scale for status, typography scale, motion
  language) applied consistently — but the *shape* of each room is allowed
  to differ, the way `BodyMap` already differs from a generic card today.
  Consistency lives in the design tokens, not in forcing every domain into
  one component.
- **Status is felt, not just labeled.** Today, status is a 2px colored
  border and a text pill. The corrected direction: subtle motion for
  "attention" states (the way `BodyMap`'s node-pulse already works),
  weight/size correlating with priority (the Focus Row is bigger because it
  matters more, not because it's first in an array), and a single
  consistent escalation color scale used everywhere (ok → attention →
  blocked → critical), never domain-specific ad hoc colors.
- **Depth on demand, not depth by default.** Rooms show a summary at a
  glance; every room has a real door (a dedicated route) for going deeper.
  Nothing on the home page should require a click to understand at the
  headline level; everything should support a click to go deeper.
- **No gimmicks.** No decorative illustrations without data behind them,
  no animation without a status meaning, no "AI sparkle" visual clichés.
  Every visual element earns its place by representing something real and
  current, in keeping with AOS's existing "no fake success" discipline —
  extended here to "no fake visuals."
- **Scales down before it scales up.** The same room components must
  degrade gracefully to `setup_needed` / `not_configured` states (already a
  first-class concept in the zone status vocabulary) — an empty room should
  look premium and inviting, not broken, exactly as the current
  `not_configured` dashed-hint treatment already gets right today. Keep
  that instinct; apply it to every new domain-specific visual too.

---

## H. Implementation direction and transformation plan

This is a UI/product-architecture transformation, not a backend rewrite.
Sequencing matters more than speed here — each step below is chosen to
integrate real, already-tested backend work before building anything new,
directly answering the instruction not to leave logic half-integrated.

**Step 1 — Wire the Jarvis Presence Bar to `/v1/jarvis/briefing`.**
Zero new backend work. Add a `gateway.ts` client method, add the bar to
`page.tsx`, replace the current "Jarvis today-summary card." This alone
fixes the single most concrete half-integration finding in this document
(Section A.8) and makes the Phase AE.1 priority-correction fix visible for
the first time.

**Step 2 — Promote the Focus Row using `rankPriorities()`.**
Already computed server-side inside the briefing endpoint's
`prioritizedItems`. Render the top 1–3 as large, dedicated cards above the
domain grid instead of inside one paragraph.

**Step 3 — Build the Finance room visual.**
Highest-value domain visual to build first: the data (`monthlyIn/Out/net/
obligations`) already exists and is currently the clearest case of thrown-
away backend richness (Section A.3). No chart library is installed yet —
this is the first real decision point (lightweight custom SVG in the
`BodyMap` style, vs. adding a small charting dependency — recommend
following the `BodyMap` precedent: hand-built SVG, zero new dependencies,
consistent with the existing visual system).

**Step 4 — Extract `UniverseZone` into per-domain room components.**
`UniverseZone.tsx` becomes a shared *shell* (status pill, metrics row,
footer actions) that each domain room wraps with its own visual body —
not a full rewrite, a decomposition of the existing component.

**Step 5 — Give every domain a real route.**
`/finance`, `/family`, `/ventures`, `/growth` as dedicated pages (mirroring
the pattern `/me/*` already establishes) instead of aliasing into generic
pages. Each domain's "Open" link finally goes somewhere that domain owns.

**Step 6 — Add the Decisions & Blockers room.**
New `zoneId`, backed entirely by `summarizeDecisionsAndBlockers()` — already
built, already tested, currently only feeding invisible briefing text.

**Step 7 — Add room-level quick actions (Section F).**
Starting with the two or three highest-value, lowest-risk actions (mark a
finance item paid, snooze a risk, mark a task done) — each going through
the existing scope + audit + approval pattern, never a shortcut around it.

**Step 8 — Inline Jarvis annotations on rooms.**
The Annotator capability (Section E.3) — reuses `JarvisContextFact` shape,
rendered per-room instead of only inside the chat transcript.

**Step 9 — Demote the engine-room navigation.**
Consolidate the ~55 internal AOS-factory routes under one "Systems" area of
the navigation (they already conceptually belong to the `systems` zone),
so the primary navigation reflects domains-of-life-and-work first, AOS
internals second.

Each step should ship with the same verification discipline the codebase
already has: a smoke script for any new pure logic, `tsc --noEmit` across
touched packages, and a documented phase-log/decision-log entry — the same
rigor Phases AD/AE/AE.1 already established and that must not lapse just
because this phase touches UI instead of backend logic.

---

## I. The most important structural mistakes to avoid

1. **Do not rebuild the backend contracts to match a new visual idea.** The
   `/v1/me/universe` and `/v1/jarvis/briefing` contracts, the scope engine,
   and the daily-brain ranking are correct and tested. If a new visual
   needs data the backend doesn't have, extend additively — never redesign
   a working, tested contract to chase a UI idea.
2. **Do not turn "domain-specific visuals" into "domain-specific one-off
   spaghetti."** Every room must still share the status vocabulary
   (`live/attention/setup_needed/not_configured`), the same color scale, and
   the same shell component (Section H, Step 4) — variety in visualization,
   not variety in architecture.
3. **Do not let Jarvis's new ambient presence bypass the approval/safety
   model.** An inline "quick action" button on a room is a convenience over
   the existing mutation path, never a new, ungated one.
4. **Do not build new domain visuals before wiring the ones that already
   have real backend data.** Section A.3 and A.8 are not hypothetical —
   they are the two clearest, verified instances of finished backend work
   with zero UI consumption. Fix those first (Steps 1–3) before inventing
   anything new.
5. **Do not treat the engine-room pages as something to delete.** They are
   necessary AOS-factory infrastructure and stay fully functional — they
   are demoted in *navigational priority*, not removed.
6. **Do not hardcode this for a single user.** Every new component must
   read from `scope`/`actorId` the same way `gatherJarvisFacts` already
   does, so the same shell renders correctly the day a second user (family
   member, business, tenant) exists — this is what makes the "AI
   Government" vision real instead of aspirational.
7. **Do not mark this phase complete based on visual polish alone.** Per
   the standing project discipline: no fake success, verify with real
   checks (smoke tests, typecheck, and here additionally — does the
   Presence Bar actually render `primaryPriority` from a real
   `/v1/jarvis/briefing` response, not a hardcoded placeholder).

---

## J. The single best next implementation step

**Wire the Jarvis Presence Bar to the existing, fully-built, fully-tested
`/v1/jarvis/briefing` endpoint (Section H, Step 1).**

This is the correct first move for four concrete reasons:

- It requires zero new backend logic — the endpoint, the ranking, the
  priority-correction fix, and the 26/26 smoke coverage already exist and
  are already proven correct against the real failed conversation.
- It is the most direct, visible fix to the exact class of failure already
  called out twice now (previously: memory written but not read in the
  answer path; now: a briefing endpoint built but not rendered anywhere) —
  closing it first demonstrates the "actually wire things end-to-end"
  discipline this document was explicitly commissioned to restore.
- It replaces the least-integrated, least-visible part of the current
  homepage (the current "Jarvis today-summary card," which shows one
  flattened sentence) with the most structurally important new element
  (the Presence Bar) in a single, contained change — a real product leap
  achievable without touching the nine-zone grid at all.
- It creates the visual foundation (Presence Bar + Focus Row) that every
  subsequent step in Section H builds on top of, so the very next steps
  compound instead of needing rework.

Concretely: add a `briefing()` method to `services/dashboard-web/src/lib/
gateway.ts` calling `GET /v1/jarvis/briefing`, build the `JarvisPresenceBar`
component consuming `primaryPriority`/`activeBlockers`/
`recommendedNextActions`/`confidence`/`dataFreshness` directly, and replace
the current summary card in `page.tsx`. This is the recommended starting
point for the next implementation session.
