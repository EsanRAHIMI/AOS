import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'resolved' ? 'ok' : s === 'failed' ? 'err' : 'warn');

export default async function IncidentsPage() {
  const rows = (await gateway.incidents()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Incidents</h1>
      <p className="sub">Failures detected by activation checks or monitoring. Click one to diagnose and repair.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No incidents. Good.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>What failed</th><th>Severity</th><th>Status</th><th>Source</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={i}>
                  <td><Link href={`/incidents/${String(x.incidentId)}`}>{String(x.serviceName)}</Link></td>
                  <td className="m">{String(x.detail)}</td>
                  <td><span className="badge err">{String(x.severity)}</span></td>
                  <td><span className={`badge ${badgeFor(String(x.status))}`}>{String(x.status)}</span></td>
                  <td className="m">{String(x.source)}</td>
                  <td className="m">{timeAgo(String(x.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
