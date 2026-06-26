import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function ActivationsPage() {
  const rows = (await gateway.activations()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Service Activations</h1>
      <p className="sub">Live checks proving a validated service is actually deployed and usable.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No activations yet. Run an activation check from a checklist.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Capability</th><th>Domain</th><th>Passed</th><th>Active</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={i}>
                  <td><Link href={`/activations/${String(a.activationId)}`}>{String(a.serviceName)}</Link></td>
                  <td className="m">{String(a.capabilityId)}</td>
                  <td className="m">{String(a.domain)}</td>
                  <td><span className={`badge ${a.passed ? 'ok' : 'err'}`}>{a.passed ? 'passed' : 'failed'}</span></td>
                  <td>{a.promotedToActive ? <span className="badge ok">active</span> : <span className="badge warn">validated</span>}</td>
                  <td className="m">{timeAgo(String(a.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
