import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const rows = (await gateway.evidence()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Evidence</h1>
      <p className="sub">The kernel never claims success without proof. Every outcome leaves evidence.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No evidence yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Summary</th><th>Service</th><th>Capability</th><th>S3</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i}>
                  <td><span className="badge">{String(e.type)}</span></td>
                  <td className="m">{String(e.summary)}</td>
                  <td className="m">{String(e.serviceName ?? '—')}</td>
                  <td className="m">{String(e.capabilityId ?? '—')}</td>
                  <td className="m">{e.s3ObjectId ? 'yes' : '—'}</td>
                  <td className="m">{timeAgo(String(e.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
