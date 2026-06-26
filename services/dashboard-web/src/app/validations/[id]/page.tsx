import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function ValidationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = (await gateway.validation(id)) as { validation: Record<string, unknown>; evidence: Array<Record<string, unknown>> } | null;
  if (!res?.validation) return (<><h1 className="h1">Validation</h1><div className="card"><div className="empty">Not found.</div></div></>);
  const v = res.validation;
  const checks = Array.isArray(v.checks) ? (v.checks as Array<{ name: string; passed: boolean; detail?: string }>) : [];
  return (
    <>
      <h1 className="h1">Validation · {String(v.serviceName)}</h1>
      <p className="sub">{String(v.capabilityId)} · <span className={`badge ${v.passed ? 'ok' : 'err'}`}>{v.passed ? 'passed' : 'failed'}</span> · score {Number(v.score ?? 0).toFixed(2)}</p>
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Checks</div>
          <table><tbody>
            {checks.map((c, i) => (
              <tr key={i}><td>{c.name}</td><td><span className={`badge ${c.passed ? 'ok' : 'err'}`}>{c.passed ? 'ok' : 'fail'}</span></td><td className="m">{c.detail}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Evidence</div>
          {res.evidence.length === 0 ? <div className="empty">No evidence.</div> : (
            <div className="feed">
              {res.evidence.map((e, i) => (<div key={i}><span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)}</span></div>))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
