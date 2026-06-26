import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badge = (v: string) => (v === 'accurate' ? 'ok' : v === 'overestimated' ? 'err' : 'warn');

export default async function OutcomeReviewsPage() {
  const rows = (await gateway.outcomeReviews()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Outcome Reviews</h1>
      <p className="sub">Predicted plan quality vs measured outcome — the basis for scoring learning.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No outcome reviews yet. Try "Review the last strategic decision and improve future scoring".</div>
        ) : (
          <table>
            <thead><tr><th>Plan</th><th>Predicted</th><th>Actual</th><th>Verdict</th><th>Recommended changes</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const changes = Array.isArray(r.recommendedWeightChanges) ? (r.recommendedWeightChanges as Array<{ dimension: string; change: number }>) : [];
                return (
                  <tr key={i}>
                    <td className="m">{String(r.selectedPlanId)}</td>
                    <td>{Number(r.selectedPlanScore ?? 0).toFixed(2)}</td>
                    <td>{Number(r.actualEvaluationScore ?? 0).toFixed(2)}</td>
                    <td><span className={`badge ${badge(String(r.predictedVsActual))}`}>{String(r.predictedVsActual)}</span></td>
                    <td className="m">{changes.map((c) => `${c.dimension} ${c.change > 0 ? '+' : ''}${c.change}`).join(', ') || '—'}</td>
                    <td className="m">{timeAgo(String(r.createdAt))}</td>
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
