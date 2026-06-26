import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function ActivationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = (await gateway.activation(id)) as { activation: Record<string, unknown>; evidence: Array<Record<string, unknown>> } | null;
  if (!res?.activation) return (<><h1 className="h1">Activation</h1><div className="card"><div className="empty">Not found.</div></div></>);
  const a = res.activation;
  const checks = Array.isArray(a.checks) ? (a.checks as Array<{ name: string; passed: boolean; detail?: string }>) : [];
  return (
    <>
      <h1 className="h1">Activation · {String(a.serviceName)}</h1>
      <p className="sub">{String(a.domain)} · <span className={`badge ${a.passed ? 'ok' : 'err'}`}>{a.passed ? 'passed' : 'failed'}</span>{a.promotedToActive ? ' · promoted to active' : ''}</p>
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Live checks</div>
          <table><tbody>
            {checks.map((c, i) => (<tr key={i}><td>{c.name}</td><td><span className={`badge ${c.passed ? 'ok' : 'err'}`}>{c.passed ? 'ok' : 'fail'}</span></td><td className="m">{c.detail}</td></tr>))}
          </tbody></table>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Evidence</div>
          {res.evidence.length === 0 ? <div className="empty">No evidence.</div> : (
            <div className="feed">{res.evidence.map((e, i) => (<div key={i}><span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)}</span></div>))}</div>
          )}
        </div>
      </div>
    </>
  );
}
