'use client';

/**
 * OwnerPulse (CIN-2, D-180) — the living presence widget. Keeps ONE
 * EventSource open to /api/owner-stream and shows: Jarvis presence (last
 * heartbeat), plus proactive events arriving live, with ack/dismiss.
 * This is the first visible piece of "Jarvis acts between conversations".
 */
import { useEffect, useRef, useState } from 'react';

interface ProactiveEvent {
  eventId: string;
  kind: string;
  priority: 'info' | 'attention' | 'critical';
  title: string;
  detail: string;
  createdAt: string;
  status: string;
}

interface Presence {
  at: string;
  lastHeartbeatAt: string | null;
  openEvents: number;
}

export function OwnerPulse() {
  const [presence, setPresence] = useState<Presence | null>(null);
  const [events, setEvents] = useState<ProactiveEvent[]>([]);
  const [live, setLive] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let stopped = false;
    let retryMs = 2000;

    const connect = () => {
      if (stopped) return;
      const es = new EventSource('/api/owner-stream');
      sourceRef.current = es;
      es.addEventListener('presence', (e) => {
        setLive(true);
        retryMs = 2000;
        try { setPresence(JSON.parse((e as MessageEvent).data) as Presence); } catch { /* ignore */ }
      });
      es.addEventListener('proactive', (e) => {
        try {
          const ev = JSON.parse((e as MessageEvent).data) as ProactiveEvent;
          setEvents((prev) => (prev.some((p) => p.eventId === ev.eventId) ? prev : [ev, ...prev].slice(0, 12)));
        } catch { /* ignore */ }
      });
      es.addEventListener('ping', () => setLive(true));
      es.onerror = () => {
        es.close();
        setLive(false);
        if (!stopped) setTimeout(connect, retryMs = Math.min(retryMs * 2, 30000));
      };
    };
    connect();
    return () => { stopped = true; sourceRef.current?.close(); };
  }, []);

  const act = async (eventId: string, status: 'acked' | 'dismissed') => {
    setEvents((prev) => prev.filter((e) => e.eventId !== eventId));
    try {
      await fetch('/api/proactive-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, status }) });
    } catch { /* optimistic — the heartbeat re-surfaces it if the ack failed */ }
  };

  return (
    <div className="card">
      <h2>
        Jarvis pulse{' '}
        <span className="badge">{live ? 'LIVE' : 'reconnecting…'}</span>
      </h2>
      <p className="m">
        {presence?.lastHeartbeatAt
          ? `last heartbeat ${new Date(presence.lastHeartbeatAt).toLocaleTimeString()}`
          : 'no heartbeat yet — the pulse runs every few minutes'}
      </p>
      {events.length === 0 ? (
        <div className="empty">Nothing needs your attention right now.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.map((e) => (
            <li key={e.eventId} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 0' }}>
              <span className="badge">{e.priority === 'critical' ? '⛔' : e.priority === 'attention' ? '⚠' : 'ℹ'} {e.kind}</span>
              <span style={{ flex: 1 }}>{e.title}{e.detail ? <span className="m"> — {e.detail}</span> : null}</span>
              <button className="btn" onClick={() => act(e.eventId, 'acked')}>ack</button>
              <button className="btn" onClick={() => act(e.eventId, 'dismissed')}>dismiss</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
