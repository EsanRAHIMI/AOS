/**
 * MongoDB Atlas index plan (D-186) — one declaration, every collection the
 * shared modules own.
 *
 * WHY THIS FILE EXISTS. Indexes used to be created ad hoc inside individual
 * service boot files, which meant the newer collections (all of CIN, the
 * living loop, the heartbeat, K2 memory/missions/sessions) had **none at
 * all**. On Atlas that is not a style problem: every one of those queries was
 * a collection scan, so cost and latency grew linearly with the owner's
 * history — precisely the thing that must not happen in a system meant to run
 * for years.
 *
 * Two kinds of index appear below and they are NOT interchangeable:
 *
 *  1. PERFORMANCE indexes — make an existing query cheap. Adding or dropping
 *     one changes speed, never correctness.
 *  2. CONSTRAINT indexes (`unique: true`) — make an invariant true. These
 *     replace "check-then-insert" application logic, which is a race under
 *     any concurrency. `loop_inbox {actorId, eventKey}` is what actually makes
 *     event ingestion idempotent, and `cin_ledger {chainId, seq}` is what
 *     actually makes the hash chain linear. The code catches the resulting
 *     duplicate-key error and treats it as the truth it is.
 *
 * TTL is applied ONLY to pure telemetry that can be regenerated (heartbeat
 * runs). Nothing that is a record of truth — the ledger, documents, entities,
 * claims, cycles, memories — is ever expired automatically.
 *
 * `ensureIndexes()` is idempotent and safe to run on every boot: Mongo ignores
 * a createIndex for an index that already exists with the same spec.
 */
import type { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { COLLECTIONS } from '../constants/index.js';
import { getDb } from './index.js';

export interface IndexPlanEntry {
  collection: string;
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
  /** Why this index exists — kept next to it so it is never cargo-culted. */
  reason: string;
}

/** Days of heartbeat telemetry to keep. Runs are diagnostics, not evidence. */
export const HEARTBEAT_RUN_TTL_DAYS = 30;

export const INDEX_PLAN: IndexPlanEntry[] = [
  /* ------------------------------- CIN core ------------------------------ */
  {
    collection: COLLECTIONS.CIN_ENTITIES, keys: { entityId: 1 }, options: { unique: true, name: 'entityId_unique' },
    reason: 'identity lookup by id; an entity id must be unique by construction',
  },
  {
    collection: COLLECTIONS.CIN_ENTITIES, keys: { entityType: 1, status: 1, createdAt: -1 }, options: { name: 'type_status_created' },
    reason: 'the entity list is always filtered by type/status and sorted by recency',
  },
  {
    collection: COLLECTIONS.CIN_RELATIONS, keys: { relationId: 1 }, options: { unique: true, name: 'relationId_unique' },
    reason: 'edge lookup by id',
  },
  {
    collection: COLLECTIONS.CIN_RELATIONS, keys: { fromEntityId: 1, status: 1 }, options: { name: 'from_status' },
    reason: '1-hop graph walk, outgoing side',
  },
  {
    collection: COLLECTIONS.CIN_RELATIONS, keys: { toEntityId: 1, status: 1 }, options: { name: 'to_status' },
    reason: '1-hop graph walk, incoming side ($or uses one index per branch)',
  },
  {
    collection: COLLECTIONS.CIN_RELATIONS,
    keys: { fromEntityId: 1, toEntityId: 1, relationType: 1 },
    options: { name: 'active_edge_unique', unique: true, partialFilterExpression: { status: 'active' } },
    reason: 'CONSTRAINT: at most one ACTIVE edge of a type between two entities — the duplicate guard, enforced by the database rather than a findOne',
  },
  {
    collection: COLLECTIONS.CIN_KEYS, keys: { keyId: 1 }, options: { unique: true, name: 'keyId_unique' },
    reason: 'claim verification resolves the signing key by id',
  },
  {
    collection: COLLECTIONS.CIN_KEYS,
    keys: { entityId: 1 },
    options: { name: 'entity_active_key_unique', unique: true, partialFilterExpression: { status: 'active' } },
    reason: 'CONSTRAINT: one active signing key per entity — two would make signatures ambiguous',
  },
  {
    collection: COLLECTIONS.CIN_CLAIMS, keys: { claimId: 1 }, options: { unique: true, name: 'claimId_unique' },
    reason: 'verify/revoke by id',
  },
  {
    collection: COLLECTIONS.CIN_CLAIMS, keys: { subjectEntityId: 1, issuedAt: -1 }, options: { name: 'subject_issued' },
    reason: '"claims about me", newest first — the profile surface',
  },
  {
    collection: COLLECTIONS.CIN_CLAIMS, keys: { issuerEntityId: 1, issuedAt: -1 }, options: { name: 'issuer_issued' },
    reason: '"claims I issued", newest first',
  },
  {
    collection: COLLECTIONS.CIN_LEDGER,
    keys: { chainId: 1, seq: 1 },
    options: { unique: true, name: 'chain_seq_unique' },
    reason: 'CONSTRAINT + PERF: makes the hash chain strictly linear (two writers cannot claim the same seq) and makes head lookup / verification an index scan instead of a table scan',
  },
  {
    collection: COLLECTIONS.CIN_LEDGER, keys: { refId: 1, at: -1 }, options: { name: 'ref_at' },
    reason: '"history of this entity/document" without scanning the whole chain',
  },
  {
    collection: COLLECTIONS.CIN_DOCUMENTS, keys: { docId: 1 }, options: { unique: true, name: 'docId_unique' },
    reason: 'document lookup by id',
  },
  {
    collection: COLLECTIONS.CIN_DOCUMENTS, keys: { ownerEntityId: 1, createdAt: -1 }, options: { name: 'owner_created' },
    reason: 'the owner document list, newest first',
  },
  {
    collection: COLLECTIONS.CIN_DOCUMENTS, keys: { ownerEntityId: 1, expiresAt: 1 }, options: { name: 'owner_expiry' },
    reason: 'the heartbeat asks "what expires soon?" on every pulse — must not scan',
  },

  /* ---------------------------- living loop ------------------------------ */
  {
    collection: COLLECTIONS.LOOP_INBOX,
    keys: { actorId: 1, eventKey: 1 },
    options: { unique: true, name: 'actor_eventkey_unique' },
    reason: 'CONSTRAINT: this is what actually makes ingestion idempotent (gate G4). The previous findOne-then-insert was a race under concurrent producers',
  },
  {
    collection: COLLECTIONS.LOOP_INBOX, keys: { actorId: 1, status: 1, receivedAt: 1 }, options: { name: 'actor_status_received' },
    reason: 'the tick pulls pending events oldest-first, every minute, forever',
  },
  {
    collection: COLLECTIONS.LOOP_CYCLES, keys: { cycleId: 1 }, options: { unique: true, name: 'cycleId_unique' },
    reason: 'cycle lookup by id',
  },
  {
    collection: COLLECTIONS.LOOP_CYCLES, keys: { actorId: 1, createdAt: -1 }, options: { name: 'actor_created' },
    reason: 'the /loop console lists cycles newest first',
  },
  {
    collection: COLLECTIONS.LOOP_CYCLES, keys: { actorId: 1, status: 1, updatedAt: 1 }, options: { name: 'actor_status_updated' },
    reason: 'restart recovery scans for stale running cycles (gate G9) on every tick',
  },
  {
    collection: COLLECTIONS.OWNER_STATE_SNAPSHOTS, keys: { actorId: 1, at: -1 }, options: { name: 'actor_at' },
    reason: 'every cycle reads the previous snapshot to diff against it',
  },

  /* ------------------------------ heartbeat ------------------------------ */
  {
    collection: COLLECTIONS.PROACTIVE_EVENTS,
    keys: { actorId: 1, kind: 1, dedupKey: 1, status: 1 },
    options: { name: 'actor_kind_dedup_status' },
    reason: 'the dedup check runs once per candidate on every pulse',
  },
  {
    collection: COLLECTIONS.PROACTIVE_EVENTS, keys: { actorId: 1, status: 1, createdAt: -1 }, options: { name: 'actor_status_created' },
    reason: 'the owner stream polls open events by cursor, continuously',
  },
  {
    collection: COLLECTIONS.HEARTBEAT_RUNS, keys: { actorId: 1, at: -1 }, options: { name: 'actor_at' },
    reason: 'last-pulse lookup',
  },
  {
    collection: COLLECTIONS.HEARTBEAT_RUNS,
    keys: { at: 1 },
    options: { name: 'heartbeat_ttl', expireAfterSeconds: HEARTBEAT_RUN_TTL_DAYS * 86400 },
    reason: 'TTL: pulse telemetry is diagnostics, not evidence. Without it this collection grows every few minutes forever. Nothing that is a record of truth gets a TTL',
  },

  /* --------------------------- K2 agent + memory -------------------------- */
  {
    collection: COLLECTIONS.JARVIS_SESSIONS, keys: { sessionId: 1 }, options: { unique: true, name: 'sessionId_unique' },
    reason: 'every turn resolves its session by id',
  },
  {
    collection: COLLECTIONS.JARVIS_SESSIONS, keys: { createdBy: 1, updatedAt: -1 }, options: { name: 'owner_updated' },
    reason: 'the dock and the stage both resolve "my most recent session" on load (scopeFilter uses createdBy, sort is updatedAt)',
  },
  {
    collection: COLLECTIONS.JARVIS_SESSION_TURNS, keys: { sessionId: 1, index: 1 }, options: { name: 'session_index' },
    reason: 'transcript replay is session-scoped and ordered by turn index, both directions',
  },
  {
    collection: COLLECTIONS.MEMORY_RECORDS, keys: { memoryId: 1 }, options: { unique: true, name: 'memoryId_unique' },
    reason: 'correct/pin/delete address a memory by id',
  },
  {
    collection: COLLECTIONS.MEMORY_RECORDS, keys: { createdBy: 1, deletedAt: 1, updatedAt: -1 }, options: { name: 'owner_alive_updated' },
    reason: 'retrieval is owner-scoped, excludes tombstones and sorts by updatedAt — the exact shape used on every turn',
  },
  {
    collection: COLLECTIONS.MEMORY_RECORDS, keys: { createdBy: 1, subject: 1, supersededBy: 1 }, options: { name: 'owner_subject_live' },
    reason: 'the dedup/supersede path resolves a live memory by its stable subject key',
  },
  {
    collection: COLLECTIONS.MISSION_NODES, keys: { nodeId: 1 }, options: { unique: true, name: 'nodeId_unique' },
    reason: 'tree traversal resolves nodes by id',
  },
  {
    collection: COLLECTIONS.MISSION_NODES, keys: { createdBy: 1, status: 1, updatedAt: -1 }, options: { name: 'owner_status_updated' },
    reason: 'mission health (overdue/stalled/blocked) runs on every heartbeat and every loop cycle',
  },
  {
    collection: COLLECTIONS.MISSION_NODES, keys: { parentId: 1 }, options: { name: 'parent' },
    reason: 'building the tree walks children by parent',
  },
  {
    collection: COLLECTIONS.AGENT_LOOP_RUNS, keys: { runId: 1 }, options: { unique: true, name: 'runId_unique' },
    reason: 'approval resume resolves the exact run',
  },
  {
    collection: COLLECTIONS.AGENT_LOOP_STEPS, keys: { runId: 1, index: 1, createdAt: 1 }, options: { name: 'run_index_created' },
    reason: 'step streaming reads a run\'s steps ordered by index then createdAt — the literal sort used by listAgentLoopSteps',
  },
  {
    collection: COLLECTIONS.WATCHES, keys: { createdBy: 1, kind: 1 }, options: { name: 'owner_kind' },
    reason: 'watch evaluation is owner-scoped',
  },
  {
    collection: COLLECTIONS.WATCH_FIRINGS, keys: { createdBy: 1, createdAt: -1 }, options: { name: 'owner_created' },
    reason: 'recent firings feed the heartbeat and the briefing',
  },
  /* --- D-192: Google Calendar / Tasks mirror -------------------------- */
  {
    collection: COLLECTIONS.GOOGLE_TOKENS,
    keys: { actorId: 1, provider: 1 },
    options: { unique: true, name: 'actor_provider_unique' },
    reason: 'CONSTRAINT: one Google grant per owner. Two rows would mean two refresh tokens racing to refresh each other into invalidity.',
  },
  {
    collection: COLLECTIONS.CALENDAR_SYNC_STATE,
    keys: { actorId: 1, resourceId: 1 },
    options: { unique: true, name: 'actor_resource_unique' },
    reason: 'CONSTRAINT: one sync token per calendar. A duplicate row means one of them silently stops advancing and that calendar stops updating.',
  },
  {
    collection: COLLECTIONS.CALENDAR_EVENTS,
    keys: { actorId: 1, calendarId: 1, eventId: 1 },
    options: { unique: true, name: 'actor_calendar_event_unique' },
    reason: 'CONSTRAINT: the mirror is keyed by Google id; duplicates would show the owner the same meeting twice.',
  },
  {
    collection: COLLECTIONS.CALENDAR_EVENTS,
    keys: { actorId: 1, start: 1 },
    options: { name: 'agenda_by_start' },
    reason: 'PERFORMANCE: every agenda read is a time-range scan sorted by start — the hot path of the calendar page and the heartbeat.',
  },
  {
    collection: COLLECTIONS.CALENDAR_TASKS,
    keys: { actorId: 1, taskListId: 1, taskId: 1 },
    options: { unique: true, name: 'actor_list_task_unique' },
    reason: 'CONSTRAINT: same reason as events — the Google task id is the identity.',
  },
  {
    collection: COLLECTIONS.CALENDAR_TASKS,
    keys: { actorId: 1, due: 1 },
    options: { name: 'tasks_by_due' },
    reason: 'PERFORMANCE: "what is due" is the only question anyone asks of tasks.',
  },
  {
    collection: COLLECTIONS.CALENDARS,
    keys: { actorId: 1, calendarId: 1 },
    options: { unique: true, name: 'actor_calendar_unique' },
    reason: 'CONSTRAINT: one row per calendar in the owner list.',
  },
];

export interface EnsureIndexesResult {
  created: string[];
  existing: number;
  failed: Array<{ index: string; error: string }>;
}

/**
 * Create every planned index. Idempotent and fail-soft per index: one bad
 * index (e.g. a unique constraint that existing data violates) is reported
 * but never prevents the rest — and never takes the process down at boot.
 *
 * A violated unique constraint is IMPORTANT information: it means the data
 * already contains duplicates the code assumed impossible. It is surfaced in
 * `failed` rather than swallowed.
 */
export async function ensureIndexes(db?: Db): Promise<EnsureIndexesResult> {
  const database = db ?? getDb();
  const result: EnsureIndexesResult = { created: [], existing: 0, failed: [] };

  for (const entry of INDEX_PLAN) {
    const label = `${entry.collection}.${entry.options?.name ?? JSON.stringify(entry.keys)}`;
    try {
      const before = await database.collection(entry.collection).indexes().catch(() => []);
      const had = before.some((i) => i.name === entry.options?.name);
      await database.collection(entry.collection).createIndex(entry.keys, entry.options ?? {});
      if (had) result.existing += 1; else result.created.push(label);
    } catch (err) {
      result.failed.push({ index: label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** Human-readable plan — used by the ops script and the docs. */
export function describeIndexPlan(): string {
  return INDEX_PLAN
    .map((e) => `${e.collection.padEnd(24)} ${JSON.stringify(e.keys).padEnd(48)} ${e.options?.unique ? 'UNIQUE ' : ''}${e.options?.expireAfterSeconds ? 'TTL ' : ''}— ${e.reason}`)
    .join('\n');
}
