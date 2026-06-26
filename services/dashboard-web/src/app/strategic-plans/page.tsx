import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const labelBadge = (l: string) => (l === 'safe_plan' ? 'ok' : l === 'ambitious_plan' ? 'err' : 'warn');

export default async function StrategicPlansPage() {
  const rows = (await gateway.strategicPlans()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Strategic Plans</h1>
      <p className="sub">Candidate plans the planner generated. The selected one is marked.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No strategic plans yet.</div>
        ) : (
          <table>
            <thead><tr><th>Plan</th><th>Label</th><th>Risk</th><th>Confidence</th><th>Approvals</th><th>Selected</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td><Link href={`/strategic-plans/${String(p.planId)}`}>{String(p.title)}</Link></td>
                  <td><span className={`badge ${labelBadge(String(p.label))}`}>{String(p.label)}</span></td>
                  <td className="m">{String(p.riskLevel)}</td>
                  <td>{Number(p.confidence ?? 0).toFixed(2)}</td>
                  <td className="m">{Array.isArray(p.requiredApprovals) ? (p.requiredApprovals as string[]).join(', ') || '—' : '—'}</td>
                  <td>{p.selected ? <span className="badge ok">selected</span> : '—'}</td>
                  <td className="m">{timeAgo(String(p.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
