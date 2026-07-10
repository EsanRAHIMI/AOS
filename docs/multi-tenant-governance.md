# Multi-Tenant Governance

AOS must support two truths at the same time:

1. Software development is global, coordinated, and shared across the platform.
2. User, tenant, organization, department, and citizen data is private,
   permission-scoped, and isolated.

Esan is the primary owner and platform governor. Future users may join as
operators, admins, reviewers, government officials, department staff, auditors,
or citizens.

## Enforcement: scope-by-construction (K1.4a)

Isolation is enforced by CONSTRUCTION, not convention. The only sanctioned way
to touch scoped (tenant/user/project/case) data is
`scopedCollection(name, ctx)` from `@factory/shared` (`shared/src/db/scoped.ts`):

- every read filter is `$and`-merged under `scopeFilter(actor, scope)` — a
  caller cannot widen a query across a scope boundary, even deliberately;
- every insert is stamped by `stampScope` from the ACTOR's identity; documents
  carrying conflicting scope fields are rejected, not corrected;
- scope identity fields (`scope`, `tenantId`, `userId`, `projectId`, `caseId`)
  are immutable via update — records never migrate scopes silently;
- missing actor identifiers fail closed (constructor throws).

`canAccess` (route-level authorization) remains required — `scopedCollection`
enforces isolation, not permission. Raw `collection()` stays legitimate ONLY
for global kernel collections.

### Enforcement mechanics (K1.4b, D-158)

Isolation is now checked by a static gate as well as the wrapper itself.
`scripts/check-scope-boundary.mjs` (wired into CI, `node scripts/check-
scope-boundary.mjs` locally) enforces three rules:

1. Only `shared/src/db/index.ts` (the raw `collection()` definition) and
   `shared/src/db/scoped.ts` (the wrapper) may call raw `collection()`
   anywhere in `shared/`. One documented escape hatch exists today —
   `shared/src/agentrun/index.ts` — for `agent_runs`, which is global
   kernel self-development state with no scope fields, not human data.
2. No `services/*/src/routes/**` module may call `collection()` directly —
   route handlers only ever reach data through `GatewayDeps` or a
   per-request `scopedCollection(ctx)`.
3. A migration ratchet: once a collection is migrated, its name is added to
   `MIGRATED_COLLECTIONS` in the script, and a raw `collection(COLLECTIONS.X)`
   call anywhere in `services/` referencing it becomes a hard CI failure,
   permanently. `scoped_memories` is the first entry (K1.4b).

The script also reports (non-blocking) the count of raw `collection()` calls
still in `services/gateway-api/src/server.ts` — the K1.3 flat-handle zone
(D-157) — as visible, tracked debt.

Isolation guarantees at the wrapper level are pinned by
`shared/test/scoped-collection.contract.test.ts` (14 tests: fail-closed on
missing actor, filters can only narrow, inserts/updates can't touch scope
identity). Route-level cross-user isolation is proven per migrated route
group in that service's characterization suite — see
`services/gateway-api/test/characterization.personal-scope.test.ts` for the
proofs (a foreign user's row seeded directly into the fake collection never
surfaces through the route).

### Migration status (K1.4b–d)

Six collections migrated onto `scopedCollection(ctx)` so far, all in
`routes/personal.ts`: `scoped_memories` (K1.4b, D-158), `personal_health_
states`/`personal_life_items`/`personal_finance_items`/`personal_learning_
tracks` (K1.4c, D-159), `opportunity_reports` (K1.4d, D-160). Each is locked
in `MIGRATED_COLLECTIONS` in `scripts/check-scope-boundary.mjs` — a raw
handle for any of them can never reappear.

**Not migrated, and why (this is the honest remainder, not an oversight):**

- **The rest of the personal-fact family** (`realityProfiles`,
  `personalProjects`, `personalAssets`, `personalSystems`, `personalRisks`,
  `personalOpportunities`, `personalIncomeStreams`, `personalCareerRecords`,
  `resumeProfiles`, `nextBestActions`, `personalBriefingRuns`,
  `strategyReviewRuns`, `dailyBriefings`, `userGoals`): all properly
  scoped (`RequiredScopeSchema`), but all also read/written inside
  `server.ts`'s Jarvis/operator `executors` block (D-157's standing
  boundary). Migrating them means touching that subsystem, which is out of
  scope until a session explicitly targets it.
- **`consentGrants`, `connectorAccounts`, `connectorSyncRuns`, `userProfiles`,
  `memberships`**: schema gap, no `scope` field exists on these documents at
  all. See D-161 for the proposed fix — logged, not yet implemented.
- **`accessDecisions`**: has a `scope` field, but it classifies the
  *resource the decision was about*, not the audit-log collection itself; the
  real access pattern (owner sees all, others see only their own actions by
  `actorId`) doesn't fit the four-scope model as-is. See D-161 for the
  recommendation (keep global + explicit allowlist, design a dedicated
  accessor later if isolation here becomes a priority).
- **`tenantsCol`**: correctly global — the tenant registry itself, keyed by
  `tenantId`, not per-record scoped human data.

## Scope Model

Every record must be one of:

- `global`: kernel state such as services, deployments, schemas, docs, prompts, capabilities.
- `tenant`: organization, team, department, or government-unit state.
- `user`: private user profile, connectors, memory, briefings, approvals.
- `project`: shared project/workspace context inside a tenant.
- `case`: citizen/public-service workflow with strict role boundaries.

## Required Fields For Scoped Data

Future scoped records should include:

- `scope`: `global | tenant | user | project | case`
- `tenantId`
- `userId` when personal
- `projectId` or `caseId` when relevant
- `visibility`
- `source`
- `confidence`
- `consentGrantId` when data came from a connector
- `createdBy`, `updatedBy`
- `auditContext`

## Access Rules

- Global kernel state can be read by authorized platform operators.
- Tenant data can be read only by users with tenant membership and permission.
- User data can be read only by that user or explicitly delegated roles.
- Citizen/public-service data defaults to the strictest access.
- Cross-tenant learning must use anonymized/aggregated data unless explicit consent exists.
- Debugging must never bypass data isolation.

## Development Rules

- New software capabilities are global by default.
- New user data collections are scoped by default.
- No connector writes until read-only sync, consent, policy, approval, and audit are implemented.
- Reports must state which scope they use.
- Agents must load scoped memory before acting and must not mix scopes.

## Role Direction

Initial roles:

- `owner`: platform governance and protected-core approvals.
- `admin`: tenant/user administration within allowed scope.
- `operator`: run tasks and approve non-critical actions within scope.
- `reviewer`: review outputs, risks, and compliance.
- `viewer`: read-only access within scope.
- `agent`: service actor that can request but not bypass approval.

Future public-service roles:

- `government_official`
- `department_operator`
- `case_worker`
- `auditor`
- `citizen`

These roles must be permission-based, not hardcoded assumptions.
