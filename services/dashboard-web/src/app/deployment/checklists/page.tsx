import { gateway } from '@/lib/gateway';
import { confirmChecklistAction, runActivationAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'activated' ? 'ok' : s === 'failed' ? 'err' : s === 'deployed' ? 'warn' : '');

export default async function ChecklistsPage() {
  const rows = (await gateway.checklists()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Deployment Checklists</h1>
      <p className="sub">Create the Dokploy app from a checklist, confirm it, then run the live activation check.</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No checklists yet. Run "Activate &lt;service&gt; on production".</div></div>
      ) : (
        rows.map((c, i) => {
          const id = String(c.checklistId);
          const env = Array.isArray(c.env) ? (c.env as Array<{ key: string; value: string; secret: boolean }>) : [];
          const notes = Array.isArray(c.notes) ? (c.notes as string[]) : [];
          const status = String(c.status);
          return (
            <div className="card" key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><b>{String(c.appName)}</b> <span className={`badge ${badgeFor(status)}`}>{status}</span></div>
                <div className="m">{String(c.subdomain)} · port {String(c.port)}</div>
              </div>
              <table style={{ marginTop: 10 }}><tbody>
                <tr><td className="m" style={{ width: 150 }}>Root dir</td><td className="feed">{String(c.rootDirectory)}</td></tr>
                <tr><td className="m">Build</td><td className="feed">{String(c.buildCommand)}</td></tr>
                <tr><td className="m">Start</td><td className="feed">{String(c.startCommand)}</td></tr>
                <tr><td className="m">Health</td><td className="feed">{String(c.healthCheckPath)}</td></tr>
              </tbody></table>
              <div className="label" style={{ marginTop: 12, marginBottom: 6 }}>Environment (copyable)</div>
              <pre className="feed" style={{ background: 'var(--panel-2)', padding: 10, borderRadius: 8, overflowX: 'auto', margin: 0 }}>
{env.map((e) => `${e.key}=${e.secret ? '<secret>' : e.value}`).join('\n')}
              </pre>
              {notes.length > 0 && <p className="sub" style={{ marginTop: 10 }}>{notes.join(' ')}</p>}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <form action={confirmChecklistAction}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn-ok" type="submit">I created this in Dokploy</button>
                </form>
                <form action={runActivationAction} style={{ display: 'flex', gap: 8 }}>
                  <input type="hidden" name="id" value={id} />
                  <input name="baseUrl" placeholder="override base URL (optional)" style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12, width: 240 }} />
                  <button className="btn-ok" type="submit">Run activation check</button>
                </form>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
