import Link from 'next/link';
import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'active' ? 'ok' : s === 'generated' ? 'ok' : s === 'proposed' ? 'warn' : s === 'failed' ? 'err' : '');

export default async function CapabilitiesPage() {
  const caps = (await gateway.capabilities()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Capability Graph</h1>
      <p className="sub">What the kernel can do — and what it has proposed or generated to grow.</p>
      <div className="card">
        {!caps || caps.length === 0 ? (
          <div className="empty">No capabilities yet. Start the orchestrator to seed the graph.</div>
        ) : (
          <table>
            <thead><tr><th>Capability</th><th>Category</th><th>Status</th><th>Maturity</th><th>Score</th><th>Supported by</th></tr></thead>
            <tbody>
              {caps.map((c, i) => (
                <tr key={i}>
                  <td><Link href={`/capabilities/${String(c.capabilityId)}`}>{String(c.title)}</Link></td>
                  <td className="m">{String(c.category)}</td>
                  <td><span className={`badge ${badgeFor(String(c.status))}`}>{String(c.status)}</span></td>
                  <td className="m">{String(c.maturityLevel)}</td>
                  <td>{Number(c.evaluationScore ?? 0).toFixed(2)}</td>
                  <td className="m">{Array.isArray(c.supportedByServices) ? (c.supportedByServices as string[]).join(', ') || '—' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
