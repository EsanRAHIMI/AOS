import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * K1 Real Auth (D-164) — credentialed user accounts + server-side sessions.
 *
 * Deliberately distinct from two existing, similarly-named things:
 *  - `RbacUserSchema` (governance.ts, collection `users`): decorative RBAC
 *    display data (userId/name/role only, no credentials, seeded by
 *    orchestrator-agent, shown read-only at GET /v1/rbac). Untouched by this
 *    change — different purpose, different collection.
 *  - `UserProfileSchema` (identity.ts, collection `user_profiles`): personal
 *    PROFILE data (display name, locale, preferences), scope-stamped and
 *    read/written through scopedCollection(ctx) by routes/personal.ts.
 *
 * `UserAccountSchema` (collection `user_accounts`) is CREDENTIAL data only —
 * the one place a password hash is ever stored. `SessionSchema` (collection
 * `sessions`, reserved since Phase 1, previously unused) is a real, DB-backed,
 * revocable server-side session — replacing the dashboard's own stateless
 * signed-cookie session, which the gateway had no knowledge of at all.
 * ======================================================================== */

export const UserAccountSchema = z.object({
  userId: z.string(),
  email: z.string(),
  /** scrypt$<saltHex>$<hashHex> — see shared/src/auth hashPassword/verifyPasswordHash.
   *  Nullable: an account can exist without a local password (future non-password
   *  provisioning) but such an account simply can never complete /v1/auth/login. */
  passwordHash: z.string().nullable().default(null),
  primaryTenantId: z.string(),
  status: z.enum(['active', 'suspended']).default('active'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type UserAccount = z.infer<typeof UserAccountSchema>;

export const SessionSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  tenantId: z.string(),
  /** sha256(token) — the raw bearer token is returned once at login and
   *  never stored. See shared/src/auth generateSessionToken/hashSessionToken. */
  tokenHash: z.string(),
  createdAt: IsoDate,
  expiresAt: IsoDate,
  lastSeenAt: IsoDate,
  revokedAt: IsoDate.nullable().default(null),
});
export type Session = z.infer<typeof SessionSchema>;
