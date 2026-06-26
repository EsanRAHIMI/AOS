import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function MemoryMaintenancePage() {
  const rows = (await gateway.memoryMaintenance()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Memory Maintenance</h1>
      <p className="sub">Continuous compression: superseded summaries are deprecated; the latest per scope is kept.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No maintenance runs yet.</div>
        ) : (
          <table>
            <thead><tr><th>Reviewed</th><th>Updated</th><th>Deprecated</th><th>Contexts</th><th>Tokens saved</th><th>Notes</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={i}>
                  <td>{String(m.summariesReviewed)}</td>
                  <td>{String(m.summariesUpdated)}</td>
                  <td>{String(m.summariesDeprecated)}</td>
                  <td>{String(m.compressedContextsUpdated)}</td>
                  <td className="m">~{String(m.tokenBudgetSaved)}</td>
                  <td className="m">{Array.isArray(m.notes) ? (m.notes as string[]).join(' ') : ''}</td>
                  <td className="m">{timeAgo(String(m.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
