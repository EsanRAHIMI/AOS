import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { decideRecommendationAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

const badge = (s: string) => (s === 'approved' || s === 'converted' ? 'ok' : s === 'rejected' ? 'err' : 'warn');

export default async function RecommendationsPage() {
  const rows = (await gateway.systemRecommendations()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">System Recommendations</h1>
      <p className="sub">Evidence-backed improvements from learning. Approving converts a recommendation into a task.</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No recommendations yet. Run "Analyze system history and recommend improvements".</div></div>
      ) : (
        rows.map((r, i) => {
          const id = String(r.recommendationId);
          const status = String(r.status);
          const pending = status === 'waiting_approval' || status === 'changes_requested';
          const evidence = Array.isArray(r.evidence) ? (r.evidence as string[]) : [];
          return (
            <div className="card" key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{String(r.title)}</b>
                <span className={`badge ${badge(status)}`}>{status}{r.convertedId ? ` → ${String(r.convertedId)}` : ''}</span>
              </div>
              <p className="sub" style={{ marginBottom: 4 }}><span className="badge">{String(r.type)}</span> · risk {String(r.riskLevel)} · {timeAgo(String(r.createdAt))}</p>
              <p className="sub" style={{ marginBottom: 4 }}>{String(r.reason)}</p>
              <p className="sub" style={{ marginBottom: 6 }}>Expected: {String(r.expectedImpact)} · Evidence: {evidence.length} record(s)</p>
              {pending && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {[['approve', 'Approve & convert to task'], ['request_changes', 'Request changes'], ['reject', 'Reject']].map(([a, label]) => (
                    <form key={a} action={decideRecommendationAction}>
                      <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={a} />
                      <button className={a === 'approve' ? 'btn-ok' : 'btn-err'} type="submit">{label}</button>
                    </form>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
