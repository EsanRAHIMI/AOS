import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function ScoringProfilesPage() {
  const rows = (await gateway.scoringProfiles()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Scoring Profiles</h1>
      <p className="sub">Versioned scoring weights. Only one is active; old versions stay for audit.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No scoring profiles yet.</div>
        ) : (
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Weights</th><th>Reason</th><th>Approved by</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((p, i) => {
                const w = (p.weights ?? {}) as Record<string, number>;
                return (
                  <tr key={i}>
                    <td>v{String(p.version)}</td>
                    <td><span className={`badge ${p.status === 'active' ? 'ok' : ''}`}>{String(p.status)}</span></td>
                    <td className="m">{Object.entries(w).map(([k, v]) => `${k}:${Number(v).toFixed(2)}`).join('  ')}</td>
                    <td className="m">{String(p.reason)}</td>
                    <td className="m">{String(p.approvedBy ?? '—')}</td>
                    <td className="m">{timeAgo(String(p.createdAt))}</td>
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
