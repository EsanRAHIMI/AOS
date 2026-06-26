import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badgeFor = (d: string) => (d === 'allowed' ? 'ok' : d === 'blocked' ? 'err' : 'warn');

export default async function PolicyDecisionsPage() {
  const rows = (await gateway.policyDecisions()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Policy Decisions</h1>
      <p className="sub">Every sensitive action is checked against policy before it can run.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No policy decisions yet.</div>
        ) : (
          <table>
            <thead><tr><th>Action</th><th>Decision</th><th>Risk</th><th>Approval type</th><th>Reason</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={i}>
                  <td className="m">{String(d.action)}</td>
                  <td><span className={`badge ${badgeFor(String(d.decision))}`}>{String(d.decision)}</span></td>
                  <td className="m">{String(d.riskLevel)}</td>
                  <td className="m">{String(d.requiredApprovalType ?? '—')}</td>
                  <td className="m">{String(d.reason)}</td>
                  <td className="m">{timeAgo(String(d.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
