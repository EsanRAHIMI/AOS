import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function PromptPerformancePage() {
  const rows = (await gateway.promptPerformance()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Prompt Performance</h1>
      <p className="sub">How each prompt version performs: validity, fallback, cost. Prompt changes are proposed, not auto-applied.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No prompt performance data yet.</div>
        ) : (
          <table>
            <thead><tr><th>Task type</th><th>Version</th><th>Samples</th><th>Valid</th><th>Fallback</th><th>Avg cost</th><th>Recommend</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td className="m">{String(p.taskType)}</td>
                  <td>{String(p.promptVersion)}</td>
                  <td className="m">{String(p.sampleSize)}</td>
                  <td className="m">{Number(p.validRate ?? 0).toFixed(2)}</td>
                  <td className="m">{Number(p.fallbackRate ?? 0).toFixed(2)}</td>
                  <td className="m">${Number(p.avgCostUsd ?? 0).toFixed(4)}</td>
                  <td>{p.recommendImprovement ? <span className="badge warn">{String(p.reason)}</span> : <span className="badge ok">healthy</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
