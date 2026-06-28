import { createTaskAction } from '@/app/actions';
import type { ActionTemplate } from '@/lib/templates';

/** Renders a real action template. The form posts the real prompt to the
 *  RBAC-gated createTaskAction, which creates a real task (no demo mode). */
export function TemplateCard({ t }: { t: ActionTemplate }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <b style={{ fontSize: 14.5, lineHeight: 1.3 }}>{t.title}</b>
        <span className={`badge ${t.risk === 'high' ? 'err' : t.risk === 'medium' ? 'warn' : 'ok'}`}>{t.risk} risk</span>
      </div>
      <div className="m" style={{ fontSize: 13, marginBottom: 10 }}>{t.what}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {t.approval && <span className="badge warn">needs approval</span>}
        <span className="chip">results → {t.resultsAt}</span>
        {t.outputs.slice(0, 3).map((o) => <span key={o} className="chip">{o}</span>)}
      </div>
      <details style={{ marginBottom: 10 }}>
        <summary className="m" style={{ fontSize: 12.5, cursor: 'pointer' }}>Prompt &amp; services</summary>
        <div className="feed" style={{ fontSize: 12, marginTop: 6 }}>{t.prompt}</div>
        <div className="m" style={{ fontSize: 12, marginTop: 6 }}>Services: {t.services.join(', ')}</div>
      </details>
      <form action={createTaskAction}>
        <input type="hidden" name="goal" value={t.prompt} />
        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Run this task</button>
      </form>
    </div>
  );
}
