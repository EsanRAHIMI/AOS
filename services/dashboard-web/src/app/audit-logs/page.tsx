import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function AuditLogsPage() {
  const rows = (await gateway.auditLogs()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Audit Logs</h1>
      <p className="sub">Every governance action is recorded — who did what, to what, and why.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No audit entries yet.</div>
        ) : (
          <table>
            <thead><tr><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Reason</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={i}>
                  <td className="m">{String(a.actorType)}:{String(a.actorId)}</td>
                  <td className="m">{String(a.role ?? '—')}</td>
                  <td><span className="badge">{String(a.action)}</span></td>
                  <td className="m">{String(a.targetType)}/{String(a.targetId)}</td>
                  <td className="m">{String(a.reason ?? '')}</td>
                  <td className="m">{timeAgo(String(a.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
