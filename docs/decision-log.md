# Decision Log

Records significant engineering decisions and why. Newest first.

## 2026-07-10 — Phase K1.4e/f Scope-By-Construction: Identity/Connector Cluster Completed (D-161 implemented)

Supersedes D-161's "proposal, not implemented" status. The user set a new operating standard for
K1 work: a subsystem is not complete because one safe slice moved — it is complete when it is
operationally reliable, tested, documented, and has no hidden follow-up inside the same subsystem
unless that follow-up is genuinely blocked by a different prerequisite subsystem. Under that
standard, leaving D-161 as a written proposal was not good enough — it left 5 collections
(`consentGrants`, `connectorAccounts`, `connectorSyncRuns`, `userProfiles`, `memberships`)
permanently un-isolatable by construction, which is exactly the kind of hidden gap the new
standard exists to catch. Both the schema fix (D-162) and the route migration (D-163) below were
implemented in this pass, not deferred again.

### D-162 Identity/connector schemas gained an explicit `scope` field; write paths fixed; legacy data backfilled
Implemented D-161's proposed fix in full, as its own logically-separate change (schema +
write-path + backfill), verified and typechecked before D-163's route migration touched a single
call site — consistent with this session's rule that schema changes and access-pattern migrations
are different risk classes and stay in separately-verified commits.
1. `shared/src/schemas/identity.ts`: added `scope: z.literal('user')` to `ConsentGrantSchema`,
   `ConnectorAccountSchema`, `ConnectorSyncRunSchema`, `UserProfileSchema`; added `scope:
   z.literal('tenant')` to `TenantMembershipSchema`. Existing `tenantId`/`userId` fields were left
   untouched (still required, non-null strings) — deliberately NOT switched to
   `RequiredScopeSchema.extend()`, which would have made them nullable and risked breaking other
   consumers of these types. `UserProfileSchema` got the field too, per D-161's "still add it, flag
   as lower urgency" recommendation — consistency with the rest of the pattern outweighs the
   marginal cost for a 1-row-per-user collection.
2. `shared/src/scope/index.ts` `buildEsanSeed()`: the owner/user/membership seed objects now
   include the new `scope` literal, so the very first records ever written already carry it.
3. Three write sites in `routes/personal.ts` updated to stamp `scope: 'user'` on the object literal
   at construction time (not `stampScope()`, to keep the diff minimal and match the file's existing
   style at those call sites): `POST /v1/consents` (ConsentGrant), `POST /v1/connectors`
   (ConnectorAccount), `POST /v1/connectors/:id/sync` (ConnectorSyncRun).
4. `scripts/migrate-scope-foundation.mjs` gained a new idempotent, non-destructive backfill section
   (3b) that adds `scope` to any pre-existing document in the five collections that doesn't already
   have it — `updateMany({scope:{$exists:false}}, {$set:{scope, migrationNote}})`, never touching
   `tenantId`/`userId`. Same safe pattern as the existing kernel/voice backfill sections.
5. Verification: `shared` typecheck clean, `shared` tests 107/107 (pre-existing; D-162 itself added
   no new shared tests — the schema addition is exercised indirectly via D-163's gateway tests and
   directly via the new `accessDecisionFilter` unit tests below, which share the file).

### D-163 Identity/connector cluster routes migrated onto `scopedCollection(ctx)`; `accessDecisions` read policy extracted
With D-162's schema gap closed, re-verified (via `grep -n "\b<name>\." server.ts` per collection,
not assumption) exactly which of the 5 collections could have their raw `GatewayDeps` handle fully
removed versus which have a second, legitimate consumer inside `server.ts` that this session is
still not allowed to touch (D-157, the Jarvis/operator executors block):

- **`connectorAccounts`, `connectorSyncRuns`** — zero usage anywhere in `server.ts` outside their
  own declaration and the `GatewayDeps` assembly line. Fully migrated: `routes/personal.ts` now
  uses `connectorAccountsFor(actor)` / `connectorSyncRunsFor(actor)` for every call site (11 total
  across `GET/POST /v1/connectors`, `POST /v1/connectors/:id/sync`, `POST /v1/consents/:id/revoke`'s
  cascade block, and the `connectors` slice in `GET /v1/me/universe` + `/v1/me/universe/detail`).
  Raw handle removed entirely from `server.ts` and `GatewayDeps`. Added to the
  `check-scope-boundary.mjs` ratchet — a raw handle can never be reintroduced for either, anywhere
  in `services/`.
- **`memberships`** — one other usage in `server.ts`: the idempotent owner-seed bootstrap
  (`await memberships.updateOne({membershipId...}, {$setOnInsert: seed.membership}, {upsert:
  true})`, inside the "Idempotent bootstrap: Esan is the first owner" block). This is NOT the
  Jarvis executors subsystem — it is a one-time, singleton, upsert-only write that can never
  overwrite existing data and never reads arbitrary user data. `routes/personal.ts`'s own usage
  (`GET /v1/tenants/current`'s member list) is fully migrated to `membershipsFor(actor)`. The raw
  handle stays LOCAL to `server.ts` for the seed line only — not exported via `GatewayDeps`, not
  reachable from any route — and is documented as an accepted, provably-safe exception rather than
  a blocker. NOT added to the ratchet (adding it would fail CI against this legitimate remaining
  line); the boundary script comments explain why.
- **`userProfiles`, `consentGrants` — genuine, exact blocker (not vague "future work"):**
  - **Collections:** `user_profiles`, `consent_grants`.
  - **Exact remaining raw usage:** `server.ts` line ~1073 (`userProfiles.findOne(...)`) and lines
    ~1075/~1088 (`consentGrants.find(...)`), both inside the `executors` object's operator-context
    builder; additionally `consentGrants` is read at line ~602 inside `loadGraphInput()`, which is
    itself called exclusively from 5 sites inside that same `executors` object (`generate_daily_
    briefing`, `build_reality_baseline`, resume analysis, weekly strategy, next-action scoring —
    the D-157 Jarvis/operator tool-executor subsystem).
  - **Reason it cannot be completed now:** this session is explicitly instructed not to touch the
    Jarvis/operator executor subsystem in `server.ts`. Removing the raw handle would break those
    executors; adding either collection to the ratchet would make `check-scope-boundary.mjs` fail
    against that subsystem's own legitimate (if not yet scope-by-construction) reads.
  - **Dependency:** a future K-phase that takes on the Jarvis/operator executors subsystem itself
    (refactoring `loadGraphInput` and the operator-context builder onto `scopedCollection(ctx)`,
    which requires passing an `AuthContext` through that whole call chain — currently some callers
    only have a bare `userId`).
  - **Unblock condition:** when that subsystem is explicitly put in scope (it is out of scope for
    every K1.4x pass by standing instruction), `loadGraphInput` and the operator-context builder can
    be refactored to accept/derive an `AuthContext` and use `userProfileFor`/`consentGrantsFor`
    internally; at that point the raw `server.ts` handles for both collections can be deleted and
    both names added to the ratchet.
  - **Required next action:** none in K1 — tracked here so it is never silently forgotten; revisit
    when the Jarvis/operator subsystem itself becomes the active workstream.
  - **Test required after unblocking:** an isolation probe equivalent to this pass's — seed a
    foreign-scoped `user_profiles`/`consent_grants` row directly into the fake collection and prove
    the operator-context executor (and `loadGraphInput`) never surfaces it, plus the existing
    fail-closed 403 pattern for a missing actor.
  - What IS true today, and is a real improvement even with the blocker: `routes/personal.ts` can
    no longer reach either collection via a raw handle at all — `userProfileFor(actor)` and
    `consentGrantsFor(actor)` are the only access path from any route, for the read/write sites this
    session covers (`GET /v1/me/context`, `GET/PATCH /v1/me/profile`, `GET/POST /v1/consents`,
    `POST /v1/consents/:id/revoke`, `POST /v1/connectors`, `POST /v1/connectors/:id/sync` — 11 call
    sites in total across the two collections). The remaining raw access is entirely contained to
    the one subsystem already flagged off-limits by D-157, not scattered.
- **`accessDecisions`** — per D-161's own recommendation, NOT forced into `scopedCollection`
  (its `scope` field means "scope of the resource the decision was about", not a classification of
  the audit-log collection itself; the real read policy is "owner/platform_admin sees everything,
  everyone else sees only their own actorId"). That policy was previously inlined at the one call
  site (`GET /v1/access-decisions`); extracted to a pure, independently-testable function —
  `accessDecisionFilter(actor)` in `shared/src/scope/index.ts` — so the rule is unit-tested
  (`shared/test/scope-engine.contract.test.ts`) independent of the HTTP layer. `accessDecisions`
  keeps its raw `GatewayDeps` handle (unchanged from K1.3/D-161 — this was never a candidate for
  the ratchet).
- **Security hardening found and fixed in passing, not a behavior change requiring approval:**
  `POST /v1/connectors/:id/sync`'s `consentGrants.findOne({grantId: account.consentGrantId})` had
  NO scope filter at all in the pre-migration code — it relied entirely on `account` already being
  user-owned. `consentGrantsFor(auth).findOne({grantId: account.consentGrantId})` makes that
  guarantee structural instead of incidental. This only narrows the query (fail-closed direction),
  never widens it, so it cannot break the "preserve existing behavior unless a test proves it
  unsafe" rule — the existing behavior for any legitimate (same-user) request is identical.
  Similarly noted: `POST /v1/connectors/:id/sync` has no `enforceScoped()` call at all (relies on
  `guard()` + the account/grant lookups being scoped) — pre-existing, not introduced or changed by
  this pass, left as-is since fixing it would be an authorization-policy change, not a data-access
  migration, and is out of this pass's scope.

**Tests added:** 12 new isolation/write-stamp/fail-closed tests in
`services/gateway-api/test/characterization.personal-scope.test.ts` (profile read/update
isolation, tenant membership list isolation, consent grant read/write/revoke isolation, connector
account read/write/sync isolation, universe connectors-slice isolation, access-decisions
owner-vs-non-owner filtering, one fail-closed 403 case) + 4 new unit tests for
`accessDecisionFilter` in `shared/test/scope-engine.contract.test.ts`.

**Verification:** `shared` typecheck clean, `shared` tests 111/111 (107 + 4 new). `gateway-api`
typecheck clean, `gateway-api` tests 214/214 (202 + 12 new). `scripts/check-scope-boundary.mjs`
passes: ratchet grew from 6 to 8 entries (`CONNECTOR_ACCOUNTS`, `CONNECTOR_SYNC_RUNS` added;
`USER_PROFILES`/`TENANT_MEMBERSHIPS`/`CONSENT_GRANTS` deliberately excluded, with the reason
recorded inline in the script itself); `server.ts` legacy raw-`collection()` debt count dropped
from 100 to 98 (the two fully-removed declarations).

## 2026-07-10 — Phase K1.4d Scope-By-Construction: Last Isolated Collection + Blocked-Collection Proposal

### D-160 `opportunity_reports` migrated onto `scopedCollection(ctx)` — last collection in this class
Re-verified all remaining raw handles in `routes/personal.ts` against their actual Zod schemas
(not the object literal at one call site) and their FULL usage in `server.ts` (not just the
declaration line). Finding: `realityProfiles`, `personalProjects`, `personalAssets`,
`personalSystems`, `personalRisks`, `personalOpportunities`, `personalIncomeStreams`,
`personalCareerRecords`, `resumeProfiles`, `nextBestActions`, `personalBriefingRuns`,
`strategyReviewRuns`, `dailyBriefings`, `userGoals` all correctly extend `RequiredScopeSchema`
(properly scoped) but are EVERY ONE of them also read or written inside `server.ts`'s
`executors` object (`generate_daily_briefing`, `build_reality_baseline`, resume analysis, weekly
strategy, next-action scoring — lines ~1070-1270) — the Jarvis/operator tool-executor subsystem
D-157 explicitly deferred. K1.4b/K1.4c already migrated everything that was both properly scoped
AND fully isolated from that subsystem; `opportunity_reports` (1 call site, `GET
/v1/me/opportunities`) was the one remaining collection satisfying both conditions. Migrated via
`opportunityReportsFor(actor)`, same shape as `memoriesFor`/`healthStatesFor` etc. Raw handle
removed from `GatewayDeps`/`server.ts` (declaration, assembly, unused type import). Ratchet in
`scripts/check-scope-boundary.mjs` extended to 6 entries. New tests (2) in
`characterization.personal-scope.test.ts`: foreign-user row never surfaces through `GET
/v1/me/opportunities`; fail-closed 403 holds. Verification: shared 107/107, gateway-api 202/202
(200 pre-existing + 2 new), typecheck/build clean, scope-boundary script passes (server.ts legacy
debt 101 → 100).

### D-161 PROPOSAL (not implemented): write-path fix for the identity/connector cluster
`ConsentGrantSchema`, `ConnectorAccountSchema`, `ConnectorSyncRunSchema`, `UserProfileSchema`,
`TenantMembershipSchema` (`shared/src/schemas/identity.ts`) carry **no `scope` field at all** —
unlike every `RequiredScopeSchema`-derived collection in the personal-fact family, these were
built before the Phase AA scope model and never retrofitted. `scopedCollection(ctx)`'s guard
merges `{scope:'user', userId}` (or `{scope:'tenant', tenantId}`) into every query; against a
collection whose documents never carry a `scope` field, that guard matches nothing — a mechanical
migration would silently return empty results instead of the caller's actual data. This is a
write-path/schema gap, not a route-migration task, and is being logged as a proposal rather than
implemented in the same pass that does additive-only scope migrations, per this session's own
rule that schema changes are a different risk class.

**Proposed fix, sequenced as its own K1.4e (or later) pass:**
1. Extend `ConsentGrantSchema`, `ConnectorAccountSchema`, `ConnectorSyncRunSchema` with
   `scope: Scope` (literal `'user'` for these three — they are always per-user connector state).
   Extend `TenantMembershipSchema` with `scope: Scope` (literal `'tenant'`). `UserProfileSchema`
   is a genuine edge case (see below).
2. Update the 3 write sites in `routes/personal.ts` (`POST /v1/consents`, `POST /v1/connectors`,
   `POST /v1/connectors/:id/sync`) and the membership-seeding path (`buildEsanSeed` in
   `shared/src/scope/index.ts`) to stamp `scope` on every new document — either via a literal
   (`scope: 'user' as const`) alongside the existing `tenantId`/`userId` fields, or by adopting
   `stampScope(actor, 'user', {...})` the way the personal-fact family already does, which is
   preferred for consistency.
3. No backfill migration is required before this fix ships: master-direction confirms AOS is
   still pre-multi-user (one seeded owner, `user_esan`); there is no production data with these
   collections populated under a second identity yet. If that changes before this pass lands, add
   a one-time backfill script (pattern already exists: `scripts/migrate-scope-foundation.mjs`)
   that stamps `scope` on legacy documents by inferring it from their existing `tenantId`/`userId`
   fields before the route migration ships, so no window of silently-empty reads opens in
   production.
4. Once schemas + write paths carry `scope`, `consentGrants`/`connectorAccounts`/
   `connectorSyncRuns`/`memberships` become drop-in candidates for the exact same
   `scopedCollection(ctx)` accessor pattern as D-158/159/160; add them to the ratchet at that
   time. Do NOT do this as part of the schema-fix pass — keep schema changes and access-pattern
   migrations in separate, separately-verified commits, consistent with this session's own rule.

**`UserProfileSchema` — recommend treating as a special case, not force-fitting the scope model:**
a user profile is a 1-row-per-user identity record, not a collection of many user-owned facts.
Its natural key (`userId`, already unique) already prevents one query from returning multiple
users' profiles AS LONG AS every read filters by an exact `userId`. The realistic residual risk
scope-by-construction defends against — a future handler doing `userProfiles.find({})` with no
filter at all — is real but rare for a 1:1 identity collection. Recommend still adding a `scope:
'user'` field for consistency and defense-in-depth (cheap, and it unifies the pattern), but flag
it as lower urgency than the connector cluster, which handles OAuth-adjacent account state.

**`accessDecisions` — recommend NOT forcing into `scopedCollection`, propose a dedicated pattern
instead:** `AccessDecisionSchema` does carry a `scope` field, but it means something different
here than everywhere else — it records the SCOPE OF THE RESOURCE the access decision was ABOUT
(e.g. a decision about a user-scoped read carries `scope:'user'`), not a classification of the
audit-log collection itself. The audit log is fundamentally a GLOBAL collection (every actor's
decisions, across every scope, in one place) with an application-level read split (owner sees
all; everyone else sees only `{actorId: actor.actorId}` — note: filtered by the ACTING actor, not
`targetUserId`, so it isn't even a per-target-user view). Forcing this through
`scopedCollection(ctx, {scope:'user'})` would filter on the wrong field and silently break the
owner's full-visibility case; forcing it through `{scope:'global'}` would incorrectly require
every access-decision document to literally carry `scope:'global'`, which is false for the
majority of records. Recommendation: leave `accessDecisions` on its current raw `GatewayDeps`
handle (already legitimate under the K1.3 flat-handle pattern — no script violation, this is a
different category from the `shared/src`-only restriction D-158 introduced) rather than force a
mismatched migration, and — if isolation for this collection becomes a real priority later —
design a second accessor alongside `scopedCollection` (e.g. `actorScopedCollection`) purpose-built
for "owner sees all, everyone else sees only their own actions" instead of stretching the existing
four-scope model to fit it.

## 2026-07-10 — Phase K1.4c Scope-By-Construction: Personal-Facts Family

### D-159 Second migration wave — personal_health_states/life_items/finance_items/learning_tracks
Reconciled repo state against `master-direction.md` and the K1.4b commit before starting (no
drift: ratchet held `SCOPED_MEMORIES` only, 105 raw `collection()` calls in `server.ts`, 197/197
gateway tests green). Re-verified isolation of the 7 collections flagged in D-158 as next
candidates; found one new fact worth recording: `connectorAccounts` documents are written WITHOUT
a `scope` field at all (no `stampScope` call in the account-creation handler), so migrating it
onto `scopedCollection(ctx)` as-is would silently change behavior (the wrapper's guard filters on
`{scope:'user', userId}` and would match zero existing rows) — deferred to a pass that first fixes
the write path, not folded into this one. Chose the "personal facts" family instead —
`personal_health_states`, `personal_life_items`, `personal_finance_items`,
`personal_learning_tracks` — because all four already write via `userStamp(actor)` (correctly
scope-stamped) and read via one shared `uFilter` variable reused across `/v1/me/universe` and
`/v1/me/universe/detail`, making the migration mechanically identical across all four (same risk
profile as D-158, four times the collections). 12 call sites total (4 inserts in the
`POST /v1/me/reality/ingest` kind-switch, 4 reads each in `/v1/me/universe` and
`/v1/me/universe/detail`) now go through four new per-request accessors (`healthStatesFor`,
`lifeItemsFor`, `financeItemsFor`, `learningTracksFor`, same shape as D-158's `memoriesFor`). Raw
handles removed from `GatewayDeps`, `server.ts`'s declaration block, and the `deps` assembly
object — not left as dead code; unused type imports (`PersonalHealthState`, `PersonalLifeItem`,
`PersonalFinanceItem`, `PersonalLearningTrack`) removed from both `deps.ts` and `server.ts`.
New tests in `characterization.personal-scope.test.ts` (3 added, 7 total in the file): seeded a
foreign-user row per collection directly into the fake DB and proved `GET /v1/me/universe/detail`
— the one route that echoes each collection's raw array back (`data.health.states`,
`data.life.items`, `data.finance.items`, `data.growth.learningTracks`) — never returns any of
them; proved all four `POST /v1/me/reality/ingest` kinds write correctly scope-stamped documents;
proved the fail-closed 403 (missing `primaryUserId`) on `/v1/me/universe/detail` matches the
D-158 precedent. `scripts/check-scope-boundary.mjs`'s `MIGRATED_COLLECTIONS` ratchet extended to
5 entries (`SCOPED_MEMORIES` + the four new names) — a raw handle for any of them reappearing
anywhere in `services/` is now a permanent CI failure. Verification: shared 107/107, gateway-api
200/200 (197 pre-existing + 3 new in the extended isolation file), typecheck and build clean
for both packages, scope-boundary script passes (legacy debt in `server.ts` down to 101, from 105).
Remaining unsafe direct access, still deferred: `opportunityReports`, `connectorAccounts` (needs a
write-path fix first), `connectorSyncRuns`, `accessDecisions` (non-uniform access pattern — owner
sees all, others see only their own `actorId`, not a simple `scope:'user'` filter), the
identity/tenant block, and the Jarvis/operator subsystem (D-157's standing boundary, untouched).

## 2026-07-10 — Phase K1.4b Scope-By-Construction: First Route Migration

### D-158 `scoped_memories` migrated onto `scopedCollection(ctx)`; static boundary gate added
First real migration of a gateway route onto the K1.4a wrapper (D-156), plus the lint/static
rule that D-156 deferred. Inventory: all ~99 Mongo collection handles the gateway touches are
declared once in `server.ts` and threaded through one flat `GatewayDeps` object (D-157) — gateway
route modules already contained zero direct `collection()` calls, so migration means replacing a
raw `deps.X` handle at each call site with `scopedCollection(name, ctx)`. Classified the full
inventory by scope (global kernel / tenant / user / project·case / legacy-unknown — zero legacy-
unknown found); the user-scoped "personal operating layer" in `routes/personal.ts` (health,
finance, career, memories) is the highest-value target since it is currently filtered only by
hand-rebuilt `{scope:'user', userId}` filters in every handler. Chose `scoped_memories` as the
first, smallest slice: fully isolated (zero references anywhere outside `personal.ts`, confirmed
by grep — not touched by the deferred Jarvis/operator subsystem, D-157), 5 call sites, one
existing filter pattern. All 5 call sites now build a per-request `scopedCollection<ScopedMemory>
(COLLECTIONS.SCOPED_MEMORIES, {actor, scope:'user'})` instead of using the raw handle; the raw
handle was removed from `GatewayDeps`, `server.ts`'s declaration block, and its `deps` assembly
entry (not left as dead code). New test `characterization.personal-scope.test.ts` proves the
guarantee: a foreign user's `scoped_memories` document seeded directly into the fake collection
never surfaces through `GET /v1/me/memories` or `/v1/me/universe`, a request with no resolvable
`primaryUserId` is denied at `enforceScoped` before the data layer is reached (403, not a 500 from
`scopedCollection`'s internal throw), and a write is provably scope-stamped. Honest limitation
documented in that file: real per-user auth doesn't exist yet (`legacyRoleToAuthContext` always
resolves to `user_esan`), so a *second real* HTTP identity can't be driven through this harness —
the isolation proof works by seeding a foreign-scoped row directly, which is exactly the failure
mode (a stray unfiltered document) construction-based enforcement defends against; the wrapper's
own fail-closed/no-widening guarantees are unit-proven independently in
`shared/test/scoped-collection.contract.test.ts` (14 tests, K1.4a). Added
`scripts/check-scope-boundary.mjs`, wired into CI: (1) raw `collection()` confined to
`shared/src/db/{index,scoped}.ts`, with one documented escape hatch (`shared/src/agentrun/
index.ts` — `agent_runs` is global self-development state, no scope fields, pre-existing and
unrelated to this migration, allowlisted rather than silently ignored); (2) no
`services/*/src/routes/**` module may call `collection()` directly; (3) a ratchet list
(`MIGRATED_COLLECTIONS`) that hard-fails CI if a migrated collection's raw handle ever
reappears anywhere in `services/` — seeded with `SCOPED_MEMORIES`, grows with each future pass.
The script also non-blockingly reports the remaining raw-`collection()` count in
`server.ts` (105 after this change) as tracked debt, rather than pretending the whole
surface is migrated. Full verification: shared 107/107, gateway-api 197/197 (193 pre-existing +
4 new), typecheck and build clean for both packages. Remaining unsafe direct access (by design,
deferred): the other 7 fully-isolated personal-fact collections
(`personalHealthStates`/`LifeItems`/`FinanceItems`/`LearningTracks`, `opportunityReports`,
`connectorAccounts`, `connectorSyncRuns`, `accessDecisions`) are next (K1.4c); the
identity/tenant block (`tenantsCol`/`userProfiles`/`memberships`/`consentGrants`) after that
(K1.4d); the Jarvis/operator subsystem (voice, jarvis*, opTools/opSessions/opMemories) stays
untouched per D-157's explicit boundary — migrating it is a real decomposition, not a mechanical
swap, and conflicts with the standing "do not rewrite Jarvis" rule for this phase.

## 2026-07-10 — Phase K1.3 Gateway Split (characterize → then move)

### D-157 Gateway split design: characterization-first, verbatim bodies, one flat GatewayDeps
The 3,698-line gateway monolith was split ONLY after 193 characterization tests pinned its
behavior (auth sweep over 85 read surfaces, task/approval/infra flows, RBAC/safe-mode/rate-limit
semantics) via a new in-process harness (`buildGatewayService` seam + fastify inject + fake Db
through the shared `setTestDb` seam). Design decisions: (1) route bodies moved VERBATIM into
`src/routes/*.ts` — diff-proven, 7/10 modules byte-identical; (2) the shared runtime (collection
handles, guards, security helpers, cross-group subsystems: operations executor, voice kernel-task,
personal graph loaders, operator/Jarvis runtime) stays in `server.ts` behind ONE flat `GatewayDeps`
object so moved bodies keep their exact identifiers; (3) exactly two mechanical deviations, both
typecheck-verified and test-verified: `let lastDokploySyncAt` → shared `dokploySync.lastAt` state
object (a destructured `let` cannot be assigned across module boundaries; 5 call sites), and six
operator-collection consts relocated to server.ts (they sat inside a moved line range but belong
to the shared runtime). Explicitly NOT done in this pass (separate later passes, not mixed): the
operator/Jarvis helper subsystem decomposition, scopedCollection route migration, the
`collection()` lint rule, and removal of the pre-existing duplicate errorHandler override
(observed via FSTWRN004 — service-kit's is overridden by the gateway's identical copy; left
as-is because behavior freeze beats cleanup during a split).

## 2026-07-10 — Phase K1.4a Scope-By-Construction Data Layer

### D-156 `scopedCollection(ctx)` — isolation moves from convention to construction
Phase AA's scope model was enforced by convention (routes remembering to call the helpers).
K1.4a adds the structural half (master-direction §C.5): a wrapper over `collection()` where the
scope guard is merged under `$and` on every read/update/delete (caller filters can only narrow,
never widen), inserts are stamped from the ACTOR's identity with conflicting scope fields
rejected, and scope identity fields are immutable via update. Fail closed on missing identifiers.
Deliberately ADDITIVE in this commit: no existing route changes behavior; kernel routes migrate
onto it during the K1 gateway split, together with a lint rule confining raw `collection()` to
global kernel collections. Test seam: an injectable collection, so isolation guarantees are
tested without a database (14 contract tests).

## 2026-07-10 — Phase K1.1 Test Substrate (master-direction.md era begins)

### D-155 Event `source` re-asserted required — first bug caught by contract tests
Phase AA's `.merge(ScopeFieldsSchema)` into `SystemEventSchema` silently replaced the REQUIRED
event `source` (emitting serviceId) with scope-provenance's OPTIONAL `source` — the bus was
accepting anonymous events. The very first contract-test run exposed it. Fixed by re-asserting
`source: z.string()` via `.extend()` after the merge, with a comment naming the collision.
Risk assessed as low: `EventPublisher` always stamps `source`, so no legitimate publisher is
affected; verified by shared/service-kit/event-bus/gateway typechecks + full suite green.
Lesson recorded: schema merges can silently weaken required fields — contract tests are the net.

### D-154 Vitest as the workspace test runner; contract tests colocated per package
Phase K1 (see docs/master-direction.md §D/§J) requires a trust substrate before any refactor.
Vitest 4 chosen: native TS/ESM, resolves the codebase's NodeNext `.js` specifiers to `.ts`
sources without a build step, single dependency, fast (full suite <1s). Tests live in
`<package>/test/*.contract.test.ts` and import SOURCE, not dist. The 30+ bespoke smoke scripts
in `scripts/` are superseded progressively: each one is deleted in the PR that converts its
coverage into real tests. Root `pnpm test` runs the recursive suite.

## 2026-07-10 — Phase AH.2 Health Intelligence Surface

### D-153 Anatomical regions and systemic layers are different kinds of things, and the architecture says so
The rebuilt health surface splits its 20 domains into 14 anatomical regions (rendered as on-body
anchors + rail chips) and 6 systemic layers (sleep/recovery, stress/nervous, activity, body
composition, energy/hormones, general — rendered as a chip strip, never as a fake organ dot),
because pinning "sleep" or "BMI" to a body coordinate is medically dishonest and visually
arbitrary. This split is the scaling seam: new regions only need an anchor + short label; new
cross-body categories (wearables, labs, AI interpretations) become layers with zero geometry work;
and multi-user/citizen monitoring reuses `buildHealthModel()` per person since the model is a pure
function of metrics. Severity became a five-grade scale (critical/attention/moderate/optimal/noted)
instead of ok/warn/err so triage order, chip retention under space pressure, and worst-first
sorting all derive from one vocabulary. Rails retain worst-severity chips and cap per variant
("+N more" overflow) so many metrics degrade gracefully instead of stacking labels into noise —
the compact/full variant pair (homepage card vs /health room) is the same component over the same
model, keeping one source of truth. `BodyMap` stays as a thin compat wrapper so the `BodyMetric`
contract and both consumers were untouched.

## 2026-07-10 — Phase AH Premium Body Intelligence Map

### D-152 Hand-tuned inline SVG silhouette over a body-map library, with zone logic split out as pure TS
The Health zone's visual was rebuilt as a custom anatomical silhouette (a single hand-tuned cubic
path) instead of adopting a react-body-highlighter-style dependency: the AOS aesthetic (dark glass,
glow, biometric rings, recovery orbit) is not what those libraries render, the runtime cost of a
dependency buys nothing over a static path, and a library's region taxonomy would dictate our
semantics instead of the reverse. Semantics live in `src/lib/bodyZones.ts` — a JSX-free module
mapping every metric to one of 7 zones (unknown metrics fall back to whole-body rather than being
dropped or guessed at) — so smoke tests exercise the real mapping logic without a JSX/DOM toolchain
(same standalone-compile pattern as AF.2's domainCanvas). Every zone always exists in the model and
all geometry/ids are static constants, which is what structurally rules out hydration mismatches.
Concern signaling stays calm by design: a slow opacity pulse and a small counter in the err tone,
never a modal/alert-style treatment — consistent with the "observable, not alarming" dashboard
principle. The `BodyMetric` contract was intentionally left unchanged so both consumers
(`/health`, homepage card) upgraded without edits.

## 2026-07-09 — Phase AG.5 Research LLM Output Schema/Prompt/Retry-Repair Fix

### D-148 The prompt and the schema had fallen out of sync — the fix changes both together, not one alone
Phase AG.3's v2 prompt asked the model to reason toward a richer answer (findings that explain *why*
they matter, opportunity/next-action recommendations) than the flat `findings: string[]` schema still
accepted, and never told the model the literal JSON field names to use. Patching only the prompt (to
ask for the old flat shape again) would have reverted AG.3's actual improvement; patching only the
schema (to accept anything) would have violated "do not accept invalid vague output." The fix instead
brings the schema forward to match what the prompt already wanted — structured findings/opportunities
with required core fields and safely-defaulted optional narrative fields — and gives the prompt an
explicit, literal JSON shape example colocated with the schema in the same file, so future changes to
one are far more likely to be caught updating the other than when the shape lived only in prose.

### D-149 Required vs. optional is decided per-field by whether omission is ever legitimate, not applied uniformly
`title`/`detail` on a finding (and `title`/`action` on an opportunity) stay strictly required — a
finding with no title or detail isn't a valid finding, and loosening that would violate the explicit
"do not make everything loose" instruction. `whyItMatters`/`confidence`/`sourceIndexes`/`rationale`
default safely instead, because a model can legitimately have a real finding without enough evidence to
say confidently why it matters — forcing that case to fail validation would reject good-faith, honest
output for the wrong reason. The default value itself ("Not enough evidence in retrieved sources.") is
a stated absence of evidence, never an invented claim — satisfying "if unknown, use a short honest
string" without ever fabricating content to satisfy the schema.

### D-150 The public ResearchReport contract stays untouched; only the LLM-facing intermediate schema changed
`ResearchReport.findings`/`.recommendations` remain flat `string[]`, exactly as they've been since
Phase 13 — every downstream consumer (Jarvis-facing summary text in `interpretResearchTaskResponse()`,
`ResearchTaskPayload`, the dashboard, and the AG.2/AG.3/AG.4 smoke tests) needed zero changes. New
`flattenFindings()`/`flattenRecommendations()` helpers convert the richer LLM output down to that flat
shape at the one place `runResearch()` builds the stored report. This kept the fix's blast radius to
exactly the two files that needed to change (`shared/src/intelligence/index.ts`,
`shared/src/llm/index.ts`) plus fixture updates in two existing smoke tests, rather than propagating a
new nested shape through gateway-api, the dashboard, and every schema/contract that reads a research
report — consistent with "smallest correct fix" across every AG.x phase so far.

### D-151 Retry-repair works by telling the model exactly what was wrong, not by asking it to guess again
`generateStructured()`'s retry loop previously sent the byte-identical prompt on every attempt — a
model that misunderstood the required shape once had no reason to understand it differently the second
time, which is exactly why the reported bug said "(attempt 2)" in its error text. The fix captures the
first failure's exact field path (via `parsed.error.issues[0].path`, not just `.message`) and appends a
corrective note to the retry prompt naming that path and the underlying reason, instructing the model to
return corrected JSON with every required field present. This is now a real repair mechanism, verified
in the new smoke test with a fake provider that only succeeds on attempt 2 *if* the corrective note
actually reached the prompt — not merely retried optimistically.

## 2026-07-09 — Phase AG.4 Research Route/Host Contract Fix

### D-145 A registered production domain, not a missing route, was the actual cause of the research 404
`internet-research-service` already correctly registers `POST /.factory/task` via the same
`createFactoryService` mechanism every service uses — there was no route or contract gap to add.
Investigation instead found the defect in gateway-api's `dispatchResearch()`: `svc?.domain ??
peerUrl(...)`, where `svc` is the service's own self-registered manifest resolved from the local
service-registry. Every service's manifest hardcodes its PRODUCTION subdomain
(`https://{id}.simorx.com`) regardless of environment — this is correct and necessary for production
(Dokploy deployments are real, separate hosts reachable only by their real domain), but in local dev,
where `SERVICE_REGISTRY_URL` points at a locally-running service-registry, every service still
self-registers with that same hardcoded production domain. `internet-research-service` only began
actually completing this self-registration successfully after Phase AG.2 added it to
`LOCAL_SERVICES` — before that, it never started locally at all, so `ctx.registry.resolve()` always
returned null and `dispatchResearch()` always fell through to the correct `peerUrl()` localhost
default by accident. Once the service was actually running (Phase AG.2's fix), the registry began
returning a real record whose `domain` is `https://research.simorx.com` — the owner's actual root
domain, which resolves and answers HTTP requests (just not with this service or route), producing
"reachable... 404... unknown error" instead of a DNS-level connection failure. This is a genuinely
different failure class from Phase AG.2's (that was the service never listening at all); the same
symptom text ("returned 404") could easily be mistaken for a route-naming bug, but the actual defect
was entirely in *which host* gateway-api chose to call, not *which path*.

### D-146 `resolvePeerUrl()` fixes this without weakening production correctness or duplicating `peerUrl()`
The tempting quick fix — always use `peerUrl()` and drop the registry lookup for research — would have
broken production, where gateway-api has no `INTERNET_RESEARCH_SERVICE_URL` env var configured and
relies on the registry-resolved domain being correct (each service really is a separate, independently
deployed Dokploy host reachable only by its real subdomain). The chosen fix instead adds explicit
precedence: an env override (local-dev-only, wired through `scripts/local-services.mjs`'s existing
`extra` mechanism — the same one already used for `ORCHESTRATOR_AGENT_URL`) beats the registry domain,
which beats `peerUrl()`'s bare localhost default. This is implemented once as a pure, exported,
unit-tested `resolvePeerUrl()` in `shared/src/discovery/index.ts` rather than inline in
`dispatchResearch()`, specifically so the identical fix can be applied to the 6 other gateway-api call
sites carrying the exact same `svc?.domain ?? peerUrl(...)` pattern (`orchestrator-agent` ×4,
`monitor-agent` ×2) in a future pass without re-deriving the precedence logic — those were left
unfixed here because the reported bug and requested scope were specifically the research route, and
because those call sites currently fail silently (fire-and-forget, caught and logged as a warning)
rather than surfacing a user-visible error, making them lower urgency but not lower risk.

### D-147 404/405 is a distinct `route_not_found` outcome, and raw response bodies are no longer discarded
`interpretResearchTaskResponse()` previously bucketed every non-2xx status into the same generic
`service_error`, and always discarded the actual response body via `r.json().catch(() => ({}))` before
even checking whether it parsed — so a non-JSON body (such as the HTML a misrouted host actually
returns) silently became the bare, undiagnosable "unknown error", which is exactly what made this
bug's real cause invisible from the Jarvis reply text alone. 404/405 now get their own `route_not_found`
classification (a request that reached a real server but found no matching route/method — a contract
bug, not a generic failure), and `dispatchResearch()` now captures the raw response text unconditionally
before attempting to parse it as JSON, threading it through as `meta.rawBodySnippet` so the summary can
quote it directly. This follows the same "never fake success, never hide the real reason" discipline
established in Phase AG.3 for LLM synthesis failures — applied here to HTTP/routing failures instead.

## 2026-07-09 — Phase AG.3 Research Synthesis Quality & Stale Last-Operation Fix

### D-142 A discarded error, not a design gap, was silently downgrading real search results to raw snippets
The symptom ("6 real Tavily results, but `No LLM synthesis was performed this run`") looked like it
could be `runResearch()` intentionally skipping synthesis when grounded, or an env-sync gap specific
to `internet-research-service`. Both were ruled out: the grounded prompt in `runResearch()` already
asked for real synthesis, and the service's LLM env matches every other agent's exactly. The actual
defect was in `LlmRouter.generateStructured()` (`shared/src/llm/index.ts`): its retry loop's `catch`
block discarded the thrown error entirely, and a schema-validation failure was distinguished from "no
provider configured" nowhere in the returned trace — both collapsed into `usedFallback: true` with no
further detail. Compounding this, every completion request used the historical default
`maxTokens: 1024`, which is tight for a response that must echo metadata for up to 6 sources plus a
summary/findings/recommendations — a truncated completion is invalid JSON, which schema-validates as
a failure and looks identical to "the LLM isn't configured" from the caller's side. Fixed by capturing
the real per-attempt failure reason into a new `LlmTrace.errorDetail` field (thrown-error message or
which schema check failed) and adding a `maxTokens` option to `generateStructured()`, set to 3072 for
research specifically. `runResearch()` now derives `synthesisMode`/`synthesisFailureReason` from this
trace and states the *real* reason inline in the report summary instead of a generic "(deterministic
fallback)" phrase — directly satisfying the standing "no fake success" principle: a run must never be
labeled complete research when only raw snippets were actually produced, and the reason for the
downgrade must never be hidden.

### D-143 `synthesisMode` is a field independent of `sourceMode`, not a replacement for it
Phase AG already distinguished *where source URLs came from* (`sourceMode: search_api | llm_only |
curated_fallback`). This phase adds `synthesisMode: llm_synthesized | deterministic_fallback` as an
orthogonal axis — *whether the prose was reasoned over by an LLM*. The two can and do disagree: a run
can have real Tavily URLs (`sourceMode: search_api`) while LLM synthesis itself failed
(`synthesisMode: deterministic_fallback`), which is exactly the reported bug. Keeping them as separate
fields (rather than collapsing into one combined enum) means each caller — `interpretResearchTaskResponse()`,
Jarvis, the dashboard — can report both facts honestly without one masking the other; a hasty design
that conflated them would have had to pick one label for this exact combination and inevitably erred
toward overstating the result as either "unconfigured" (technically wrong — search worked) or "real"
(also wrong — synthesis didn't happen).

### D-144 Stale last-operation display: fix the root cause AND add a deterministic pure sort, not one or the other
Investigation found a genuine defect (`runLoop()`'s two early-`break` failure exit paths never set
`session.completedAt`, unlike the "reached the end of the plan" path) but reasoning through MongoDB's
BSON sort semantics for `.sort({ completedAt: -1 })` suggested a null `completedAt` sorts *last* in
descending order, not first — meaning the null-completedAt bug alone likely wasn't sufficient to fully
explain the exact "stale failed session shown ahead of a newer completed one" symptom on its own, and
the precise mechanism was not pinned down with full certainty. Rather than keep investigating to find
one single root cause, both were fixed: the `completedAt` gap (a real, independently-motivated defect
matching the user's explicit ask about "completedAt sorting"), plus a new pure, exported, unit-tested
`sortRecentSessions()` helper (`shared/src/operator/index.ts`) applied server-side to
`/v1/operator/live-state`'s `recentSessions` array before any consumer reads `[0]` from it. This
defense-in-depth approach means the displayed ordering is now correct regardless of the exact
mechanism behind the original symptom, and stays correct even if some other future code path leaves
`completedAt` unset again — the guarantee lives in one deterministic function every consumer shares,
not in each caller independently getting a database-level sort right.

## 2026-07-09 — Phase AG.2 internet-research-service Reachability

### D-140 Root cause of "fetch failed" was a missing service-catalog entry, not a URL/env bug
After Phase AG.1 wired `find_opportunities`/`research_topic` to call `internet-research-service`
synchronously, the live symptom was `"Could not reach internet-research-service ... fetch failed"`.
Investigation confirmed gateway-api's URL construction was already correct (`peerUrl()` resolves
`http://localhost:4115` by default, matching `SERVICE_PORTS['internet-research-service']`), and the
service itself correctly exposes `/health` and `/.factory/task`. The actual defect was one directory
up: `scripts/local-services.mjs` — the single source of truth for both `pnpm dev:all` (which
services actually get started) and `pnpm sync:env` (which services get a `.env` file written to
their directory) — never included `internet-research-service`. It has existed since the service was
first added (long before Phase AG), silently: nothing depended on reaching it synchronously until
Phase AG.1, so the gap was invisible until now. Fixed by adding it to `LOCAL_SERVICES` (port 4115,
`@factory/internet-research-service`), which makes both `dev:all` and `sync:env` include it, and
renumbering the local dev roster from 14 to 15 entries (also surfaced `code-operator-agent` was
missing from `README-SETUP.md`'s walkthrough for the same historical reason — added alongside it for
consistency, since fixing the table without it would have left a second, adjacent inaccuracy).

### D-141 Dispatch outcome classification moved into pure, exported helpers in `shared/src/research`
The previous `dispatchResearch()` in gateway-api collapsed three genuinely different situations
(connection refused, HTTP error, and "reached fine but Tavily isn't configured") into similar-looking
generic error strings, which is what made the real bug (service never started) indistinguishable
from a configuration problem in the reported symptom. `classifyResearchFetchFailure()` and
`interpretResearchTaskResponse()` are pure functions (no I/O) that turn a raw fetch failure or HTTP
response into one of `service_unreachable | service_error | empty_result | provider_not_configured |
null`, callable and unit-testable from a compiled smoke script exactly like every other pure module
in this codebase (`estimateReliability`, `rankOpportunities`, etc.) — gateway-api keeps the network
call itself but delegates interpretation. Critically, `provider_not_configured` carries `ok: true`:
a service that is reachable and honestly reports `sourceMode: 'llm_only'` did real work and said so
correctly — it is not the same class of problem as the service being down, and conflating the two
in the same "failure" bucket was part of what made the original symptom hard to diagnose from the
Jarvis reply text alone.

## 2026-07-09 — Phase AG.1 Research Fabric Wired Into Jarvis/Operator

### D-136 Real research is dispatched synchronously from gateway-api, not via the async kernel-task pipeline
Phase AG built `runResearch()` and a real `WebSearchProvider`, but the only Jarvis-reachable tool
wired to it (`research_topic`) called `createKernelTask()` — a fire-and-forget dispatch to
orchestrator-agent that replied "Research task started" in the same turn and left the actual
findings, `sourceMode`, and sources to show up later on `/research`, disconnected from the
conversation. A second tool, `find_opportunities`, carried a hardcoded `"research provider is
not_configured"` string that never checked whether Tavily was actually configured at all. Both are
now direct, synchronous `fetch()` calls from gateway-api to `internet-research-service`'s
`/.factory/task` (same pattern already used for `check_service_health`, `code-operator-agent`
tools, and monitor-agent repair dispatch — `executionPath: 'gateway_internal'`, not
`'kernel_task'`), awaited with a 45s timeout so the grounded summary, `sourceMode`, and top sources
land in the same reply the user is waiting on. The orchestrator's async `runResearchPipeline` is
unchanged and still used for multi-stage strategic-planning goals created via `/v1/tasks` — this
only affects the two tools the live Jarvis conversation can reach.

### D-137 `find_opportunities` keeps recorded-opportunity ranking as the first source of truth; live research is a fallback, not a replacement
A user's own captured opportunities (via `POST /v1/me/reality/ingest`) carry goal-linkage and
confidence scoring that a fresh web search cannot reconstruct. When the DB has ranked opportunities,
the tool still returns them unchanged. Live research only runs when the DB is empty, using the
user's actual goal text as the topic — replacing a permanently-hardcoded excuse string with a real,
honestly-labeled attempt, without discarding the higher-quality DB path when it has data.

### D-138 Goal→tool matching for open research questions is broadened beyond the literal words "research"/"investigate"
The reported failure ("Find current AI lighting design trends in Dubai luxury interiors") contains
none of the keywords the original `research_topic` trigger required. The deterministic matcher in
`planForGoal()` (`shared/src/operator/index.ts`) is intentionally regex-based, not LLM-based, so it
stays auditable and reproducible — the fix is a wider, still-deterministic regex (adds `trends`,
`find (the )?(current|latest|out about)`, `what's the latest/new/happening (in|on|with)`) checked
before the narrower `"opportunities ... me/my"` pattern, so generic topic questions reach research
and personal opportunity questions still reach DB-first ranking.

### D-139 `GET /v1/system/integrations`'s `research.configured` flag is cosmetic, not authoritative
`webSearchStatusFromEnv()` reads gateway-api's own process env, but gateway-api never calls Tavily
directly — it always delegates to `internet-research-service`, which is the only process that needs
`TAVILY_API_KEY`. Making the integrations flag authoritative would require gateway-api to either
duplicate the key (redundant secret sprawl) or query a new status endpoint on
internet-research-service (a real design change, out of scope for this fix per explicit instruction
not to redesign the research system). Left as-is with an explicit code comment; the authoritative,
always-accurate signal is the `sourceMode` returned on every individual `research_topic`/
`find_opportunities` reply, which reflects that specific call's real outcome rather than a cached
boot-time flag.

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
