'use client';
import { useEffect, useRef, useState } from 'react';

interface FeedItem {
  type: string;
  source?: string;
  at: string;
}

/** Subscribes to the same-origin SSE proxy and renders a live event feed. */
export function LiveEvents() {
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
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
    ];
    for (const t of types) {
      es.addEventListener(t, (e) => push((e as MessageEvent).data, t));
    }
    return () => es.close();

    function push(raw: string, fallbackType: string) {
      try {
        const obj = JSON.parse(raw);
        setItems((prev) =>
          [{ type: obj.type ?? fallbackType, source: obj.source, at: obj.createdAt ?? new Date().toISOString() }, ...prev].slice(0, 40),
        );
      } catch {
        /* ignore heartbeats */
      }
    }
  }, []);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">Live activity</span>
        <span className="live">
          <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'connected' : 'offline'}
        </span>
      </div>
      <div className="feed">
        {items.length === 0 ? (
          <div className="empty">Waiting for events…</div>
        ) : (
          items.map((it, i) => (
            <div key={i}>
              <span className="t">{it.type}</span> <span className="m">· {it.source ?? 'system'}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
