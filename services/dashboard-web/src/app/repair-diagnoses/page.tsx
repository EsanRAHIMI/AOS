import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function DiagnosesPage() {
  const rows = (await gateway.repairDiagnoses()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Repair Diagnoses</h1>
      <p className="sub">Ranked suspected causes for each failure, with confidence.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No diagnoses yet.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Top suspected cause</th><th>Confidence</th><th>Risk</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((d, i) => {
                const causes = Array.isArray(d.suspectedCauses) ? (d.suspectedCauses as Array<{ cause: string }>) : [];
                return (
                  <tr key={i}>
                    <td>{String(d.serviceName)}</td>
                    <td className="m">{causes[0]?.cause ?? '—'}</td>
                    <td><span className="badge warn">{Math.round(Number(d.confidence ?? 0) * 100)}%</span></td>
                    <td className="m">{String(d.riskLevel)}</td>
                    <td className="m">{timeAgo(String(d.createdAt))}</td>
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
