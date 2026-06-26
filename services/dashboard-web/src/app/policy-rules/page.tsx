import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

const badge = (d: string) => (d === 'allowed' ? 'ok' : d === 'blocked' ? 'err' : 'warn');

export default async function PolicyRulesPage() {
  const rows = (await gateway.policyRules()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Policy Rules</h1>
      <p className="sub">Configurable policy overlays. Hardcoded safety blocks (file delete, physical actions) always override these.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No configurable policy rules. Code defaults apply; hardcoded blocks still enforce safety.</div>
        ) : (
          <table>
            <thead><tr><th>Action</th><th>Decision</th><th>Scope</th><th>Risk</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const sc = (r.scope ?? {}) as Record<string, string>;
                return (
                  <tr key={i}>
                    <td className="m">{String(r.action)}</td>
                    <td><span className={`badge ${badge(String(r.decision))}`}>{String(r.decision)}</span></td>
                    <td className="m">{Object.entries(sc).map(([k, v]) => `${k}=${v}`).join(', ') || 'global'}</td>
                    <td className="m">{String(r.riskLevel)}</td>
                    <td className="m">{String(r.status)}</td>
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
