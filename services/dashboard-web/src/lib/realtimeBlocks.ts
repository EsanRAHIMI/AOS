/**
 * Phase AF.4 — the real block-invalidation manifest. Pure data, no React —
 * importable by the smoke test. A "block" is a named, independently
 * refreshable piece of the homepage; `presence` and `channels` are
 * deliberately distinct (`presence` = the Jarvis Presence Bar, briefing-
 * derived; `channels` = the "Presence & Channels" Domain Canvas zone,
 * connector-derived — same word in the product brief, two different real
 * UI pieces, so they get two different block ids here to avoid conflating
 * them).
 *
 * Every mapping below is grounded in a real, checked data dependency in
 * `buildUniverseZones()` (shared/src/personal/index.ts) — nothing here is a
 * guess. Where an ingestion kind has no real effect on any tracked block
 * (e.g. `profile`, `asset`, `tech_watch`), it honestly maps to an empty
 * array instead of a speculative one.
 */

export const BLOCK_IDS = ['presence', 'focus', 'health', 'daily', 'life', 'finance', 'ventures', 'growth', 'opportunities', 'systems', 'channels', 'live-pulse'] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

/** Real ingestion kind → real affected blocks. Grounded in buildUniverseZones(). */
const INGEST_BLOCK_MAP: Record<string, BlockId[]> = {
  health_state: ['health', 'focus', 'presence'],
  // life_item feeds BOTH the `life` zone directly AND the `daily` zone's
  // overdue-item check (buildUniverseZones's `overdueLife`).
  life_item: ['life', 'daily', 'focus', 'presence'],
  finance_item: ['finance', 'focus', 'presence'],
  project: ['ventures', 'focus'],
  // risk feeds finRisks (finance zone) and next-action ranking (daily zone),
  // in addition to being surfaced from the ventures "report blocker" control.
  risk: ['finance', 'ventures', 'daily', 'focus'],
  learning_track: ['growth', 'focus'],
  goal: ['daily', 'growth', 'focus'],
  income_idea: ['finance', 'focus'],
  career_record: ['growth'],
  resume: ['growth'],
  // No real, checked effect on any tracked block — honestly empty rather
  // than a plausible-sounding guess.
  profile: [],
  system: [],
  asset: [],
  tech_watch: [],
};

export function blocksForIngestKind(kind: string): BlockId[] {
  return INGEST_BLOCK_MAP[kind] ?? [];
}

export function blocksForNextActionDecision(): BlockId[] {
  return ['daily', 'focus', 'presence'];
}

export function blocksForOpportunityDecision(): BlockId[] {
  return ['opportunities', 'focus'];
}

export function blocksForTaskCreated(): BlockId[] {
  return ['systems', 'focus', 'presence'];
}

export function blocksForApprovalDecision(): BlockId[] {
  return ['focus', 'presence', 'systems', 'live-pulse'];
}

/** Phase AF.4.1 — a goal being submitted always affects the live operation
 *  feed immediately (a new session starts), regardless of what the goal
 *  turns out to concern. */
export function blocksForSessionStarted(): BlockId[] {
  return ['live-pulse', 'focus'];
}

/** Maps a real backend SSE event `type` (see shared/src/constants EVENT_TYPES)
 *  to the blocks it should invalidate, for the cross-tab / background-
 *  completion path (see LiveEvents.tsx). Only event types this phase
 *  actually publishes are listed — never a speculative mapping for an event
 *  that doesn't exist. */
const EVENT_BLOCK_MAP: Record<string, BlockId[]> = {
  'reality.ingested': ['focus', 'presence', 'live-pulse'], // the ingest kind isn't in the SSE payload's type; conservative, real-but-partial invalidation. See DomainActionControl for the precise same-tab version.
  'next_action.decided': ['daily', 'focus', 'presence', 'live-pulse'],
  'opportunity.decided': ['opportunities', 'focus', 'live-pulse'],
  'operator.session.completed': ['systems', 'focus', 'presence', 'live-pulse'],
  'operator.approval.requested': ['focus', 'presence', 'live-pulse'],
  // Phase AF.4.1 — these three were previously unmapped: 'operator.session.started'
  // and 'operator.approval.decided' are new/newly-instrumented events, and
  // 'operator.tool.failed' existed but had no block consequence wired up.
  // All three feed the live operation feed ('live-pulse') only — they don't
  // change any Domain Canvas zone's data, just the operations narrative.
  'operator.session.started': ['live-pulse'],
  'operator.approval.decided': ['live-pulse', 'focus'],
  'operator.tool.failed': ['live-pulse'],
  'task.completed': ['systems', 'focus', 'live-pulse'],
  'task.created': ['systems', 'focus', 'live-pulse'],
  'task.failed': ['systems', 'focus', 'live-pulse'],
  'approval.requested': ['live-pulse'],
  'approval.decided': ['live-pulse'],
};

export function blocksForEventType(type: string): BlockId[] {
  return EVENT_BLOCK_MAP[type] ?? [];
}
