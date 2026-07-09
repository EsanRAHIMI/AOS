'use client';
import { useEffect, useRef, useState } from 'react';
import { blocksForEventType } from '@/lib/realtimeBlocks';
import { mergeDedupedEvents } from '@/lib/eventDedupe';
import { buildOperationFeed, type FeedEventInput, type OperationFeedItem } from '@/lib/operationFeed';
import { invalidateBlocks, useUniverse } from './UniverseProvider';
import { summonJarvis } from './UniverseZone';
import { RelativeTime } from './RelativeTime';

/**
 * Phase AF.4.3 — "Live Activity" rebuilt as a grouped operation feed.
 *
 * Root cause of the reported noise: this component used to render the raw
 * `events` collection one row per event, appended forever, with no upper
 * bound and no relationship between rows that belonged to the same real
 * operation — a single Jarvis goal produced 4-5 separate lines (session
 * started, approval requested, tool failed, session completed, ...) that
 * never updated in place. That's fixed here by grouping everything by its
 * real, stable identity (`runtimeSessionId` for a Jarvis operation,
 * `taskId` for a kernel task — see `lib/operationFeed.ts`) into ONE card
 * per operation that gets patched, never duplicated.
 *
 * Data sources, combined:
 *  - `useUniverse().liveState` — the real, persisted snapshot (sessions,
 *    pending approvals, recent tasks, recent events), refreshed whenever
 *    any operator lifecycle event fires (the existing 'live-pulse' block
 *    invalidation from AF.4/AF.4.1 — unchanged).
 *  - This component's own SSE connection (unchanged: still the app's ONE
 *    EventSource) — new events are merged into a small local buffer for
 *    instant feedback, ahead of the next `liveState` refetch landing.
 *    `mergeDedupedEvents` means an event seen both ways only counts once.
 *
 * Timestamps use `<RelativeTime>` (not inline `Date.now()`), so this
 * component — itself `'use client'`, fed server-seeded `liveState` on first
 * paint — doesn't reintroduce the exact hydration mismatch AF.4.1 fixed in
 * `PresenceBar`.
 */
export function LiveEvents() {
  const { liveState } = useUniverse();
  const [connected, setConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState<FeedEventInput[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    ref.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => push(e.data, 'message');
    // Named factory events all arrive with their type as the SSE event name.
    const types = [
      'task.created', 'task.updated', 'task.completed', 'task.failed',
      'agent.run.started', 'agent.run.finished', 'approval.requested',
      'approval.decided', 'service.registered', 'doc.updated',
      'reality.ingested', 'next_action.decided', 'opportunity.decided',
      'operator.session.completed', 'operator.approval.requested',
      'operator.session.started', 'operator.approval.decided', 'operator.tool.failed',
    ];
    for (const t of types) {
      es.addEventListener(t, (e) => push((e as MessageEvent).data, t));
    }
    return () => es.close();

    function push(raw: string, fallbackType: string) {
      try {
        const obj = JSON.parse(raw);
        const type = obj.type ?? fallbackType;
        const payload = (obj.payload ?? {}) as Record<string, unknown>;
        const incoming: FeedEventInput = {
          type, source: obj.source, message: typeof payload.message === 'string' ? payload.message : '',
          createdAt: obj.createdAt ?? new Date().toISOString(),
          runtimeSessionId: payload.runtimeSessionId ? String(payload.runtimeSessionId) : null,
          taskId: obj.taskId ? String(obj.taskId) : null,
          permissionId: payload.permissionId ? String(payload.permissionId) : null,
        };
        setLiveEvents((prev) => mergeDedupedEvents(prev, [incoming], 60));
        const blocks = blocksForEventType(type);
        if (blocks.length > 0) invalidateBlocks(blocks);
      } catch {
        /* ignore heartbeats */
      }
    }
  }, []);

  const events = mergeDedupedEvents<FeedEventInput>(liveState?.recentEvents.map((e) => ({ ...e, source: undefined })) ?? [], liveEvents, 60);
  const sessions = [...(liveState?.activeSessions ?? []), ...(liveState?.recentSessions ?? [])].map((s) => ({
    runtimeSessionId: s.runtimeSessionId, goal: s.goal, status: s.status, nextAction: s.nextAction,
    reportSummary: s.reportSummary, composedReply: s.composedReply, startedAt: s.startedAt, completedAt: s.completedAt,
  }));
  const items = buildOperationFeed({ sessions, approvals: liveState?.pendingApprovals ?? [], tasks: liveState?.recentTasks ?? [], events }, 30);

  const toneColor = (tone: OperationFeedItem['statusTone']): string => (
    tone === 'ok' ? 'var(--ok)' : tone === 'err' ? 'var(--err)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  );
  const toggle = (key: string): void => setExpanded((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">Live activity</span>
        <span className="live">
          <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'connected' : 'offline'}
        </span>
      </div>
      {/* Fixed-height, internally scrollable — the raw event dump used to
          grow the page vertically without bound. One card per operation
          means this rarely needs to scroll in practice, but the cap stays
          honest for a genuinely busy day. */}
      <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
        {items.length === 0 ? (
          <div className="empty">Waiting for events…</div>
        ) : (
          items.map((it) => {
            const isOpen = expanded.has(it.key);
            return (
              <div key={it.key} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                      <span className="m" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{it.kind}</span>
                    </div>
                    {it.latestMessage && it.latestMessage !== it.title && (
                      <div className="m" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.latestMessage}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                    <span className="badge" style={{ fontSize: 9.5, color: toneColor(it.statusTone), borderColor: toneColor(it.statusTone) }}>{it.status}</span>
                    <span className="m" style={{ fontSize: 9.5 }}><RelativeTime iso={it.updatedAt} /></span>
                  </div>
                </div>
                {(it.meta || it.href || it.kind === 'session' || it.history.length > 0) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5, alignItems: 'center' }}>
                    {it.meta && <span className="chip" style={{ fontSize: 9.5 }}>{it.meta}</span>}
                    {it.href && <a href={it.href} className="chip" style={{ fontSize: 9.5, textDecoration: 'none' }}>Open →</a>}
                    {it.kind === 'session' && <button type="button" className="chip" style={{ fontSize: 9.5, cursor: 'pointer' }} onClick={() => summonJarvis('')}>Open Jarvis</button>}
                    {it.history.length > 0 && (
                      <button type="button" className="chip" style={{ fontSize: 9.5, cursor: 'pointer' }} onClick={() => toggle(it.key)}>{isOpen ? 'Hide detail' : `${it.history.length} more`}</button>
                    )}
                  </div>
                )}
                {isOpen && it.history.length > 0 && (
                  <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {it.history.map((h, i) => <div key={i} className="m" style={{ fontSize: 10.5 }}>{h}</div>)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
