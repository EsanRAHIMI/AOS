import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

const trendBadge = (t: string) => (t === 'improving' ? 'ok' : t === 'declining' ? 'err' : '');

export default async function ReliabilityPage() {
  const rows = (await gateway.reliability()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Reliability Scores</h1>
      <p className="sub">Reliability of services, agents, capabilities, and plan/repair types over time.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No reliability scores yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Target</th><th>Score</th><th>Success</th><th>Incidents</th><th>Samples</th><th>Trend</th><th>Confidence</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const score = Number(r.score ?? 0);
                const cls = score >= 0.75 ? 'ok' : score >= 0.5 ? 'warn' : 'err';
                return (
                  <tr key={i}>
                    <td className="m">{String(r.targetType)}</td>
                    <td>{String(r.targetId)}</td>
                    <td><span className={`badge ${cls}`}>{score.toFixed(2)}</span></td>
                    <td className="m">{Number(r.successRate ?? 0).toFixed(2)}</td>
                    <td className="m">{Number(r.incidentRate ?? 0).toFixed(2)}</td>
                    <td className="m">{String(r.sampleSize)}</td>
                    <td><span className={`badge ${trendBadge(String(r.trend))}`}>{String(r.trend)}</span></td>
                    <td className="m">{Number(r.confidence ?? 0).toFixed(2)}</td>
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
