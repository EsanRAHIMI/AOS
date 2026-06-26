import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function ValidationsPage() {
  const rows = (await gateway.validations()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Runtime Validations</h1>
      <p className="sub">Proof that generated services follow the factory standard.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No validations yet. Activate a generated capability.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Capability</th><th>Type</th><th>Passed</th><th>Score</th><th>Checks</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((v, i) => {
                const checks = Array.isArray(v.checks) ? (v.checks as Array<{ passed: boolean }>) : [];
                const ok = checks.filter((c) => c.passed).length;
                return (
                  <tr key={i}>
                    <td><Link href={`/validations/${String(v.validationId)}`}>{String(v.serviceName)}</Link></td>
                    <td className="m">{String(v.capabilityId)}</td>
                    <td className="m">{String(v.validationType)}</td>
                    <td><span className={`badge ${v.passed ? 'ok' : 'err'}`}>{v.passed ? 'passed' : 'failed'}</span></td>
                    <td>{Number(v.score ?? 0).toFixed(2)}</td>
                    <td className="m">{ok}/{checks.length}</td>
                    <td className="m">{timeAgo(String(v.createdAt))}</td>
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
