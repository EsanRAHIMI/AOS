import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badge = (t: string) => (t === 'success' ? 'ok' : t === 'failure' ? 'err' : 'warn');

export default async function PatternsPage() {
  const rows = (await gateway.patterns()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Operational Patterns</h1>
      <p className="sub">Recurring successes and weak points mined from history.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No patterns yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Pattern</th><th>Confidence</th><th>Support</th><th>Recommended action</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td><span className={`badge ${badge(String(p.patternType))}`}>{String(p.patternType)}</span></td>
                  <td>{String(p.title)}<div className="m">{String(p.description)}</div></td>
                  <td>{Number(p.confidence ?? 0).toFixed(2)}</td>
                  <td className="m">{String(p.supportCount)}</td>
                  <td className="m">{String(p.recommendedAction)}</td>
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
