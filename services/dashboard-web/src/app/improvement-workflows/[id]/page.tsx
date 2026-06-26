import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function WorkflowDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = (await gateway.improvementWorkflow(id)) as { workflow: Record<string, unknown>; impact: Record<string, unknown> | null; evidence: Array<Record<string, unknown>> } | null;
  if (!res?.workflow) return (<><h1 className="h1">Workflow</h1><div className="card"><div className="empty">Not found.</div></div></>);
  const w = res.workflow;
  const steps = Array.isArray(w.steps) ? (w.steps as Array<{ name: string; engine: string; status: string; detail: string }>) : [];
  const before = (w.beforeMetrics ?? {}) as Record<string, number>;
  const after = (w.afterMetrics ?? {}) as Record<string, number>;
  return (
    <>
      <h1 className="h1">{String(w.title)}</h1>
      <p className="sub"><span className="badge">{String(w.type)}</span> · <span className={`badge ${w.status === 'completed' ? 'ok' : 'warn'}`}>{String(w.status)}</span> · result: {String(w.result || '—')}</p>
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Steps</div>
          <table><tbody>
            {steps.map((s, i) => (<tr key={i}><td>{s.name}</td><td className="m">{s.engine}</td><td><span className={`badge ${s.status === 'done' ? 'ok' : s.status === 'skipped' ? 'warn' : ''}`}>{s.status}</span></td><td className="m">{s.detail}</td></tr>))}
          </tbody></table>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Impact</div>
          {!res.impact ? <div className="empty">No impact assessment.</div> : (
            <>
              <p style={{ marginTop: 0 }}><b>{String(res.impact.impact)}</b> · confidence {Number(res.impact.confidence ?? 0).toFixed(2)}</p>
              <table><tbody>
                <tr><td className="m">Metric</td><td className="m">before</td><td className="m">after</td></tr>
                {Object.keys({ ...before, ...after }).map((k) => (<tr key={k}><td>{k}</td><td>{Number(before[k] ?? 0).toFixed(3)}</td><td>{Number(after[k] ?? 0).toFixed(3)}</td></tr>))}
              </tbody></table>
              <p className="sub" style={{ marginTop: 8 }}>{String(res.impact.recommendation ?? '')}</p>
            </>
          )}
          <div className="label" style={{ marginTop: 14, marginBottom: 6 }}>Evidence ({res.evidence.length})</div>
          <div className="feed">{res.evidence.map((e, i) => (<div key={i}><span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)}</span></div>))}</div>
        </div>
      </div>
    </>
  );
}
