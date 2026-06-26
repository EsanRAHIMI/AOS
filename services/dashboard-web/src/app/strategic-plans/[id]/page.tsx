import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = (await gateway.strategicPlan(id)) as { plan: Record<string, unknown>; score: Record<string, unknown> | null } | null;
  if (!res?.plan) return (<><h1 className="h1">Plan</h1><div className="card"><div className="empty">Not found.</div></div></>);
  const p = res.plan;
  const dims: Record<string, number> = res.score && typeof res.score.dimensions === 'object' ? (res.score.dimensions as Record<string, number>) : ({} as Record<string, number>);
  const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]) : []);
  return (
    <>
      <h1 className="h1">{String(p.title)}</h1>
      <p className="sub"><span className="badge">{String(p.label)}</span> · {String(p.riskLevel)} risk · confidence {Number(p.confidence ?? 0).toFixed(2)} {p.selected ? '· ✓ selected' : ''}</p>
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Steps</div>
          <ol className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>{arr('steps').map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="sub">Impact: {String(p.expectedImpact)}</div>
          <div className="sub">Approvals: {arr('requiredApprovals').join(', ') || 'none'} · Reversibility: {Number(p.reversibility ?? 0).toFixed(2)} · ~{String(p.expectedTimeMinutes)}m · ${Number(p.expectedCostUsd ?? 0).toFixed(3)}</div>
          <div className="sub">Failure modes: {arr('failureModes').join('; ') || '—'}</div>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Score · total {res.score ? Number(res.score.total).toFixed(3) : '—'}</div>
          <table><tbody>
            {Object.entries(dims).map(([k, v]) => (<tr key={k}><td className="m">{k}</td><td>{Number(v).toFixed(2)}</td></tr>))}
          </tbody></table>
          {res.score?.selectionReason ? <p className="sub" style={{ marginTop: 10 }}>{String(res.score.selectionReason)}</p> : null}
        </div>
      </div>
    </>
  );
}
