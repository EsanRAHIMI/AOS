import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badge = (s: string) => (/improved|reduced|increased|expanded/.test(s) ? 'ok' : 'warn');

export default async function ImpactPage() {
  const rows = (await gateway.impactAssessments()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Impact Assessments</h1>
      <p className="sub">Did the improvement help? Before/after metrics — impact is never faked.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No impact assessments yet.</div>
        ) : (
          <table>
            <thead><tr><th>Target</th><th>Impact</th><th>Confidence</th><th>Before→After (reliability)</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((a, i) => {
                const b = (a.beforeMetrics ?? {}) as Record<string, number>;
                const af = (a.afterMetrics ?? {}) as Record<string, number>;
                return (
                  <tr key={i}>
                    <td className="m">{String(a.targetType)}/{String(a.targetId)}</td>
                    <td><span className={`badge ${badge(String(a.impact))}`}>{String(a.impact)}</span></td>
                    <td className="m">{Number(a.confidence ?? 0).toFixed(2)}</td>
                    <td className="m">{Number(b.reliability ?? 0).toFixed(3)} → {Number(af.reliability ?? 0).toFixed(3)}</td>
                    <td className="m">{timeAgo(String(a.createdAt))}</td>
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
