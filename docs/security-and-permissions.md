# Security & Permissions

AOS is powerful only if it stays controllable. Security posture: observable,
approval-gated, least privilege, no hidden production changes.

## Hard Rules

- No blind destructive action.
- No secret exposure in logs, events, evidence, prompts, screenshots, or UI.
- No real-world external or public-impact action without approval.
- No deploy, rollback, env mutation, protected-core change, or data deletion without policy.
- No fake success when a provider, API, or permission is missing.
- Every important action creates audit/evidence/events.

## Current Controls

- `FACTORY_INTERNAL_TOKEN` for service-to-service calls.
- Real, DB-backed gateway auth (K1, D-164): credentialed `user_accounts` + revocable `sessions`,
  bearer session tokens (`x-factory-session-token`), scrypt password hashing. See "K1 Real Auth"
  below for the full model.
- Dashboard-web privileged auth with signed server-side sessions (its own, independent login —
  see "K1 Real Auth" for how it relates to the gateway's session model).
- RBAC roles: owner, admin, operator, reviewer, viewer, agent; future tenant roles may include government_official, department_operator, citizen, auditor.
- Approval center for sensitive actions.
- Safe mode blocks mutation/deploy/repair/governance.
- Policy engine with allow/block/approval-required decisions.
- Audit logs and security events.
- Protected core checks for gateway, dashboard, and shared kernel.

## Data Isolation Rules

- Personal and institutional records must be scoped by `tenantId` and `userId` where applicable.
- Global kernel records are explicitly global: service manifests, deployments, schemas, docs, capabilities.
- A user can only read/write data allowed by role, tenant membership, consent, and policy.
- Cross-tenant analytics must use aggregation/anonymization unless explicitly approved.
- Citizen/public-service data must default to least privilege and audit-heavy access.

## Sensitive Action Classes

- Production deploy/restart/rollback/env mutation.
- GitHub branch/commit/PR/merge actions.
- Code changes to protected core.
- Data deletion, migration, restore, or bulk export.
- Sending email/messages or changing external accounts.
- Financial, identity, legal, or irreversible owner-impacting actions.
- Personal connector write actions.
- Government/public-service decisions, case updates, notifications, or citizen-facing outputs.

## Required Future Hardening

- OIDC/OAuth2 login (current: first-party email+password only — no external IdP).
- Provision every production dashboard operator as a real gateway user (D-165 bridge is wired,
  but activation still requires this manual step per operator), then default
  `FACTORY_ALLOW_LEGACY_ROLE_AUTH` to `false` (see "K1 Real Auth" deprecation path below).
- Tenant model with role inheritance, delegation, and consent records.
- Redis-backed rate limits, lockouts, sessions, and safe-mode propagation.
- Short-lived service identity tokens for internal calls.
- OpenTelemetry with trace ids attached to events/evidence.
- Secret scanning in CI and deployment env audits.
- Connector permission scopes: read-only first, write later with approval previews.
- Password reset / rotation flow, session-per-device management UI, email verification.

## Owner Interaction Rule

When AOS needs approval, it must explain:

1. What will happen.
2. Why it matters.
3. What data/source supports it.
4. What can go wrong.
5. How to undo or stop it.

For multi-user or public-service contexts, it must also state whose data,
tenant, department, or citizen case is affected.

## K1 Real Auth — users, sessions, legacy fallback (D-164)

**Credentials.** `user_accounts` (collection) stores `email` + `passwordHash`
(`scrypt$<saltHex>$<hashHex>`, never plaintext) + `primaryTenantId` + `status`. Distinct from
`users` (decorative RBAC display data, no credentials) and `user_profiles` (personal profile data).

**Sessions.** `POST /v1/auth/login` issues an opaque 32-byte bearer token; only its sha256 hash is
ever persisted, in `sessions`. Present it via `x-factory-session-token`. `GET /v1/auth/session`
introspects it; `POST /v1/auth/logout` revokes it immediately (revoked/expired tokens fail closed,
never fall back to another auth path). Sessions carry a fixed `tenantId`, so a session token can
never be reused to act as a different tenant.

**No account enumeration.** Wrong password, unknown email, and a suspended account all return the
identical 401 body. An unknown-email login still performs a dummy password verification so response
timing doesn't leak account existence either.

**User provisioning.** `POST /v1/auth/users` is owner-only, audited, and requires either a
plaintext `password` (hashed server-side immediately, never stored/logged/returned) or a pre-hashed
`passwordHash`. There is no self-serve signup.

**No invented secrets, ever.** Neither the gateway's boot-time bootstrap nor
`scripts/migrate-scope-foundation.mjs` will generate or print a plaintext password. The owner's
credential is seeded only if `FACTORY_OWNER_PASSWORD_HASH` is set to a validly-formatted
`scrypt$<hex>$<hex>` value; otherwise setup instructions are logged (`node scripts/hash-password.mjs
'<password>'` → set the env var → re-run) and login stays unavailable rather than silently
defaulting.

**Legacy fallback — temporary, not a backdoor.** The pre-K1 `x-factory-admin-token` +
self-declared `x-factory-role` header path still works, gated by `FACTORY_ALLOW_LEGACY_ROLE_AUTH`
(default `true`). It exists only for K1 compatibility and CI/internal/dev use. When the switch is
set to `false`, the admin token alone still satisfies `guard()` (service/dev reachability), but the
self-declared role is no longer trusted — it resolves to `viewer`, the least-privileged role,
instead of whatever the header claims. In production, the gateway now logs a boot-time warning if
this switch is left `true` (D-165) — a visibility aid, not an enforcement gate.

**Dashboard-web bridge (D-165).** Dashboard-web's own login (independent, scrypt-hashed,
env-configured credentials, its own signed session cookie) now also attempts a real gateway login
with the same credentials at sign-in. If the gateway has a matching, active `user_accounts` row,
the real bearer token is stored inside the dashboard's existing httpOnly/secure/sameSite cookie and
forwarded as `x-factory-session-token` on every subsequent gateway call — the dashboard then acts
under a real, revocable, per-user session instead of the legacy role header. If there's no matching
gateway account (dev-only demo logins, or a production operator not yet provisioned), the bridge
silently no-ops and the dashboard continues on the legacy path exactly as before — zero regression,
not a degraded mode. **To make a production dashboard operator use a real session, provision them
as a real gateway user with the same email/password**: `node scripts/hash-password.mjs
'<password>'` → `POST /v1/auth/users` (owner-only) with that hash and the matching email. **Full
deprecation path:** once every production dashboard operator (not just the owner) is provisioned
this way, and CI/internal tooling's direct admin-token usage is the only remaining legacy caller,
set `FACTORY_ALLOW_LEGACY_ROLE_AUTH=false`. This is not yet safe to do by default — it requires that
manual provisioning step first.

## Phase AA — scope & identity enforcement
Authorization is centralized in the shared `canAccess` engine, enforced at the
gateway via a standard AuthContext. Missing scope FAILS CLOSED. User data is
accessible only to the user (owner support access is approval-gated + audited);
tenant data only to tenant members; citizen cases only to the citizen and
assigned case roles; connector data only with an ACTIVE read-only consent
grant; service agents never approve; viewers never mutate; cross-tenant
analytics is approval-gated. Every denial and approval-required decision is
recorded in `access_decisions` (+ security event) and rendered at
`/settings/access-log`. Isolation is proven by 39 checks in
`scripts/phaseaa-scope-smoke.mjs`. Migration (`migrate-scope-foundation.mjs`)
is idempotent and non-destructive: kernel records become explicit
`scope:'global'`; single-owner history is scoped to Esan.
