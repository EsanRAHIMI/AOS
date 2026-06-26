import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const LIFECYCLE = ['proposed', 'approved', 'generated', 'validated', 'active'];

export default async function CapabilityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, evidence] = await Promise.all([
    gateway.capability(id) as Promise<Record<string, unknown> | null>,
    gateway.evidence(`?capabilityId=${id}`) as Promise<Array<Record<string, unknown>> | null>,
  ]);
  if (!c) return (<><h1 className="h1">Capability</h1><div className="card"><div className="empty">Not found.</div></div></>);
  const arr = (k: string) => (Array.isArray(c[k]) ? (c[k] as string[]) : []);
  const status = String(c.status);
  const idx = LIFECYCLE.indexOf(status);

  return (
    <>
      <h1 className="h1">{String(c.title)}</h1>
      <p className="sub">{String(c.capabilityId)} · maturity {String(c.maturityLevel)} · score {Number(c.evaluationScore ?? 0).toFixed(2)}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Lifecycle</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LIFECYCLE.map((s, i) => (
            <span key={s} className={`badge ${i <= idx && idx >= 0 ? 'ok' : ''}`} style={{ opacity: i <= idx && idx >= 0 ? 1 : 0.5 }}>
              {i <= idx && idx >= 0 ? '✓ ' : ''}{s}
            </span>
          ))}
          {status === 'failed' && <span className="badge err">failed</span>}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <p style={{ marginTop: 0 }}>{String(c.description)}</p>
          <table><tbody>
            <tr><td className="m" style={{ width: 180 }}>Category</td><td>{String(c.category)}</td></tr>
            <tr><td className="m">Risk</td><td>{String(c.riskLevel)}</td></tr>
            <tr><td className="m">Services</td><td>{arr('supportedByServices').join(', ') || '—'}</td></tr>
            <tr><td className="m">Tools</td><td>{arr('supportedByTools').join(', ') || '—'}</td></tr>
            <tr><td className="m">Permissions</td><td>{arr('requiredPermissions').join(', ') || '—'}</td></tr>
          </tbody></table>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Evidence ({(evidence ?? []).length})</div>
          {!evidence || evidence.length === 0 ? <div className="empty">No evidence yet.</div> : (
            <div className="feed">
              {evidence.map((e, i) => (<div key={i}><span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)} · {timeAgo(String(e.createdAt))}</span></div>))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
