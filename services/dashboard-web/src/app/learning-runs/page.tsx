import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function LearningRunsPage() {
  const rows = (await gateway.learningRuns()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Learning Runs</h1>
      <p className="sub">Each historical-aggregation pass over the system's records.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No learning runs yet.</div>
        ) : (
          <table>
            <thead><tr><th>Records</th><th>Success patterns</th><th>Failure/weak</th><th>Weak services</th><th>Recommendations</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{String(r.recordsAnalyzed)}</td>
                  <td className="m">{Array.isArray(r.topSuccessPatterns) ? (r.topSuccessPatterns as string[]).join('; ') : '—'}</td>
                  <td className="m">{Array.isArray(r.topFailurePatterns) ? (r.topFailurePatterns as string[]).join('; ') : '—'}</td>
                  <td className="m">{Array.isArray(r.weakServices) ? (r.weakServices as string[]).join(', ') || '—' : '—'}</td>
                  <td>{Array.isArray(r.recommendationIds) ? (r.recommendationIds as string[]).length : 0}</td>
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
