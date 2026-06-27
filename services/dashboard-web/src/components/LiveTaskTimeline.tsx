'use client';
import { useEffect, useState } from 'react';

export interface TimelineRow { type: string; message: string; source: string; at: string; level?: string }

export function LiveTaskTimeline({ taskId, initial }: { taskId: string; initial: TimelineRow[] }) {
  const [rows, setRows] = useState<TimelineRow[]>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const handle = (raw: string) => {
      try {
        const o = JSON.parse(raw);
        if (o.taskId !== taskId) return;
        setRows((prev) => [
          ...prev,
          { type: o.type, message: o.payload?.message ?? o.type, source: o.source ?? o.payload?.service ?? 'system', at: o.createdAt ?? new Date().toISOString(), level: o.payload?.level },
        ]);
      } catch { /* heartbeat */ }
    };
    es.onmessage = (e) => handle(e.data);
    const types = ['task.created','task.updated','task.completed','task.failed','agent.run.started','agent.run.finished','approval.requested','approval.decided','infra.request.created','infra.request.fulfilled','doc.updated','memory.written'];
    for (const t of types) es.addEventListener(t, (e) => handle((e as MessageEvent).data));
    return () => es.close();
  }, [taskId]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">Live timeline</span>
        <span className="live"><span className={`dot ${live ? 'on' : ''}`} /> {live ? 'live' : 'offline'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Waiting for the orchestrator…</div>
      ) : (
        <div className="timeline">
          {rows.map((r, i) => {
            const tone = r.level === 'warn' ? 'warn' : /fail|error/.test(r.type) ? 'err' : /complete|finish|fulfill/.test(r.type) ? 'ok' : '';
            return (
              <div className={`ti ${tone}`} key={i}>
                <div className="m" style={{ fontSize: 11.5 }}>{new Date(r.at).toLocaleTimeString()} · {r.source}</div>
                <div style={{ fontSize: 13 }}>{r.message}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
