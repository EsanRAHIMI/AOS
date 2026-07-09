/**
 * Phase AF.4.1 — pure dedupe-key logic for the live operation feed, shared
 * by `LiveEvents` (SSE-driven) and the initial live-state snapshot seeded
 * from `GET /v1/operator/live-state`, so the same real event arriving both
 * ways (server snapshot on load, then again over SSE moments later) never
 * renders twice. Kept dependency-free so it's directly unit-testable.
 */
export interface DedupableEvent {
  type: string;
  createdAt: string;
  runtimeSessionId?: string | null;
  taskId?: string | null;
  permissionId?: string | null;
}

/** Stable identity for an event: same type + same real entity id(s) + same
 *  timestamp is the same event, regardless of which path delivered it. */
export function eventDedupeKey(e: DedupableEvent): string {
  return [e.type, e.runtimeSessionId ?? '', e.taskId ?? '', e.permissionId ?? '', e.createdAt].join('|');
}

/** Merge a new batch of events into an existing ordered (newest-first) list,
 *  skipping anything whose dedupe key already appears, and re-sorting by
 *  `createdAt` descending so out-of-order arrival (snapshot vs. live SSE)
 *  still renders chronologically. Caps the result at `limit`. */
export function mergeDedupedEvents<T extends DedupableEvent>(existing: T[], incoming: T[], limit = 40): T[] {
  const seen = new Set(existing.map(eventDedupeKey));
  const merged = [...existing];
  for (const e of incoming) {
    const key = eventDedupeKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return merged.slice(0, limit);
}
