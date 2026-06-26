import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function GapsPage() {
  const rows = (await gateway.gaps()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Capability Gaps</h1>
      <p className="sub">Capabilities the kernel needed but did not yet have.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No gaps detected yet.</div>
        ) : (
          <table>
            <thead><tr><th>Required capability</th><th>Reason</th><th>Recommended</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((g, i) => (
                <tr key={i}>
                  <td><span className="badge warn">{String(g.requiredCapability)}</span></td>
                  <td className="m">{String(g.reason)}</td>
                  <td className="m">{String(g.recommendedExpansion)}</td>
                  <td className="m">{String(g.status)}</td>
                  <td className="m">{timeAgo(String(g.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
