import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { decideScoringProposalAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

const badge = (s: string) => (s === 'approved' ? 'ok' : s === 'rejected' ? 'err' : 'warn');

export default async function ScoringProposalsPage() {
  const rows = (await gateway.scoringProposals()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Scoring Change Proposals</h1>
      <p className="sub">Adaptive scoring is never silent — changes are proposed, approved, and versioned.</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No scoring change proposals yet.</div></div>
      ) : (
        rows.map((p, i) => {
          const id = String(p.proposalId);
          const status = String(p.status);
          const pending = status === 'waiting_approval' || status === 'changes_requested';
          const changes = Array.isArray(p.changes) ? (p.changes as Array<{ dimension: string; change: number; reason: string }>) : [];
          return (
            <div className="card" key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>Proposal {id}</b>
                <span className={`badge ${badge(status)}`}>{status}{p.resultingProfileVersion ? ` → v${String(p.resultingProfileVersion)}` : ''}</span>
              </div>
              <p className="sub" style={{ marginBottom: 6 }}>{String(p.reason)}</p>
              <table><tbody>
                {changes.map((c, j) => (<tr key={j}><td className="m">{c.dimension}</td><td>{c.change > 0 ? '+' : ''}{c.change}</td><td className="m">{c.reason}</td></tr>))}
              </tbody></table>
              <p className="sub" style={{ marginTop: 6 }}>Expected: {String(p.expectedImpact)} · {timeAgo(String(p.createdAt))}</p>
              {pending && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {['approve', 'request_changes', 'reject'].map((a) => (
                    <form key={a} action={decideScoringProposalAction}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="action" value={a} />
                      <button className={a === 'approve' ? 'btn-ok' : 'btn-err'} type="submit">{a.replace('_', ' ')}</button>
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
