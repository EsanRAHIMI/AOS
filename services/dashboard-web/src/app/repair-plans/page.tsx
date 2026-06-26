import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'executed' || s === 'approved' ? 'ok' : s === 'rejected' || s === 'failed' ? 'err' : 'warn');

export default async function RepairPlansPage() {
  const rows = (await gateway.repairPlans()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Repair Plans</h1>
      <p className="sub">Structured, approval-gated repair plans. Approve one from its incident page.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No repair plans yet.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Plan type</th><th>Steps</th><th>Approvals</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td>{String(p.serviceName)}</td>
                  <td><span className="badge">{String(p.planType)}</span></td>
                  <td className="m">{Array.isArray(p.steps) ? (p.steps as string[]).length : 0}</td>
                  <td className="m">{Array.isArray(p.requiredApprovals) ? (p.requiredApprovals as string[]).join(', ') || '—' : '—'}</td>
                  <td><span className={`badge ${badgeFor(String(p.status))}`}>{String(p.status)}</span></td>
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
