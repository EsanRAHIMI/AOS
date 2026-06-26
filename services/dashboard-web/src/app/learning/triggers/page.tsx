import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function TriggersPage() {
  const rows = (await gateway.learningTriggers()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Learning Triggers</h1>
      <p className="sub">Fired triggers that requested a learning run.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No triggers yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Reason</th><th>Task</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={i}>
                  <td><span className="badge">{String(t.type)}</span></td>
                  <td className="m">{String(t.reason)}</td>
                  <td className="m">{t.dispatchedTaskId ? <Link href={`/tasks/${String(t.dispatchedTaskId)}`}>{String(t.dispatchedTaskId)}</Link> : '—'}</td>
                  <td className="m">{timeAgo(String(t.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
