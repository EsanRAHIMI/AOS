/**
 * Phase K1.4a — `scopedCollection(name, ctx)`: scope-by-construction data access.
 *
 * master-direction.md §C.5: isolation moves from convention to CONSTRUCTION.
 * This wrapper is the only sanctioned way to touch scoped (tenant/user/project/
 * case) data. It structurally guarantees:
 *
 *  - every READ filter is $and-merged with `scopeFilter(actor, scope)` —
 *    a caller cannot widen a query across a scope boundary, even on purpose;
 *  - every INSERT is stamped via `stampScope(actor, scope, …)` — and a document
 *    that arrives carrying CONFLICTING scope fields is rejected, not corrected;
 *  - every UPDATE is scope-filtered AND forbidden from touching scope fields —
 *    scope is immutable after write (a record never migrates tenants silently);
 *  - missing actor identifiers fail CLOSED (scopeFilter/stampScope both throw).
 *
 * `canAccess` (route-level authorization) remains the caller's responsibility —
 * this layer enforces isolation, not permission. Both are required.
 *
 * Migration path (K1): new/refactored kernel routes use this wrapper for all
 * scoped data. Raw `collection()` remains legitimate ONLY for global kernel
 * collections; a lint rule enforcing that boundary lands with the gateway
 * split. This module is additive — nothing existing changes behavior until
 * routes are migrated onto it.
 */
import type { Collection, Document, Filter, FindOptions, UpdateFilter, UpdateResult, DeleteResult, InsertOneResult, FindCursor, WithId, OptionalUnlessRequiredId } from 'mongodb';
import { collection as rawCollection } from './index.js';
import type { CollectionName } from '../constants/index.js';
import { scopeFilter, stampScope, type ScopeStamp } from '../scope/index.js';
import type { AuthContext, Scope } from '../schemas/scope.js';

export interface ScopedContext {
  actor: AuthContext;
  scope: Scope;
  /** Explicit target ids for project/case scopes (default: actor's active ids). */
  projectId?: string | null;
  caseId?: string | null;
}

/** Fields that define a record's scope identity. Immutable after write. */
const SCOPE_FIELDS = ['scope', 'tenantId', 'userId', 'projectId', 'caseId'] as const;

function assertContext(ctx: ScopedContext): void {
  if (!ctx || !ctx.actor || !ctx.actor.actorId) throw new Error('fail closed: scopedCollection requires an authenticated actor context');
  if (!ctx.scope) throw new Error('fail closed: scopedCollection requires an explicit scope');
}

/** $and-merge so a caller-supplied filter can never widen the scope guard. */
function mergeFilter<T extends Document>(guard: Record<string, unknown>, filter?: Filter<T>): Filter<T> {
  if (!filter || Object.keys(filter).length === 0) return guard as Filter<T>;
  return { $and: [guard, filter] } as Filter<T>;
}

/** Reject updates that try to modify scope identity fields. */
function assertUpdateDoesNotTouchScope<T extends Document>(update: UpdateFilter<T>): void {
  for (const [op, spec] of Object.entries(update)) {
    if (!op.startsWith('$') || typeof spec !== 'object' || spec === null) continue;
    for (const key of Object.keys(spec)) {
      const root = key.split('.')[0]!;
      if ((SCOPE_FIELDS as readonly string[]).includes(root)) {
        throw new Error(`fail closed: scope identity field "${root}" is immutable — records never migrate scopes via update`);
      }
    }
  }
}

/** Reject inserts that carry scope fields conflicting with the actor's stamp. */
function assertInsertMatchesStamp(doc: Record<string, unknown>, stamp: ScopeStamp): void {
  for (const field of SCOPE_FIELDS) {
    if (doc[field] !== undefined && doc[field] !== stamp[field]) {
      throw new Error(`fail closed: document carries ${field}="${String(doc[field])}" which conflicts with the actor's ${field}="${String(stamp[field])}" — cross-scope writes are rejected, not corrected`);
    }
  }
}

export interface ScopedCollection<T extends Document> {
  /** The scope guard applied to every operation (exposed for logging/tests). */
  readonly guard: Record<string, unknown>;
  find(filter?: Filter<T>, options?: FindOptions): FindCursor<WithId<T>>;
  findOne(filter?: Filter<T>, options?: FindOptions): Promise<WithId<T> | null>;
  countDocuments(filter?: Filter<T>): Promise<number>;
  insertOne(doc: OptionalUnlessRequiredId<T>, opts?: { visibility?: ScopeStamp['visibility'] }): Promise<InsertOneResult<T>>;
  updateOne(filter: Filter<T>, update: UpdateFilter<T>): Promise<UpdateResult>;
  updateMany(filter: Filter<T>, update: UpdateFilter<T>): Promise<UpdateResult>;
  deleteOne(filter: Filter<T>): Promise<DeleteResult>;
  deleteMany(filter: Filter<T>): Promise<DeleteResult>;
}

/**
 * Build a scope-enforcing view over a collection. Throws (fail closed) when the
 * actor context lacks the identifiers the scope requires.
 * `raw` is a test seam: inject a fake/stub collection; production callers omit it.
 */
export function scopedCollection<T extends Document = Document>(
  name: CollectionName,
  ctx: ScopedContext,
  raw?: Collection<T>,
): ScopedCollection<T> {
  assertContext(ctx);
  // Bind the actor's target ids for project/case scopes.
  const actor: AuthContext = {
    ...ctx.actor,
    activeProjectId: ctx.projectId ?? ctx.actor.activeProjectId,
    activeCaseId: ctx.caseId ?? ctx.actor.activeCaseId,
  };
  // Throws on missing ids — the fail-closed core of the whole layer.
  const guard = scopeFilter(actor, ctx.scope);
  const col = (): Collection<T> => raw ?? rawCollection<T>(name);

  return {
    guard,
    find: (filter, options) => col().find(mergeFilter(guard, filter), options),
    findOne: (filter, options) => col().findOne(mergeFilter(guard, filter), options),
    countDocuments: (filter) => col().countDocuments(mergeFilter(guard, filter)),
    insertOne: (doc, opts) => {
      const stamp = stampScope(actor, ctx.scope, {
        projectId: ctx.projectId ?? actor.activeProjectId ?? null,
        caseId: ctx.caseId ?? actor.activeCaseId ?? null,
        visibility: opts?.visibility,
      });
      assertInsertMatchesStamp(doc as Record<string, unknown>, stamp);
      return col().insertOne({ ...doc, ...stamp });
    },
    updateOne: (filter, update) => {
      assertUpdateDoesNotTouchScope(update);
      return col().updateOne(mergeFilter(guard, filter), update);
    },
    updateMany: (filter, update) => {
      assertUpdateDoesNotTouchScope(update);
      return col().updateMany(mergeFilter(guard, filter), update);
    },
    deleteOne: (filter) => col().deleteOne(mergeFilter(guard, filter)),
    deleteMany: (filter) => col().deleteMany(mergeFilter(guard, filter)),
  };
}
