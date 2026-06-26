import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'completed' ? 'ok' : s === 'failed' || s === 'cancelled' ? 'err' : 'warn');

export default async function RepairTasksPage() {
  const rows = (await gateway.repairTasks()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Repair Tasks</h1>
      <p className="sub">Proposed fixes for incidents. Sensitive repairs require approval.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No repair tasks.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Diagnosis</th><th>Action</th><th>Status</th><th>Attempts</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><Link href={`/repair-tasks/${String(r.repairTaskId)}`}>{String(r.serviceName)}</Link></td>
                  <td className="m">{String(r.diagnosis)}</td>
                  <td className="m">{String(r.recommendedAction)}</td>
                  <td><span className={`badge ${badgeFor(String(r.status))}`}>{String(r.status)}</span></td>
                  <td>{String(r.attempts ?? 0)}</td>
                  <td className="m">{timeAgo(String(r.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
