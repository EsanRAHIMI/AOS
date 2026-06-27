import { gateway } from '@/lib/gateway';
import { confirmChecklistAction, runActivationAction } from '@/app/actions';
import { PageHeader, EmptyState } from '@/components/ui';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'activated' ? 'ok' : s === 'failed' ? 'err' : s === 'deployed' ? 'warn' : '');

export default async function ChecklistsPage() {
  const rows = (await gateway.checklists()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Deployment Checklists" subtitle="Create the Dokploy app from a checklist, confirm it, then run the live activation check." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="⬡" title="No checklists yet" hint='Run "Activate <service> on production" to generate one.' /></div>
      ) : (
        list.map((c, i) => {
          const id = String(c.checklistId);
          const env = Array.isArray(c.env) ? (c.env as Array<{ key: string; value: string; secret: boolean }>) : [];
          const notes = Array.isArray(c.notes) ? (c.notes as string[]) : [];
          const status = String(c.status);
          return (
            <div className="card" key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div><b>{String(c.appName)}</b> <span className={`badge ${badgeFor(status)}`}>{status}</span></div>
                <div className="m" style={{ fontSize: 12.5 }}>{String(c.subdomain)} · port {String(c.port)}</div>
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: '12px 0 0', fontSize: 13 }}>
                <dt className="m">Root dir</dt><dd className="feed" style={{ margin: 0 }}>{String(c.rootDirectory)}</dd>
                <dt className="m">Build</dt><dd className="feed" style={{ margin: 0 }}>{String(c.buildCommand)}</dd>
                <dt className="m">Start</dt><dd className="feed" style={{ margin: 0 }}>{String(c.startCommand)}</dd>
                <dt className="m">Health</dt><dd className="feed" style={{ margin: 0 }}>{String(c.healthCheckPath)}</dd>
              </dl>
              <div className="label" style={{ marginTop: 12, marginBottom: 6 }}>Environment (copyable)</div>
              <pre className="feed" style={{ background: 'var(--panel-2)', padding: 10, borderRadius: 8, overflowX: 'auto', margin: 0 }}>
{env.map((e) => `${e.key}=${e.secret ? '<secret>' : e.value}`).join('\n')}
              </pre>
              {notes.length > 0 && <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>{notes.join(' ')}</p>}
              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <form action={confirmChecklistAction}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn btn-ok" type="submit">I created this in Dokploy</button>
                </form>
                <form action={runActivationAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 240 }}>
                  <input type="hidden" name="id" value={id} />
                  <input name="baseUrl" placeholder="override base URL (optional)" style={{ flex: 1, minWidth: 180, fontSize: 13 }} />
                  <button className="btn btn-ok" type="submit">Run activation check</button>
                </form>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
