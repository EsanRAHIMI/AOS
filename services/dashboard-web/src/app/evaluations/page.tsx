import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function EvaluationsPage() {
  const rows = (await gateway.evaluations()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Evaluations</h1>
      <p className="sub">Multi-dimensional scores so the system never hallucinates progress.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No evaluations yet.</div>
        ) : (
          <table>
            <thead><tr><th>Target</th><th>Type</th><th>Score</th><th>Strengths</th><th>Weaknesses</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((e, i) => {
                const score = Number(e.score ?? 0);
                const cls = score >= 0.75 ? 'ok' : score >= 0.5 ? 'warn' : 'err';
                return (
                  <tr key={i}>
                    <td className="m">{String(e.targetId)}</td>
                    <td className="m">{String(e.targetType)}</td>
                    <td><span className={`badge ${cls}`}>{score.toFixed(2)}</span></td>
                    <td className="m">{Array.isArray(e.strengths) ? (e.strengths as string[]).join('; ') : '—'}</td>
                    <td className="m">{Array.isArray(e.weaknesses) ? (e.weaknesses as string[]).join('; ') || '—' : '—'}</td>
                    <td className="m">{timeAgo(String(e.createdAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
